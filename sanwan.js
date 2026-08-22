/**
 * sanwan.js  —  Main entry point
 *
 * Boot sequence
 * ─────────────
 *  1. Load .env
 *  2. Detect OS (informational banner)
 *  3. Load command files from commands/
 *  4. Route interactions through the command queue
 *       queue.enqueue() handles Gate A (registry) + Gate B (roles) internally
 *       and ensures one active job per user at a time
 *  5. On ready: wire logger, start GitHub integration (webhook OR polling)
 */

'use strict';

require('dotenv').config();

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs   = require('fs');
const path = require('path');

const logger          = require('./utils/logger');
const storage         = require('./utils/storage');
const permissions     = require('./utils/permissions');
const registry        = require('./utils/registry');
const queue           = require('./utils/queue');
const { detectPlatform }  = require('./utils/os-service');
const { createWebhook }   = require('./utils/github-webhook');
const { startPolling }    = require('./utils/github-poller');

// ─── 1. OS banner ─────────────────────────────────────────────────────────────

const platform = detectPlatform();
console.log(`\n🖥  Platform : ${platform.name} (${platform.arch})`);
console.log(`⚙️  Services : ${platform.serviceManager}`);
console.log(`🐙  GitHub   : ${process.env.GITHUB_MODE || 'none'}`);

// ─── 2. Discord client ────────────────────────────────────────────────────────

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

// ─── 3. Load commands ─────────────────────────────────────────────────────────

const commandsDir = path.join(__dirname, 'commands');

if (!fs.existsSync(commandsDir)) {
  logger.warn('commands/ directory not found — no commands will be registered.');
} else {
  for (const file of fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'))) {
    try {
      const cmd = require(path.join(commandsDir, file));
      if (cmd.name && typeof cmd.run === 'function') {
        client.commands.set(cmd.name, cmd);
        logger.info(`Loaded command: /${cmd.name}`);
      } else {
        logger.warn(`Skipped ${file}: missing name or run()`);
      }
    } catch (err) {
      logger.error(`Failed to load command ${file}`, { error: err.message });
    }
  }
}

// ─── 4. Interaction router — all dispatch goes through the queue ───────────────
//
// queue.enqueue() runs:
//   Gate A — registry.isCommandAllowed()     (owner device-level on/off)
//   Gate B — permissions.checkPermission()   (Discord role requirements)
// before placing the job in the user's per-user FIFO queue.
// No duplicate gate logic lives here.

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    // Unknown command — not in loaded set (can happen if deploy-commands ran
    // before the command file was created).
    await interaction.reply({ content: '❓ Unknown command.', ephemeral: true });
    return;
  }

  // Hand off to the queue — it handles gates, logging, and error recovery.
  await queue.enqueue(interaction, cmd => command.run(cmd));
});

// ─── 5. Client ready ──────────────────────────────────────────────────────────

