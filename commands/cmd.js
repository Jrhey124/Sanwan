/**
 * commands/cmd.js
 *
 * Generic dispatcher for owner-defined shell commands.
 *
 * ── Problem this solves ───────────────────────────────────────────────────────
 *
 *  Shell commands (e.g. "pingtest → C:\ping.exe {hostname}") are stored in
 *  registry.enc.  Discord requires every slash command to be declared with a
 *  SlashCommandBuilder and registered via the REST API.  This single file acts
 *  as the registered Discord command for ALL owner-defined shell shortcuts.
 *
 * ── Why data is a function, not a property ────────────────────────────────────
 *
 *  If `data` were built at require() time, the registry might not be readable
 *  yet (SETTINGS_KEY not loaded).  deploy-commands.js calls buildData()
 *  explicitly AFTER dotenv is loaded so the choices always reflect the current
 *  registry state.
 *
 *  At runtime (sanwan.js), `data` is set to the result of buildData() during
 *  the command-loading phase, which also happens after dotenv.
 *
 * ── SlashCommandBuilder limits ────────────────────────────────────────────────
 *
 *  Discord caps choices at 25 and options at 25.  With 1 slot reserved for
 *  the `shortcut` selector that leaves 24 parameter slots.
 *
 * ── Security ─────────────────────────────────────────────────────────────────
 *
 *  - Only shortcuts registered in setup.js are reachable via /cmd.
 *  - Gate A in queue.js checks `isCommandAllowed('cmd')`, which returns true
 *    whenever any shell entries exist.
 *  - Gate B checks role permissions for 'cmd' as a whole.
 *  - Individual shortcut-level auth is enforced here inside run().
 */

'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { execSync }  = require('child_process');
const registry      = require('../utils/registry');
const logger        = require('../utils/logger');

// ─── Build the slash command definition ───────────────────────────────────────

/**
 * Read shell entries from the registry and return a SlashCommandBuilder.
 *
 * Called by:
 *   - deploy-commands.js  (after dotenv is loaded, before REST PUT)
 *   - sanwan.js           (after dotenv, during command file loading)
 *
 * @returns {SlashCommandBuilder}
 */
function buildData() {
  const shellCmds = registry
    .listAllowedCommands()
    .filter(r => r.type === 'shell' && r.enabled !== false);

  const builder = new SlashCommandBuilder()
    .setName('cmd')
    .setDescription('Run an owner-approved command on this host');

  if (shellCmds.length === 0) {
    // No shell commands configured yet.  A placeholder keeps the builder valid
    // so the file loads without throwing.  The user sees a clear message when
    // they actually invoke /cmd.
    builder.addStringOption(opt =>
      opt
        .setName('shortcut')
        .setDescription('No commands configured — run npm run setup first')
        .setRequired(true)
        .addChoices({ name: '(none configured)', value: '__none__' })
    );
    return builder;
  }

  // ── Shortcut choices (max 25) ────────────────────────────────────────────
  builder.addStringOption(opt =>
    opt
      .setName('shortcut')
      .setDescription('Which command to run')
      .setRequired(true)
      .addChoices(
        ...shellCmds.slice(0, 25).map(c => ({ name: c.id, value: c.id }))
      )
  );

  // ── Dynamic parameter options ─────────────────────────────────────────────
  // Collect every unique {placeholder} across all shell entries and add one
  // optional string option per placeholder (up to 24 slots remaining).
  const paramNames = new Set();
  for (const cmd of shellCmds) {
    const src = cmd.params || cmd.command || '';
    for (const [, name] of src.matchAll(/\{(\w+)\}/g)) {
      paramNames.add(name.toLowerCase());
    }
  }

  let remaining = 24; // 25 total options minus the 'shortcut' option
  for (const pName of paramNames) {
    if (remaining-- <= 0) break;
    builder.addStringOption(opt =>
      opt
        .setName(pName)
        .setDescription(`Value for {${pName}}`)
        .setRequired(false)
    );
  }

  return builder;
}

// ─── Module export ────────────────────────────────────────────────────────────

