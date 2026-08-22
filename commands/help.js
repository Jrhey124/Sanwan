/**
 * commands/help.js
 *
 * Fully dynamic /help command.
 *
 * ── Sources of truth ─────────────────────────────────────────────────────────
 *
 *  1. STATIC_CATALOGUE  — known bot slash commands with full subcommand docs.
 *     These are commands that always exist as .js files in commands/.
 *
 *  2. registry.listAllowedCommands()  — live encrypted registry.
 *     Shell entries (type: 'shell') are merged in at render time so every
 *     command registered in setup.js appears here automatically.
 *
 *  3. permissions.loadRoleMap()  — which Discord roles are required per command.
 *     Used for the ✅ / 🔒 / ❌ indicator that is personalised per caller.
 *
 * ── Status indicators ────────────────────────────────────────────────────────
 *
 *   ✅  enabled in registry AND this user passes the role check
 *   🔒  enabled BUT this user lacks a required role
 *   ❌  disabled in the owner registry (device-level block)
 *
 * ── Layouts ──────────────────────────────────────────────────────────────────
 *
 *   /help                → overview embed — one field per command
 *   /help <command>      → detail embed   — subcommands + roles + status
 */

'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const registry    = require('../utils/registry');
const permissions = require('../utils/permissions');

// ─── Static catalogue ─────────────────────────────────────────────────────────
//
// Covers all built-in bot slash commands.  Shell commands from the registry
// are merged in dynamically — do NOT add them here.

const STATIC_CATALOGUE = {
  help: {
    icon:        '📚',
    description: 'Show this help menu',
    subcommands: []
  },
  task: {
    icon:        '📋',
    description: 'Create and manage tasks with assignees and deadlines',
    subcommands: [
      '`add <title> [assignee] [deadline]`   — create a task',
      '`list [filter]`                        — show all tasks',
      '`update <tid> <field> <value>`         — change a field',
      '`describe <tid> <description>`         — set description',
      '`remove <tid>`                         — delete a task',
      '`notify <tid>`                         — send a reminder',
      '`due <days>`                           — tasks due in N days',
      '`link <tid> <issue#>`                  — link to GitHub issue',
      '`sync`                                 — sync with issue tracker'
    ]
  },
  schedule: {
    icon:        '⏰',
    description: 'Manage cron-based scheduled jobs',
    subcommands: [
      '`set <name> <cron>`   — create/update a schedule',
      '`list`                — show all schedules',
      '`history [name]`      — view execution history',
      '`remove <name>`       — delete a schedule',
      '`toggle <name>`       — enable / disable'
    ]
  },
  logs: {
    icon:        '📄',
    description: 'View registered log sources',
    subcommands: [
      '`view <name> [lines]` — show last N lines of a log',
      '`list`                — list all registered log sources'
    ]
  },
  errors: {
    icon:        '🚨',
    description: 'View error logs from registered sources',
    subcommands: [
      '`<name> [lines]`      — show last N error lines from a source'
    ]
  },
  ask: {
    icon:        '🤖',
    description: 'Ask the configured AI model a question',
    subcommands: [
      '`<question>`          — ask anything',
      '`model list`          — list available models',
      '`config`              — show current provider and model',
      '`switch <model>`      — change the active model (admin)'
    ]
  },
  note: {
    icon:        '📝',
    description: 'Manage personal notes',
    subcommands: [
      '`add <title>`                    — create a note',
      '`list`                           — list all notes',
      '`search <keyword>`               — search by keyword',
      '`remove <title>`                 — delete a note',
      '`push <sentence>`                — append a line',
      "`push '<line>\\n<line>'`         — append multiple lines",
      '`pop`                            — remove the last line',
      '`export <title>`                 — export as file attachment'
    ]
  },
  deploy: {
    icon:        '🚀',
    description: 'Manage registered services (start / stop / rollback)',
    subcommands: [
      '`start <service>`               — start a service',
      '`stop <service>`                — stop a service',
      '`restart <service>`             — restart a service',
      '`status <service>`              — check service status',
      '`rollback <service> <version>`  — rollback to a commit/tag',
      '`simulate <service>`            — dry-run the deploy',
      '`production=<branch>`           — set production branch',
      '`staging=<branch>`              — set staging branch'
    ]
  },
  status: {
    icon:        '📊',
    description: 'Show system resource information',
    subcommands: [
      '`disks`     — disk usage',
      '`resources` — CPU and memory',
      '`network`   — network interfaces'
    ]
  },
  disks: {
    icon:        '💾',
    description: 'Show disk usage on this host',
    subcommands: []
  },
  resources: {
    icon:        '⚙️',
    description: 'Show CPU and memory usage on this host',
    subcommands: []
  },
  cmd: {
    icon:        '⚡',
    description: 'Run an owner-approved command on this host',
    subcommands: [
      '`<shortcut>`                  — choose from registered commands',
      'Shortcuts and parameters are configured in setup.js'
    ]
  }
};