client.once('ready', async () => {
  console.log(`\n✅ Logged in as ${client.user.tag}`);
  console.log(`📦 Commands loaded: ${client.commands.size}`);

  // ── Normalise settings file path ─────────────────────────────────────────
  // storage resolves against ./data/ already, so strip that prefix if present.
  const settingsFile = (process.env.SETTINGS_PATH || './data/settings.enc')
    .replace(/^\.\/data\//, '')
    .replace(/^data\//, '')
    .replace(/^\.\//, '');

  // ── Wire logger → Discord error channel ──────────────────────────────────
  let errorChannelId = null;
  if (process.env.SETTINGS_KEY) {
    try {
      const settings = storage.encryptedRead(settingsFile, null);
      errorChannelId = settings?.bot?.errorChannel ?? null;
    } catch { /* settings may not exist yet — safe to ignore */ }
  }

  logger.setDiscordClient(client, errorChannelId);
  logger.info(errorChannelId
    ? `Error-log channel wired: ${errorChannelId}`
    : 'No error-log channel configured — errors logged to file only.'
  );

  // ── Log permission summary ────────────────────────────────────────────────
  const allowedCmds = registry.listAllowedCommands().filter(r => r.enabled).map(r => r.name);
  logger.info(`Allowed commands: ${allowedCmds.length ? allowedCmds.join(', ') : '(all — no restrictions)'}`);

  const roleMappings = permissions.listRoleMap();
  if (roleMappings.length > 0) {
    logger.info(`Role mappings active for: ${roleMappings.map(r => r.command).join(', ')}`);
  }

  // ── GitHub integration ────────────────────────────────────────────────────
  const githubMode = (process.env.GITHUB_MODE || 'none').toLowerCase();

  if (githubMode === 'webhook') {
    _startWebhookServer(settingsFile);

  } else if (githubMode === 'polling' || githubMode === 'polling_pat') {
    _startPoller(settingsFile);

  } else {
    logger.info('GitHub integration: disabled (GITHUB_MODE=none)');
  }
});

// ─── 6a. GitHub integration — webhook mode ────────────────────────────────────

function _startWebhookServer(settingsFile) {
  if (!process.env.GITHUB_WEBHOOK_SECRET) {
    logger.warn('GITHUB_MODE=webhook but GITHUB_WEBHOOK_SECRET is not set — payloads will NOT be signature-verified.');
  }

  const webhook = createWebhook();
  const notifyChannelId = _loadNotifyChannel(settingsFile);

  webhook.onPush(async ({ branch, commits, pusher, repo }) => {
    const lines = [
      `📦 **Push** → \`${repo}\` / \`${branch}\``,
      `   👤 ${pusher.name || 'unknown'} — ${commits.length} commit(s)`,
      ...commits.slice(0, 3).map(c =>
        `   • \`${c.id?.slice(0, 7)}\` ${c.message?.split('\n')[0]}`
      )
    ];
    logger.info(`GitHub push: ${repo}@${branch} (${commits.length} commits)`);
    await _notify(notifyChannelId, lines.join('\n'));
  });

  webhook.onPullRequest(async ({ action, number, title, url, author, repo }) => {
    if (!['opened', 'closed', 'reopened'].includes(action)) return;
    const verb = { opened: '🟢 opened', closed: '🔴 closed', reopened: '🔄 reopened' }[action];
    await _notify(notifyChannelId,
      `🔀 **PR #${number}** ${verb} on \`${repo}\`\n   "${title}" — 👤 ${author}\n   🔗 ${url}`
    );
    logger.info(`GitHub PR #${number} ${action}: ${repo}`);
  });

  webhook.onWorkflowRun(async ({ workflow, conclusion, branch, url, repo }) => {
    if (!conclusion) return;
    const emoji = conclusion === 'success' ? '✅' : '❌';
    await _notify(notifyChannelId,
      `${emoji} **${workflow}** \`${repo}@${branch}\` — ${conclusion}\n   🔗 ${url}`
    );
    logger.info(`GitHub workflow "${workflow}" ${conclusion}: ${repo}`);
  });

  webhook.onRelease(async ({ action, tag, name, url, repo }) => {
    if (action !== 'published') return;
    await _notify(notifyChannelId,
      `🚀 **Release ${tag}** on \`${repo}\`\n   "${name}"\n   🔗 ${url}`
    );
    logger.info(`GitHub release ${tag} published: ${repo}`);
  });

  webhook.start().catch(err => {
    logger.error('Failed to start GitHub webhook server', { error: err.message });
  });
}

// ─── 6b. GitHub integration — polling mode ────────────────────────────────────

function _startPoller(settingsFile) {
  const notifyChannelId = _loadNotifyChannel(settingsFile);
  const emitter = startPolling(); // reads GITHUB_MODE, GITHUB_REPO, GITHUB_PAT, GITHUB_POLL_INTERVAL

  emitter.on('commits', async ({ repo, commits }) => {
    for (const c of commits) {
      await _notify(notifyChannelId,
        `📦 **New commit** on \`${repo}\`\n` +
        `   \`${c.short}\` ${c.message}\n` +
        `   👤 ${c.author}  🔗 ${c.url}`
      );
    }
  });

  emitter.on('issues', async ({ repo, issues }) => {
    for (const i of issues) {
      const labels = i.labels.length ? `  [${i.labels.join(', ')}]` : '';
      await _notify(notifyChannelId,
        `🐛 **New issue #${i.number}** on \`${repo}\`${labels}\n` +
        `   ${i.title}\n` +
        `   👤 ${i.author}  🔗 ${i.url}`
      );
    }
  });

  emitter.on('error', err => {
    logger.warn('GitHub poller error', { error: err.message });
  });
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Read the notify channel from encrypted settings (best-effort). */
function _loadNotifyChannel(settingsFile) {
  if (!process.env.SETTINGS_KEY) return null;
  try {
    const settings = storage.encryptedRead(settingsFile, null);
    return settings?.bot?.errorChannel ?? null;
  } catch {
    return null;
  }
}

/** Post a plain-text message to a Discord channel (best-effort, no throw). */
async function _notify(channelId, message) {
  if (!channelId) return;
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch) await ch.send(message);
  } catch (err) {
    logger.warn('Could not post GitHub notification to Discord', { error: err.message });
  }
}

// ─── 7. Login ─────────────────────────────────────────────────────────────────

client.login(process.env.DISCORD_TOKEN).catch(err => {
  logger.error('Discord login failed', { error: err.message });
  process.exit(1);
});