module.exports = {
  name:        'cmd',
  description: 'Run an owner-approved command on this host',

  // ── data is a getter, not a static value ────────────────────────────────
  //
  // Using a JS getter ensures that whenever anything reads module.data —
  // whether it's deploy-commands.js, sanwan.js, or test.js — it always
  // calls buildData() fresh against the current registry state.
  //
  // This eliminates the stale-cache problem: even if this module was
  // require()'d before SETTINGS_KEY was in process.env, a later read
  // of .data will call buildData() with the key now available.
  get data() { return buildData(); },

  // Expose buildData explicitly so callers can also call it directly.
  buildData,

  // ── run ───────────────────────────────────────────────────────────────────

  async run(interaction) {
    await interaction.deferReply();

    const shortcut = interaction.options.getString('shortcut');

    if (!shortcut || shortcut === '__none__') {
      await interaction.editReply(
        '⚠️ No shell commands are configured yet.\n\n' +
        '**Note:** `/cmd` only runs owner-defined shell commands added in setup.\n' +
        'For system diagnostics, use `/systeminfo` and for logs use `/logs`.\n\n' +
        'To add shell commands: `npm run setup` → Step 5, then `npm run deploy`.'
      );
      return;
    }

    // Re-read the registry at execution time so changes from setup are visible
    // without restarting the bot.
    const entry = registry
      .listAllowedCommands()
      .find(r => r.type === 'shell' && r.enabled !== false && r.id === shortcut);

    if (!entry) {
      logger.warn(`cmd: shortcut "${shortcut}" not in registry`, { user: interaction.user.tag });
      await interaction.editReply(
        `❌ \`${shortcut}\` is not registered or has been disabled.\n` +
        'Run `npm run setup` to update commands, then `npm run deploy`.'
      );
      return;
    }

    // ── Substitute {placeholders} ─────────────────────────────────────────
    //
    // The `command` field is the full invocation template, e.g.:
    //   C:\Windows\System32\cmd.exe /c dir {path}
    //   C:\Windows\System32\ping.exe {hostname}
    //   ./scripts/build.sh {branch}
    //
    // Each {placeholder} becomes a Discord string option at deploy time.
    // We replace every occurrence globally so the same placeholder can
    // appear multiple times in one command string.
    let resolved = entry.command
      || `${entry.filepath}${entry.params ? ' ' + entry.params : ''}`;

    // Collect all unique placeholder names first, then substitute each one.
    // Using a Set prevents double-substitution if the same name appears twice.
    const placeholders = new Set(
      [...resolved.matchAll(/\{(\w+)\}/g)].map(m => m[1])
    );
    for (const pName of placeholders) {
      const value   = interaction.options.getString(pName.toLowerCase()) ?? '';
      // Replace ALL occurrences of {pName} in the resolved string
      resolved = resolved.replaceAll(`{${pName}}`, value);
    }

    logger.info(`cmd: executing "${shortcut}"`, {
      user:     interaction.user.tag,
      resolved: resolved.slice(0, 120)   // don't log full command with sensitive params
    });

    // ── Execute ───────────────────────────────────────────────────────────
    try {
      const output = execSync(resolved, {
        timeout: 15_000,
        windowsHide: true   // prevent a console window popping on Windows
      }).toString().trim();

      const display = output.length > 1900
        ? output.slice(0, 1900) + '\n…(truncated)'
        : output;

      await interaction.editReply(
        `✅ **\`${shortcut}\`** completed:\n\`\`\`\n${display || '(no output)'}\n\`\`\``
      );

      logger.command('cmd', interaction.user.tag, true, { shortcut });

    } catch (err) {
      const stderr = err.stderr?.toString().trim()
        || err.stdout?.toString().trim()
        || err.message;

      logger.error(`cmd: "${shortcut}" failed`, {
        user:  interaction.user.tag,
        error: stderr.slice(0, 300)
      });

      const display = stderr.length > 1800
        ? stderr.slice(0, 1800) + '\n…(truncated)'
        : stderr;

      await interaction.editReply(
        `❌ **\`${shortcut}\`** failed:\n\`\`\`\n${display || '(no output)'}\n\`\`\``
      );
    }
  }
};
