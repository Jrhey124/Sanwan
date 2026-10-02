/**
 * commands/debug.js
 *
 * /debug — fire live test messages into configured channels and inspect
 *          bot internals without triggering real events.
 *
 * ── Subcommands ───────────────────────────────────────────────────────────────
 *
 *  channels      Post a "🔧 Debug triggered" message into EVERY configured
 *                channel so you can visually confirm each one is wired and
 *                reachable.  Reports back per-channel with ✅/❌.
 *
 *  error         Send a test error embed to the error channel — identical
 *                format to what logger.notifyDiscord() sends on a real error.
 *
 *  notification  Send a test task-reminder embed to the task channel —
 *                identical format to what daemon.js sends.
 *
 *  github        Send a test GitHub push message to the github channel —
 *                identical format to what sanwan.js sends on a real push.
 *
 *  settings      Dump decrypted settings (secrets redacted).
 *  registry      Show allowed commands, log sources, deploy services.
 *  logs          Show last 10 lines of each internal log file.
 *
 * ── Security ─────────────────────────────────────────────────────────────────
 *
 *  Restrict to admin roles in setup step 5b — this command can post to any
 *  configured channel and exposes configuration details.
 *  The command interaction reply is always ephemeral; the channel messages
 *  are real (visible to everyone in those channels).
 */

'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path     = require('path');
const fs       = require('fs');
const storage  = require('../utils/storage');
const logger   = require('../utils/logger');
const registry = require('../utils/registry');

// ─── Shared helpers ───────────────────────────────────────────────────────────