// ─── Build merged catalogue ────────────────────────────────────────────────────
//
// Called at render time (not module load) so the registry is always fresh.

/**
 * Return the full catalogue: static entries + one synthetic entry per
 * shell command registered in the registry.
 *
 * Shell entries are listed as children of /cmd in the overview but also
 * get individual detail pages reachable via /help <shortcut>.
 *
 * @returns {Record<string, { icon, description, subcommands, isShell?, shellEntry? }>}
 */
function _buildCatalogue() {
  const catalogue = { ...STATIC_CATALOGUE };

  const shellCmds = registry
    .listAllowedCommands()
    .filter(r => r.type === 'shell');

  for (const entry of shellCmds) {
    // Avoid stomping a built-in command with the same name
    if (catalogue[entry.id] && !catalogue[entry.id].isShell) continue;

    const paramHint = entry.params
      ? `  Parameters: \`${entry.params}\``
      : '  No parameters required';

    catalogue[entry.id] = {
      icon:        '⚡',
      description: entry.description || `Run \`${entry.filepath}\``,
      isShell:     true,
      shellEntry:  entry,
      subcommands: [
        `Path: \`${entry.filepath}\``,
        paramHint,
        `Run with: \`/cmd shortcut:${entry.id}\``
      ]
    };
  }

  // Update /cmd's subcommand list to show current registered shortcuts
  if (shellCmds.length > 0) {
    catalogue.cmd = {
      ...catalogue.cmd,
      subcommands: [
        '`shortcut`  — choose from the list below',
        ...shellCmds.map(c =>
          `  • \`${c.id}\` — ${c.description || c.filepath}` +
          (c.params ? ` *(${c.params})*` : '')
        )
      ]
    };
  }

  return catalogue;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

/**
 * Compute ✅ / 🔒 / ❌ for a command from the caller's perspective.
 *
 * @param {string}   cmdName
 * @param {string[]} memberRoleIds
 * @returns {{ indicator: '✅'|'🔒'|'❌', roleNote: string }}
 */
function _status(cmdName, memberRoleIds) {
  // /help is always on
  if (cmdName === 'help') return { indicator: '✅', roleNote: '' };

  // Registry gate
  if (!registry.isCommandAllowed(cmdName)) {
    return { indicator: '❌', roleNote: 'disabled on this device' };
  }

  // Role gate
  const { allowed, reason } = permissions.checkPermission(cmdName, memberRoleIds);
  if (!allowed) {
    const roleNote = reason.replace(`/${cmdName} requires `, '');
    return { indicator: '🔒', roleNote: `requires ${roleNote}` };
  }

  return { indicator: '✅', roleNote: '' };
}

/**
 * Inline role-requirement annotation for the overview embed.
 *
 * @param {string} cmdName
 * @returns {string}
 */
function _roleLabel(cmdName) {
  const roleMap = permissions.loadRoleMap();
  const entry   = roleMap[cmdName];
  if (!entry?.requiredRoles?.length) return '';
  const word = entry.requireAll ? 'all of' : 'one of';
  return `  *Requires ${word}: \`${entry.requiredRoles.join('`, `')}\`*`;
}

/**
 * Build the value string for one field in the overview embed.
 *
 * @param {string}   cmdName
 * @param {object}   info        — catalogue entry
 * @param {string[]} memberRoleIds
 * @returns {string}
 */
function _fieldValue(cmdName, info, memberRoleIds) {
  const { indicator, roleNote } = _status(cmdName, memberRoleIds);
  const roleLabel = _roleLabel(cmdName);

  // Show up to 4 subcommands in the overview; link to /help <cmd> for more
  const preview  = info.subcommands.slice(0, 4);
  const overflow = info.subcommands.length > 4
    ? `\n*…and ${info.subcommands.length - 4} more — use \`/help ${cmdName}\`*`
    : '';

  const subText = preview.length
    ? '\n' + preview.map(s => `  ${s}`).join('\n')
    : '';

  const statusNote = (indicator !== '✅' && roleNote)
    ? `  *(${roleNote})*`
    : '';

  return (
    `${indicator} **/${cmdName}** — ${info.description}${roleLabel}${statusNote}` +
    `${subText}${overflow}`
  ).slice(0, 1024); // Discord embed field value limit
}

// ─── Slash command definition ─────────────────────────────────────────────────

module.exports = {
  name:        'help',
  description: 'Show available commands and your access level',

  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show available commands and your access level')
    .addStringOption(opt =>
      opt.setName('command')
        .setDescription('Get detailed help for a specific command')
        .setRequired(false)
        // Static choices only — shell shortcuts are shown inline, not as choices,
        // because they are dynamic and Discord choices are baked in at deploy time.
        .addChoices(
          ...Object.keys(STATIC_CATALOGUE)
            .filter(k => k !== 'help')
            .map(k => ({ name: k, value: k }))
        )
    ),

  // ─── Dispatch ─────────────────────────────────────────────────────────────

  async run(interaction) {
    const specific = interaction.options.getString('command');
    return specific
      ? this._showDetail(interaction, specific)
      : this._showOverview(interaction);
  },

  // ─── Overview ─────────────────────────────────────────────────────────────

  async _showOverview(interaction) {
    const memberRoleIds = interaction.member
      ? [...interaction.member.roles.cache.keys()]
      : [];

    const catalogue = _buildCatalogue();

    // Count reachable commands (non-shell entries + /cmd if any shells exist)
    const accessible = Object.keys(catalogue).filter(name => {
      if (catalogue[name].isShell) return false; // counted via /cmd
      return _status(name, memberRoleIds).indicator === '✅';
    }).length;

    const total = Object.values(catalogue).filter(e => !e.isShell).length;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📚 Sanwan — Command Reference')
      .setDescription(
        `ChatOps bot for task management, scheduling, and DevOps automation.\n` +
        `You have access to **${accessible}** of **${total}** commands.\n\n` +
        `> ✅ available  ·  🔒 role required  ·  ❌ disabled`
      )
      .setTimestamp()
      .setFooter({ text: 'Use /help <command> for subcommand details' });

    // Add one field per non-shell catalogue entry (Discord limit: 25 fields)
    let fieldCount = 0;
    for (const [name, info] of Object.entries(catalogue)) {
      if (info.isShell) continue;          // shell shortcuts shown inside /cmd field
      if (fieldCount >= 25) break;

      embed.addFields({
        name:   `${info.icon} /${name}`,
        value:  _fieldValue(name, info, memberRoleIds),
        inline: false
      });
      fieldCount++;
    }

    await interaction.reply({ embeds: [embed], ephemeral: false });
  },

  // ─── Detail ───────────────────────────────────────────────────────────────

  async _showDetail(interaction, cmdName) {
    const catalogue = _buildCatalogue();
    const info      = catalogue[cmdName];

    if (!info) {
      await interaction.reply({
        content: `❌ Unknown command: \`${cmdName}\``,
        ephemeral: true
      });
      return;
    }

    const memberRoleIds = interaction.member
      ? [...interaction.member.roles.cache.keys()]
      : [];

    const { indicator, roleNote } = _status(cmdName, memberRoleIds);

    // Role requirements section
    const roleMap = permissions.loadRoleMap();
    const roleEntry = roleMap[cmdName];
    let rolesText = '*No role restrictions — all members can use this command.*';
    if (roleEntry?.requiredRoles?.length) {
      const word = roleEntry.requireAll ? 'ALL of' : 'ANY ONE of';
      rolesText  = `Requires ${word}:\n` +
        roleEntry.requiredRoles.map(r => `  • \`${r}\``).join('\n');
    }

    // Subcommands section
    const subText = info.subcommands.length
      ? info.subcommands.join('\n')
      : '*No subcommands.*';

    // Status section
    const statusText =
      indicator === '✅' ? '✅ Enabled — you can run this command.' :
      indicator === '🔒' ? `🔒 Enabled but access restricted.\n> ${roleNote}` :
                           `❌ Disabled on this device.\n> ${roleNote}`;

    const colour =
      indicator === '✅' ? 0x57f287 :
      indicator === '🔒' ? 0xfee75c :
                           0xed4245;

    // For shell entries, add an extra field showing the underlying program
    const extraFields = info.isShell && info.shellEntry ? [
      {
        name:   '🔧 Executable',
        value:  `\`${info.shellEntry.filepath}\`${info.shellEntry.params ? `\nParameters: \`${info.shellEntry.params}\`` : ''}`,
        inline: false
      }
    ] : [];

    const embed = new EmbedBuilder()
      .setColor(colour)
      .setTitle(`${info.icon} /${cmdName}  ${indicator}`)
      .setDescription(info.description)
      .addFields(
        { name: '📋 Subcommands / Usage', value: subText.slice(0, 1024), inline: false },
        ...extraFields,
        { name: '🔑 Role Requirements',  value: rolesText.slice(0, 1024), inline: false },
        { name: '⚙️ Status',             value: statusText,               inline: false }
      )
      .setTimestamp()
      .setFooter({ text: '/help — full command list' });

    await interaction.reply({ embeds: [embed], ephemeral: false });
  }
};
