/**
 * sanwan.js  —  Main entry point
 *
 * Boot sequence
 * ─────────────
 *  1. Load .env
 *  2. Detect OS (informational banner)
 *  3. Load command files from commands/
 *  4. Load permissions (allowed-commands registry + role map) from encrypted files
 *  5. Start Discord client
 *  6. On ready: wire Discord client into logger, start GitHub webhook server
 *  7. Route every interaction through the two-gate permission check:
 *       Gate A — isCommandAllowed()    (owner device-level on/off switch)
 *       Gate B — checkPermission()     (Discord role requirements)
 */

'use strict';

require('dotenv').config();

const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs   = require('fs');
const path = require('path');

const logger      = require('./utils/logger');
const storage     = require('./utils/storage');
const permissions = require('./utils/permissions');
const registry    = require('./utils/registry');
const { detectPlatform } = require('./utils/os-service');
const { createWebhook  } = require('./utils/github-webhook');

// ─── 1. OS banner ─────────────────────────────────────────────────────────────

const platform = detectPlatform();
console.log(`\n🖥  Platform : ${platform.name} (${platform.arch})`);
console.log(`⚙️  Services : ${platform.serviceManager}`);

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

// ─── 4. Interaction router ────────────────────────────────────────────────────

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // ── Gate A — owner-level allow/deny (registry) ───────────────────────────
  if (!registry.isCommandAllowed(commandName)) {
    logger.warn(`Gate A blocked: /${commandName}`, { user: interaction.user.tag });
    await interaction.reply({
      content: `⛔ \`/${commandName}\` is not enabled on this device.`,
      ephemeral: true
    });
    return;
  }

  // ── Gate B — role-based permission (permissions.checkPermission) ─────────
  // interaction.member is available in guild interactions; falls back to []
  const memberRoleIds = interaction.member
    ? [...interaction.member.roles.cache.keys()]
    : [];

  const { allowed, reason } = permissions.checkPermission(commandName, memberRoleIds);

  if (!allowed) {
    logger.warn(`Gate B blocked: /${commandName} — ${reason}`, { user: interaction.user.tag });
    await interaction.reply({
      content: `🔒 You don't have permission to run \`/${commandName}\`.\n> ${reason}`,
      ephemeral: true
    });
    return;
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────
  const command = client.commands.get(commandName);

  if (!command) {
    await interaction.reply({ content: '❓ Unknown command.', ephemeral: true });
    return;
  }

  try {
    await command.run(interaction);
    logger.command(commandName, interaction.user.tag, true);
  } catch (err) {
    logger.error(`Command /${commandName} threw an error`, {
      user:  interaction.user.tag,
      error: err.message
    });

    const msg = {
      content:   `❌ Something went wrong running \`/${commandName}\`.`,
      ephemeral: true
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

// ─── 5. Client ready ──────────────────────────────────────────────────────────

client.once('ready', async () => {
  console.log(`\n✅ Logged in as ${client.user.tag}`);
  console.log(`📦 Commands loaded: ${client.commands.size}`);

  // ── Wire logger ──────────────────────────────────────────────────────────
  // Strip any leading path components that storage already provides via its
  // own dataDir (./data/).  ./data/settings.enc → settings.enc
  const settingsFile = (process.env.SETTINGS_PATH || './data/settings.enc')
    .replace(/^\.\/data\//, '')
    .replace(/^data\//, '')
    .replace(/^\.\//, '');
  let errorChannelId = null;

  if (process.env.SETTINGS_KEY) {
    try {
      const settings = storage.encryptedRead(settingsFile, null);
      errorChannelId = settings?.bot?.errorChannel ?? null;
    } catch { /* settings may not exist yet */ }
  }

  logger.setDiscordClient(client, errorChannelId);
  logger.info(errorChannelId
    ? `Error-log channel wired: ${errorChannelId}`
    : 'No error-log channel configured — errors logged to file only.'
  );

  // ── Log permission summary at startup ────────────────────────────────────
  const allowed = registry.listAllowedCommands().filter(r => r.enabled).map(r => r.name);
  logger.info(`Allowed commands: ${allowed.length ? allowed.join(', ') : '(all — no restrictions)'}`);

  const roleMappings = permissions.listRoleMap();
  if (roleMappings.length > 0) {
    logger.info(`Role mappings loaded for: ${roleMappings.map(r => r.command).join(', ')}`);
  }

  // ── Start GitHub webhook if configured ───────────────────────────────────
  if (process.env.GITHUB_WEBHOOK_SECRET || process.env.GITHUB_WEBHOOK_PORT) {
    _startWebhookServer(settingsFile);
  }
});

// ─── 6. GitHub webhook server ─────────────────────────────────────────────────

function _startWebhookServer(settingsFile) {
  const webhook = createWebhook();

  let notifyChannelId = null;
  if (process.env.SETTINGS_KEY) {
    try {
      // settingsFile is already normalised by the caller
      const settings = storage.encryptedRead(settingsFile, null);
      notifyChannelId = settings?.bot?.errorChannel ?? null;
    } catch { /* no-op */ }
  }

  // push
  webhook.onPush(async ({ branch, commits, pusher, repo }) => {
    const lines = [
      `📦 **Push** → \`${repo}\` / \`${branch}\``,
      `   👤 ${pusher.name || 'unknown'} — ${commits.length} commit(s)`,
      ...commits.slice(0, 3).map(c => `   • \`${c.id?.slice(0, 7)}\` ${c.message?.split('\n')[0]}`)
    ];
    logger.info(`GitHub push: ${repo}@${branch} (${commits.length})`);
    await _notify(notifyChannelId, lines.join('\n'));
  });

  // pull_request
  webhook.onPullRequest(async ({ action, number, title, url, author, repo }) => {
    if (!['opened', 'closed', 'reopened'].includes(action)) return;
    const verb = { opened: '🟢 opened', closed: '🔴 closed', reopened: '🔄 reopened' }[action];
    await _notify(notifyChannelId,
      `🔀 **PR #${number}** ${verb} on \`${repo}\`\n   "${title}" — 👤 ${author}\n   🔗 ${url}`
    );
    logger.info(`GitHub PR #${number} ${action}: ${repo}`);
  });

  // workflow_run
  webhook.onWorkflowRun(async ({ workflow, conclusion, branch, url, repo }) => {
    if (!conclusion) return;
    const emoji = conclusion === 'success' ? '✅' : '❌';
    await _notify(notifyChannelId,
      `${emoji} **${workflow}** \`${repo}@${branch}\` — ${conclusion}\n   🔗 ${url}`
    );
    logger.info(`GitHub workflow "${workflow}" ${conclusion}: ${repo}`);
  });

  // release
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

async function _notify(channelId, message) {
  if (!channelId) return;
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch) await ch.send(message);
  } catch (err) {
    logger.warn('Could not post GitHub notification', { error: err.message });
  }
}

// ─── 7. Login ─────────────────────────────────────────────────────────────────

client.login(process.env.DISCORD_TOKEN).catch(err => {
  logger.error('Discord login failed', { error: err.message });
  process.exit(1);
});