function _settingsKey() {
  const raw = process.env.SETTINGS_PATH || './data/settings.enc';
  return raw
    .replace(/^\.\/data\//, '')
    .replace(/^data\//, '')
    .replace(/^\.\//, '');
}

function _loadSettings() {
  if (!process.env.SETTINGS_KEY) return {};
  try {
    return storage.encryptedRead(_settingsKey(), {}) || {};
  } catch (err) {
    return { _error: err.message };
  }
}

/**
 * Send any payload (string or { embeds }) to a Discord channel.
 * Returns { ok, channelName, error }.
 */
async function _post(client, channelId, payload) {
  if (!channelId) return { ok: false, channelName: null, error: 'not configured' };
  try {
    const ch = await client.channels.fetch(channelId);
    if (!ch)  return { ok: false, channelName: null, error: 'channel not found' };
    await ch.send(payload);
    return { ok: true, channelName: ch.name, error: null };
  } catch (err) {
    return { ok: false, channelName: null, error: err.message };
  }
}

/** One-line status string for an interaction reply. */
function _line(icon, label, id, ok, channelName, error) {
  if (!id)          return `${icon} **${label}**: ❌ not configured`;
  if (ok)           return `${icon} **${label}** \`${id}\` → ✅ delivered to **#${channelName}**`;
  return            `${icon} **${label}** \`${id}\` → ❌ ${error}`;
}

// ─── Real-event embed/message factories ──────────────────────────────────────
//
// These produce payloads IDENTICAL to what the real subsystems send so you
// are testing the exact same thing a live event would trigger.

/** Same embed logger.notifyDiscord() sends on a real error. */
function _errorPayload(message, triggeredBy) {
  return {
    embeds: [{
      color:       0xff0000,
      title:       '🚨 Error Alert',
      description: message.substring(0, 4000),
      fields:      [
        { name: 'triggeredBy', value: triggeredBy, inline: true },
        { name: 'source',      value: 'debug test', inline: true }
      ],
      timestamp:   new Date().toISOString()
    }]
  };
}

/** Same embed daemon.js sends in sendTaskReminder(). */
function _taskReminderPayload(triggeredBy) {
  return {
    embeds: [{
      color:       0xffaa00,
      title:       '⏰ Task Reminder',
      description: 'Task **T001** is due soon!',
      fields:      [
        { name: 'Title',    value: 'Sample Task — deadline test', inline: false },
        { name: 'Assignee', value: triggeredBy,                   inline: true  },
        { name: 'Deadline', value: new Date(Date.now() + 86_400_000).toISOString().split('T')[0], inline: true }
      ],
      timestamp:   new Date().toISOString()
    }]
  };
}

/** Same plain-text format sanwan.js posts on a GitHub push event. */
function _githubPushPayload(triggeredBy) {
  return (
    `📦 **Push** → \`owner/repo\` / \`main\`\n` +
    `   👤 ${triggeredBy} — 1 commit(s)\n` +
    `   • \`abc1234\` debug: test push from /debug github`
  );
}

/** Generic "debug triggered" message — one per channel in /debug channels. */
function _debugPingPayload(label, triggeredBy) {
  return {
    embeds: [{
      color:       0x5865f2,
      title:       `🔧 Debug Triggered — ${label}`,
      description: `This channel is correctly configured and reachable.\n\n*Triggered by ${triggeredBy} via \`/debug channels\`*`,
      timestamp:   new Date().toISOString()
    }]
  };
}

// ─── Module export ────────────────────────────────────────────────────────────

module.exports = {
  name:        'debug',
  description: 'Fire test messages into configured channels (admin only)',

  data: new SlashCommandBuilder()
    .setName('debug')
    .setDescription('Fire test messages into configured channels and inspect bot config')
    .addSubcommand(sub =>
      sub.setName('channels')
        .setDescription('Post a live debug message into every configured channel')
    )
    .addSubcommand(sub =>
      sub.setName('error')
        .setDescription('Send a test error embed to the error channel (same format as real errors)')
        .addStringOption(o =>
          o.setName('message')
            .setDescription('Custom error message (optional)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('notification')
        .setDescription('Send a test task reminder embed to the task channel (same format as daemon)')
    )
    .addSubcommand(sub =>
      sub.setName('github')
        .setDescription('Send a test GitHub push message to the github channel (same format as real events)')
    )
    .addSubcommand(sub =>
      sub.setName('settings')
        .setDescription('Dump current settings (channel IDs and flags — secrets redacted)')
    )
    .addSubcommand(sub =>
      sub.setName('registry')
        .setDescription('Show allowed commands, log sources, and deploy services')
    )
    .addSubcommand(sub =>
      sub.setName('logs')
        .setDescription('Show the last 10 lines of each internal Sanwan log file')
    ),

  async run(interaction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });

    try {
      switch (sub) {
        case 'channels':     await this._channels(interaction);     break;
        case 'error':        await this._testError(interaction);    break;
        case 'notification': await this._testNotif(interaction);    break;
        case 'github':       await this._testGithub(interaction);   break;
        case 'settings':     await this._dumpSettings(interaction); break;
        case 'registry':     await this._dumpRegistry(interaction); break;
        case 'logs':         await this._dumpLogs(interaction);     break;
        default:
          await interaction.editReply('❌ Unknown subcommand.');
      }
    } catch (err) {
      logger.error('Debug command error', { sub, error: err.message });
      await interaction.editReply(`❌ Debug error: ${err.message}`);
    }
  },

  // ── /debug channels ──────────────────────────────────────────────────────────
  //
  // Posts a live 🔧 embed into every configured channel so you can visually
  // see each one receive a message.  All three channels are tested in one call.

  async _channels(interaction) {
    const settings = _loadSettings();
    const client   = interaction.client;
    const who      = interaction.user.tag;

    const CHANNELS = [
      { key: 'errorChannel',  label: 'Error Log',   icon: '🚨' },
      { key: 'taskChannel',   label: 'Task Notifs', icon: '📋' },
      { key: 'githubChannel', label: 'GitHub Feed', icon: '🐙' }
    ];

    if (settings._error) {
      await interaction.editReply(`❌ Could not read settings: ${settings._error}`);
      return;
    }

    const lines = [];
    const seen  = new Set(); // don't double-post if two channels share the same ID

    for (const { key, label, icon } of CHANNELS) {
      const id = settings?.bot?.[key] ?? null;

      if (!id) {
        lines.push(_line(icon, label, null));
        continue;
      }

      if (seen.has(id)) {
        lines.push(`${icon} **${label}** \`${id}\` → ⏭️ same channel as previous (skipped duplicate)`);
        continue;
      }
      seen.add(id);

      const { ok, channelName, error } = await _post(client, id, _debugPingPayload(label, who));
      lines.push(_line(icon, label, id, ok, channelName, error));
    }

    const hasKey  = !!process.env.SETTINGS_KEY;
    const allGood = lines.every(l => l.includes('✅') || l.includes('⏭️') || l.includes('not configured'));

    const embed = new EmbedBuilder()
      .setColor(allGood ? 0x57f287 : 0xfee75c)
      .setTitle('🔧 Debug — Channel Test')
      .setDescription(
        `SETTINGS_KEY: ${hasKey ? '✅ loaded' : '❌ missing — cannot read channel IDs'}\n\n` +
        lines.join('\n\n') +
        '\n\n*A live message was posted to each reachable channel.*'
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },

  // ── /debug error ─────────────────────────────────────────────────────────────
  //
  // Sends the exact same embed logger.notifyDiscord() sends on a real error.
  // Also writes the error to errors.log so the full pipeline is exercised.

  async _testError(interaction) {
    const settings  = _loadSettings();
    const channelId = settings?.bot?.errorChannel ?? null;
    const msg       = interaction.options.getString('message') || '[DEBUG] Test error — pipeline verification.';
    const who       = interaction.user.tag;

    // Write to log file just like a real error would
    await logger.error(msg, { triggeredBy: who, source: 'debug test' });

    if (!channelId) {
      await interaction.editReply(
        '⚠️ **Error channel not configured.**\n' +
        'Run `npm run setup` → Step 6 to set an error channel.\n\n' +
        '✅ The error was written to `data/logs/errors.log`.'
      );
      return;
    }

    const { ok, channelName, error } = await _post(
      interaction.client, channelId, _errorPayload(msg, who)
    );

    await interaction.editReply(
      ok
        ? `✅ Test error posted to **#${channelName}** (\`${channelId}\`).\nAlso written to \`data/logs/errors.log\`.`
        : `❌ Could not post to error channel \`${channelId}\`: ${error}\n✅ Still written to \`data/logs/errors.log\`.`
    );
  },

  // ── /debug notification ───────────────────────────────────────────────────────
  //
  // Sends the exact same embed daemon.js sends in sendTaskReminder().

  async _testNotif(interaction) {
    const settings  = _loadSettings();
    const who       = interaction.user.tag;

    // Prefer dedicated task channel; fall back to error channel
    const channelId  = settings?.bot?.taskChannel   ?? null;
    const fallbackId = settings?.bot?.errorChannel  ?? null;
    const targetId   = channelId ?? fallbackId;
    const usingFallback = !channelId && !!fallbackId;

    if (!targetId) {
      await interaction.editReply(
        '⚠️ **Neither task nor error channel is configured.**\n' +
        'Run `npm run setup` → Step 6 to configure notification channels.'
      );
      return;
    }

    const { ok, channelName, error } = await _post(
      interaction.client, targetId, _taskReminderPayload(who)
    );

    const channelDesc = usingFallback
      ? `error channel (fallback — task channel not set) **#${channelName}**`
      : `task channel **#${channelName}**`;

    await interaction.editReply(
      ok
        ? `✅ Test task reminder posted to ${channelDesc} (\`${targetId}\`).`
        : `❌ Could not post to ${channelDesc} \`${targetId}\`: ${error}`
    );
  },

  // ── /debug github ─────────────────────────────────────────────────────────────
  //
  // Sends the exact same plain-text format sanwan.js posts on a real push event.

  async _testGithub(interaction) {
    const settings  = _loadSettings();
    const who       = interaction.user.tag;

    const channelId  = settings?.bot?.githubChannel ?? null;
    const fallbackId = settings?.bot?.errorChannel  ?? null;
    const targetId   = channelId ?? fallbackId;
    const usingFallback = !channelId && !!fallbackId;

    if (!targetId) {
      await interaction.editReply(
        '⚠️ **Neither github nor error channel is configured.**\n' +
        'Run `npm run setup` → Step 6 to configure notification channels.'
      );
      return;
    }

    const { ok, channelName, error } = await _post(
      interaction.client, targetId, _githubPushPayload(who)
    );

    const channelDesc = usingFallback
      ? `error channel (fallback — github channel not set) **#${channelName}**`
      : `github channel **#${channelName}**`;

    await interaction.editReply(
      ok
        ? `✅ Test GitHub push posted to ${channelDesc} (\`${targetId}\`).`
        : `❌ Could not post to ${channelDesc} \`${targetId}\`: ${error}`
    );
  },

  // ── /debug settings ───────────────────────────────────────────────────────────

  async _dumpSettings(interaction) {
    const settings = _loadSettings();

    if (settings._error) {
      await interaction.editReply(`❌ Could not read settings: ${settings._error}`);
      return;
    }

    const safe = JSON.parse(JSON.stringify(settings));
    if (safe?.github?.webhookSecret) safe.github.webhookSecret = '***';

    const text    = JSON.stringify(safe, null, 2);
    const display = text.length > 1800 ? text.slice(0, 1800) + '\n…(truncated)' : text;

    await interaction.editReply(
      `**Settings** (\`${_settingsKey()}\`)\n\`\`\`json\n${display}\n\`\`\``
    );
  },

  // ── /debug registry ───────────────────────────────────────────────────────────

  async _dumpRegistry(interaction) {
    const commands = registry.listAllowedCommands();
    const sources  = registry.listLogSources();
    const services = registry.listDeployServices();

    const fmt = arr => arr.length
      ? arr.map(r => `  ${r.enabled !== false ? '✅' : '❌'} ${r.id} — ${r.description || r.name || ''}`).join('\n')
      : '  (none)';

    const text =
      `**Allowed Commands (${commands.length})**\n${fmt(commands)}\n\n` +
      `**Log Sources (${sources.length})**\n${fmt(sources)}\n\n` +
      `**Deploy Services (${services.length})**\n${fmt(services)}`;

    const display = text.length > 1900 ? text.slice(0, 1900) + '\n…(truncated)' : text;
    await interaction.editReply(display);
  },

  // ── /debug logs ───────────────────────────────────────────────────────────────

  async _dumpLogs(interaction) {
    const logDir = path.resolve(__dirname, '..', 'data', 'logs');
    const files  = ['bot.log', 'errors.log', 'commands.log', 'daemon.log'];

    const sections = files.map(name => {
      const fp = path.join(logDir, name);
      if (!fs.existsSync(fp)) return `**${name}**: (not found)`;
      try {
        const lines = fs.readFileSync(fp, 'utf8')
          .split('\n').filter(l => l.trim()).slice(-10).join('\n');
        return `**${name}** (last 10)\n\`\`\`\n${lines || '(empty)'}\n\`\`\``;
      } catch (err) {
        return `**${name}**: ❌ ${err.message}`;
      }
    });

    const full    = sections.join('\n');
    const display = full.length > 1900 ? full.slice(0, 1900) + '\n…(truncated)' : full;
    await interaction.editReply(display);
  }
};
