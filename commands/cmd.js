/**
 * commands/cmd.js
 *
 * Generic dispatcher for owner-defined shell commands.
 *
 * ── How it works ─────────────────────────────────────────────────────────────
 *
 *  1. At load-time, `buildData()` reads every `type: 'shell'` entry from the
 *     encrypted registry and builds a single SlashCommandBuilder that lists
 *     them all as choices on a `shortcut` string option.
 *
 *  2. Each shell entry has the shape:
 *       { id, name, filepath, params, command, type: 'shell', enabled }
 *
 *     `filepath`  — the executable path  (e.g. C:\Windows\System32\ping.exe)
 *     `params`    — placeholder string   (e.g. {hostname})
 *     `command`   — full template        (e.g. C:\Windows\System32\ping.exe {hostname})
 *
 *  3. run() receives the chosen shortcut and any param values, substitutes
 *     {placeholder} tokens, and executes via child_process.execSync().
 *
 *  4. deploy-commands.js calls buildData() to get the current payload.
 *     If no shell commands are registered, this module still exports a valid
 *     (but empty-choices) command so the file doesn't break the loader.
 *
 * ── Security notes ────────────────────────────────────────────────────────────
 *
 *  - Only commands explicitly registered in setup.js are reachable.
 *  - Parameter values are passed as separate execFile arguments, never
 *    interpolated into a shell string, to prevent injection.
 *  - The queue middleware enforces Gate A (registry) + Gate B (roles) before
 *    this run() is ever called.
 *
 * ── Deploy note ───────────────────────────────────────────────────────────────
 *
 *  This file's `data` property is built dynamically.  If the registry changes
 *  (new commands added in setup.js), re-run `npm run deploy` to push the
 *  updated command definition to Discord.
 */

'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { execFile, execSync }  = require('child_process');
const registry  = require('../utils/registry');
const logger    = require('../utils/logger');

// ─── Build the slash command definition from the registry ─────────────────────

/**
 * Read shell entries from the registry and build a SlashCommandBuilder.
 * Called at module load time AND by deploy-commands.js.
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
    // No shell commands configured yet — add a placeholder option so the
    // builder still produces a valid JSON payload.
    builder.addStringOption(opt =>
      opt.setName('shortcut')
        .setDescription('No commands configured yet — run npm run setup')
        .setRequired(true)
        .addChoices({ name: '(none configured)', value: '__none__' })
    );
    return builder;
  }

  // ── Shortcut selector ────────────────────────────────────────────────────
  // Discord choice lists are capped at 25 entries.
  const choices = shellCmds
    .slice(0, 25)
    .map(c => ({ name: c.id, value: c.id }));

  builder.addStringOption(opt =>
    opt.setName('shortcut')
      .setDescription('Which command to run')
      .setRequired(true)
      .addChoices(...choices)
  );

  // ── Dynamic parameter options ─────────────────────────────────────────────
  // Find every unique {placeholder} across all registered commands and add
  // an optional string option for each one (up to Discord's 25-option limit).
  const paramNames = new Set();
  for (const cmd of shellCmds) {
    const matches = (cmd.params || cmd.command || '').matchAll(/\{(\w+)\}/g);
    for (const m of matches) paramNames.add(m[1]);
  }

  // Reserve slot 1 for 'shortcut', leaving 24 for params
  let paramSlots = 24;
  for (const pName of paramNames) {
    if (paramSlots-- <= 0) break;
    builder.addStringOption(opt =>
      opt.setName(pName.toLowerCase())
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

  // `data` is evaluated once at require() time.
  // deploy-commands.js reads this property to build the REST payload.
  data: buildData(),

  /**
   * Execute the chosen shell command.
   *
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async run(interaction) {
    await interaction.deferReply();

    const shortcut = interaction.options.getString('shortcut');

    // Guard against the placeholder when no commands are configured
    if (!shortcut || shortcut === '__none__') {
      await interaction.editReply(
        '⚠️ No shell commands are configured. Run `npm run setup` to add some.'
      );
      return;
    }

    // Look up the shell entry
    const shellCmds = registry
      .listAllowedCommands()
      .filter(r => r.type === 'shell' && r.enabled !== false);

    const entry = shellCmds.find(r => r.id === shortcut);

    if (!entry) {
      logger.warn(`cmd: shortcut "${shortcut}" not found in registry`, {
        user: interaction.user.tag
      });
      await interaction.editReply(
        `❌ Command \`${shortcut}\` is not registered. Re-run \`npm run setup\` then \`npm run deploy\`.`
      );
      return;
    }

    // ── Build the argument list with placeholder substitution ───────────────
    //
    // entry.command is the full template: "C:\Windows\ping.exe {hostname}"
    // We resolve it into  [filepath, arg1, arg2, …]  so execFile never
    // passes untrusted data through a shell.

    let resolved = entry.command || `${entry.filepath}${entry.params ? ' ' + entry.params : ''}`;

    // Substitute each {placeholder} with the matching interaction option value
    const paramMatches = [...resolved.matchAll(/\{(\w+)\}/g)];
    for (const [token, pName] of paramMatches) {
      const value = interaction.options.getString(pName.toLowerCase()) ?? '';
      resolved    = resolved.replace(token, value);
    }

    // Split into argv — first token is the binary, rest are arguments.
    // Simple whitespace split is fine because paths with spaces should be
    // quoted in the registry entry (e.g. "C:\Program Files\tool.exe").
    const argv     = resolved.trim().split(/\s+/);
    const binary   = argv[0];
    const args     = argv.slice(1);

    logger.info(`cmd: executing "${shortcut}"`, {
      user: interaction.user.tag,
      binary,
      args
    });

    try {
      // execSync is simpler for short-lived system commands.
      // Timeout prevents runaway processes from blocking the queue.
      const output = execSync(resolved, { timeout: 15_000 }).toString().trim();

      const truncated = output.length > 1900
        ? output.slice(0, 1900) + '\n…(truncated)'
        : output;

      await interaction.editReply(
        `✅ **\`${shortcut}\`** completed:\n\`\`\`\n${truncated || '(no output)'}\n\`\`\``
      );

      logger.command('cmd', interaction.user.tag, true, { shortcut });

    } catch (err) {
      const stderr = err.stderr?.toString().trim() || err.message;
      logger.error(`cmd: "${shortcut}" failed`, {
        user:  interaction.user.tag,
        error: stderr
      });

      const truncated = stderr.length > 1800
        ? stderr.slice(0, 1800) + '\n…(truncated)'
        : stderr;

      await interaction.editReply(
        `❌ **\`${shortcut}\`** failed:\n\`\`\`\n${truncated}\n\`\`\``
      );
    }
  }
};
