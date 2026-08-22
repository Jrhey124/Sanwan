/**
 * commands/task.js
 *
 * /task — task management with assignees, deadlines, priority, and status.
 *
 * Storage: data/tasks/tasks.json  (plain JSON)
 *
 * Task schema:
 *   {
 *     tid:         "t0",           // auto-generated, zero-based lowercase (t0, t1, t2, …)
 *     title:       string,
 *     description: string,
 *     priority:    "low" | "medium" | "high" | "critical",
 *     assignees:   string[],       // Discord user tags or display names
 *     deadline:    string | null,  // ISO string (date or datetime)
 *     status:      "open" | "ongoing" | "completed" | "closed",
 *     linkedIssue: string | null,
 *     settings: {
 *       notifyOnAssignment: boolean,  // default: true
 *       notifyNearDeadline: string    // default: "3d"
 *     },
 *     created:     ISO string,
 *     updated:     ISO string,
 *     createdBy:   string
 *   }
 *
 * Subcommands
 * ───────────
 *   create  <title> [description] [priority]
 *       Create a new task.
 *
 *   update  <title | tid> [description] [priority]
 *       Update task info (title, description, priority).
 *
 *   delete  <title | tid>
 *       Delete a task permanently.
 *
 *   list    [filter: open | ongoing | completed | closed]
 *       List all tasks, optionally filtered by status.
 *
 *   delegate   <title | tid> <assignees> <deadline>
 *       Delegate the task: assign one or more people and set a deadline.
 *       Status is automatically set to "ongoing" when assignees are provided.
 *
 *   undelegate <title | tid>
 *       No extra params → remove all assignees, clear deadline, status → "open".
 *       With params → update only what is provided.
 *
 *   status  <title | tid> <status>
 *       Manually set task status.
 *
 *   settings [notifyOnAssignment] [notifyNearDeadline]
 *       View or update GLOBAL task notification settings (no task ref needed).
 *       Stored encrypted in data/task-settings.enc.
 *       Defaults: notifyOnAssignment=true, notifyNearDeadline=3d
 *
 *   link    <tid> <issue#>
 *       Link task to a GitHub issue number.
 *
 *   sync
 *       Sync tasks with external issue tracker (stub).
 */

'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const storage = require('../utils/storage');
const logger  = require('../utils/logger');

const TASKS_FILE = 'tasks/tasks.json';
const TASKS_KEY  = 'tasks';

// Global task notification settings — stored encrypted, independent of any task
const TASK_SETTINGS_FILE = 'task-settings.enc';
const TASK_SETTINGS_DEFAULT = {
  notifyOnAssignment: true,
  notifyNearDeadline: '3d'
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _init() {
  storage.initializeIfMissing(TASKS_FILE, { tasks: [], nextId: 1 });
}

/**
 * Generate the next task ID: t0, t1, t2, … t99999 (lowercase, zero-based).
 */
function _nextId() {
  const data = storage.read(TASKS_FILE, { tasks: [], nextId: 0 });
  const next = data.nextId ?? 0;
  data.nextId = next + 1;
  storage.write(TASKS_FILE, data);
  return `t${next}`;
}

/**
 * Resolve title-or-ID to a task.
 * ID format: t0, t1, t2, … (lowercase, zero-based).
 * Matching is case-insensitive: "T0", "t0" both match stored "t0".
 * Falls back to exact title match (case-insensitive).
 */
function _resolve(ref) {
  const tasks = storage.list(TASKS_FILE, TASKS_KEY);
  const lower = ref.trim().toLowerCase();

  // Try ID match first (e.g. "T0" → "t0")
  let task = tasks.find(t => t.tid?.toLowerCase() === lower);

  // Fall back to case-insensitive title match
  if (!task) {
    task = tasks.find(t => t.title?.toLowerCase() === lower);
  }

  return task ?? null;
}

/**
 * Persist field updates for a task.
 * Always stamps updated timestamp.
 */
function _save(tid, updates) {
  return storage.updateById(TASKS_FILE, tid, {
    ...updates,
    updated: new Date().toISOString()
  }, TASKS_KEY, 'tid');
}

/**
 * Load global task notification settings (encrypted at rest).
 * Returns defaults if the file does not exist yet.
 *
 * @returns {{ notifyOnAssignment: boolean, notifyNearDeadline: string }}
 */
function _loadGlobalSettings() {
  if (!process.env.SETTINGS_KEY) return { ...TASK_SETTINGS_DEFAULT };
  return storage.encryptedRead(TASK_SETTINGS_FILE, null) ?? { ...TASK_SETTINGS_DEFAULT };
}

/**
 * Persist global task notification settings (encrypted).
 *
 * @param {{ notifyOnAssignment?: boolean, notifyNearDeadline?: string }} updates
 * @returns {{ notifyOnAssignment: boolean, notifyNearDeadline: string }}
 */
function _saveGlobalSettings(updates) {
  const current = _loadGlobalSettings();
  const merged  = { ...current, ...updates };
  if (process.env.SETTINGS_KEY) {
    storage.encryptedWrite(TASK_SETTINGS_FILE, merged);
  }
  return merged;
}

/**
 * Parse a human-friendly deadline string into an ISO timestamp string.
 *
 * Accepted formats:
 *   Nd            — 1–9 days from now at 09:00    (e.g. "1d", "9d")
 *   Nw            — 1–9 weeks from now at 09:00   (e.g. "1w", "4w")
 *   tomorrow      — next calendar day at 09:00
 *   mon/tue/wed/thu/fri/sat/sun  — next occurrence at 09:00
 *   next mon…sun  — same with explicit "next" prefix
 *   YYYY-MM-DD    — specific date, midnight local
 *   YYYY-MM-DD HH:MM — specific date + time
 *
 * Returns an ISO string, or null if the input is unrecognised.
 *
 * @param {string} raw
 * @returns {string|null}
 */
function _parseDeadline(raw) {
  if (!raw || raw.trim() === '') return null;

  const s   = raw.trim().toLowerCase();
  const now = new Date();

  // ── Free-form date: YYYY-MM-DD or YYYY-MM-DD HH:MM ───────────────────────
  const dateFull = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2}))?/.exec(raw.trim());
  if (dateFull) {
    const [, yr, mo, dy, hr = '0', mn = '0'] = dateFull;
    const d = new Date(Number(yr), Number(mo) - 1, Number(dy), Number(hr), Number(mn));
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // ── tomorrow ─────────────────────────────────────────────────────────────
  if (s === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }

  // ── Nd  (1–9 days) ────────────────────────────────────────────────────────
  const dMatch = /^([1-9])d$/.exec(s);
  if (dMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() + Number(dMatch[1]));
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }

  // ── Nw  (1–9 weeks) ───────────────────────────────────────────────────────
  const wMatch = /^([1-9])w$/.exec(s);
  if (wMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() + Number(wMatch[1]) * 7);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }

  // ── Weekday shorthand (with or without "next ") ───────────────────────────
  // Accepts: mon tue wed thu fri sat sun (3-letter only)
  // Resolves to the next occurrence of that day at 09:00, always ≥ 1 day ahead.
  const WDAY = ['sun','mon','tue','wed','thu','fri','sat',
      'sunday', 'monday', 'tuesday', 'wednesday',
      'thursday', 'friday', 'saturday'
  ];
  const wdayWord   = s.startsWith('next ') ? s.slice(5).trim() : s;
  const wdayTarget = WDAY.indexOf(wdayWord);

  if (wdayTarget !== -1) {
    const d    = new Date(now);
    const cur  = d.getDay();
    const diff = (((wdayTarget % 7) - cur + 7) % 7) || 7;
    d.setDate(d.getDate() + diff);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }

  return null; // unrecognised — caller shows error
}

/**
 * Format a deadline ISO string for display.
 * Shows date + time if time component is non-zero.
 */
function _fmtDeadline(iso) {
  if (!iso) return 'None';
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  return hasTime
    ? `${dateStr} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
    : dateStr;
}

/** Status emoji map. */
const STATUS_EMOJI = {
  open:      '⚪',
  ongoing:   '🔵',
  completed: '✅',
  closed:    '🔒'
};

/** Priority emoji map. */
const PRIORITY_EMOJI = {
  low:      '🟢',
  medium:   '🟡',
  high:     '🟠',
  critical: '🔴'
};

// ─── Slash command definition ─────────────────────────────────────────────────

module.exports = {
  name:        'task',
  description: 'Create and manage tasks with assignees, deadlines, and priority',

  data: new SlashCommandBuilder()
    .setName('task')
    .setDescription('Create and manage tasks with assignees, deadlines, and priority')

    // create ───────────────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Create a new task')
        .addStringOption(opt =>
          opt.setName('title').setDescription('Task title').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('description').setDescription('Task description').setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('priority')
            .setDescription('Priority level (default: medium)')
            .setRequired(false)
            .addChoices(
              { name: '🟢 Low',      value: 'low'      },
              { name: '🟡 Medium',   value: 'medium'   },
              { name: '🟠 High',     value: 'high'     },
              { name: '🔴 Critical', value: 'critical' }
            )
        )
    )

    // update ───────────────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('update')
        .setDescription('Update task title, description, or priority')
        .addStringOption(opt =>
          opt.setName('ref').setDescription('Task title or ID (e.g. T1)').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('title').setDescription('New title').setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('description').setDescription('New description').setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('priority')
            .setDescription('New priority')
            .setRequired(false)
            .addChoices(
              { name: '🟢 Low',      value: 'low'      },
              { name: '🟡 Medium',   value: 'medium'   },
              { name: '🟠 High',     value: 'high'     },
              { name: '🔴 Critical', value: 'critical' }
            )
        )
    )

    // delete ───────────────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('delete')
        .setDescription('Delete a task permanently')
        .addStringOption(opt =>
          opt.setName('ref').setDescription('Task title or ID (e.g. T1)').setRequired(true)
        )
    )

    // list ─────────────────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List all tasks, optionally filtered by status')
        .addStringOption(opt =>
          opt.setName('filter')
            .setDescription('Filter by status (default: all)')
            .setRequired(false)
            .addChoices(
              { name: 'All',       value: 'all'       },
              { name: '⚪ Open',    value: 'open'      },
              { name: '🔵 Ongoing', value: 'ongoing'   },
              { name: '✅ Completed', value: 'completed' },
              { name: '🔒 Closed', value: 'closed'    }
            )
        )
    )

    // delegate ─────────────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('delegate')
        .setDescription('Delegate task: assign people + set deadline — status becomes Ongoing')
        .addStringOption(opt =>
          opt.setName('ref').setDescription('Task title or ID (e.g. T1)').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('assignees')
            .setDescription('Assignee(s) — comma-separated for multiple (e.g. "@alice, @bob")')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('deadline')
            .setDescription('Deadline — 1d–9d, 1w–9w, tomorrow, next mon–sun, or YYYY-MM-DD')
            .setRequired(true)
        )
    )

    // undelegate ───────────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('undelegate')
        .setDescription('Undelegate task — no params removes all assignees + deadline, or update specific fields')
        .addStringOption(opt =>
          opt.setName('ref').setDescription('Task title or ID (e.g. T1)').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('assignees')
            .setDescription('New assignee(s), or "none" to clear')
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('deadline')
            .setDescription('New deadline or "none" to clear — 1d–9d, 1w–9w, tomorrow, mon–sun, YYYY-MM-DD')
            .setRequired(false)
        )
    )

    // status ───────────────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Set the status of a task')
        .addStringOption(opt =>
          opt.setName('ref').setDescription('Task title or ID (e.g. T1)').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('value')
            .setDescription('New status')
            .setRequired(true)
            .addChoices(
              { name: '⚪ Open',       value: 'open'      },
              { name: '🔵 Ongoing',    value: 'ongoing'   },
              { name: '✅ Completed',  value: 'completed' },
              { name: '🔒 Closed',     value: 'closed'    }
            )
        )
    )

    // settings ─────────────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('settings')
        .setDescription('View or update global task notification settings')
        .addStringOption(opt =>
          opt.setName('notifyonassignment')
            .setDescription('Notify when a task is assigned (default: true)')
            .setRequired(false)
            .addChoices(
              { name: 'true  — notify on assignment',  value: 'true'  },
              { name: 'false — silent on assignment',  value: 'false' }
            )
        )
        .addStringOption(opt =>
          opt.setName('notifyneardeadline')
            .setDescription('How far before a deadline to notify (e.g. "1d", "3d". default: 3d)')
            .setRequired(false)
        )
    )

    // link ─────────────────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('link')
        .setDescription('Link a task to a GitHub issue number')
        .addStringOption(opt =>
          opt.setName('ref').setDescription('Task title or ID (e.g. T1)').setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('issue').setDescription('Issue number (e.g. #123)').setRequired(true)
        )
    )

    // sync ─────────────────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub.setName('sync').setDescription('Sync tasks with the external issue tracker')
    ),

  // ─── Dispatch ─────────────────────────────────────────────────────────────

  async run(interaction) {
    // Handle autocomplete for the deadline option (calendar-style suggestions)
    if (interaction.isAutocomplete()) {
      return this._autocompleteDeadline(interaction);
    }

    _init();
    const sub = interaction.options.getSubcommand();

    try {
      switch (sub) {
        case 'create':   return await this._create(interaction);
        case 'update':   return await this._update(interaction);
        case 'delete':   return await this._delete(interaction);
        case 'list':     return await this._list(interaction);
        case 'delegate':   return await this._delegate(interaction);
        case 'undelegate': return await this._undelegate(interaction);
        case 'status':   return await this._status(interaction);
        case 'settings': return await this._settings(interaction);
        case 'link':     return await this._link(interaction);
        case 'sync':     return await this._sync(interaction);
        default:
          await interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
      }
    } catch (err) {
      logger.error('task command error', { sub, error: err.message });
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: `❌ Error: ${err.message}` });
      } else {
        await interaction.reply({ content: `❌ Error: ${err.message}`, ephemeral: true });
      }
    }
  },

  // ─── autocomplete ─────────────────────────────────────────────────────────
  // Suggestions match the accepted deadline formats:
  //   next 7 calendar days, tomorrow, 1d–9d, 1w–9w.
  // Free-form YYYY-MM-DD is always accepted but not pre-listed.

  async _autocompleteDeadline(interaction) {
    const typed    = (interaction.options.getFocused() || '').toLowerCase().trim();
    const now      = new Date();
    const pad      = n => String(n).padStart(2, '0');
    const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    // Next 7 calendar days as concrete date suggestions
    const calDays = [];
    for (let i = 1; i <= 7; i++) {
      const d     = new Date(now);
      d.setDate(d.getDate() + i);
      const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      calDays.push({
        name:  `${DAY_NAMES[d.getDay()]}  ${dateStr}`,
        value: dateStr
      });
    }

    // tomorrow shorthand
    const tmrDate = new Date(now);
    tmrDate.setDate(tmrDate.getDate() + 1);
    const tomorrow = {
      name:  `tomorrow  (${tmrDate.getFullYear()}-${pad(tmrDate.getMonth()+1)}-${pad(tmrDate.getDate())})`,
      value: 'tomorrow'
    };

    // 1d–9d
    const dOpts = [];
    for (let n = 1; n <= 9; n++) {
      dOpts.push({ name: `${n}d  — ${n} day${n > 1 ? 's' : ''} from now`, value: `${n}d` });
    }

    // 1w–9w
    const wOpts = [];
    for (let n = 1; n <= 9; n++) {
      wOpts.push({ name: `${n}w  — ${n} week${n > 1 ? 's' : ''} from now`, value: `${n}w` });
    }

    const all = [...calDays, tomorrow, ...dOpts, ...wOpts];

    const filtered = typed
      ? all.filter(c =>
          c.value.startsWith(typed) ||
          c.name.toLowerCase().startsWith(typed)
        )
      : all;

    await interaction.respond(filtered.slice(0, 25));
  },

  // ─── create ───────────────────────────────────────────────────────────────

  async _create(interaction) {
    const title       = interaction.options.getString('title').trim();
    const description = interaction.options.getString('description')?.trim() ?? '';
    const priority    = interaction.options.getString('priority') ?? 'medium';

    const tid = _nextId();
    const task = {
      tid,
      title,
      description,
      priority,
      assignees:   [],
      deadline:    null,
      status:      'open',
      linkedIssue: null,
      settings: {
        notifyOnAssignment: true,
        notifyNearDeadline: '3d'
      },
      created:   new Date().toISOString(),
      updated:   new Date().toISOString(),
      createdBy: interaction.user.tag
    };

    storage.append(TASKS_FILE, task, TASKS_KEY);
    logger.command('task create', interaction.user.tag, true, { tid, title });

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('📋 Task Created')
      .addFields(
        { name: 'ID',          value: `\`${tid}\``,                         inline: true },
        { name: 'Priority',    value: `${PRIORITY_EMOJI[priority]} ${priority}`, inline: true },
        { name: 'Status',      value: `${STATUS_EMOJI.open} open`,           inline: true },
        { name: 'Title',       value: title,                                  inline: false }
      )
      .setFooter({ text: `Use /task delegate ${tid} <assignees> <deadline> to assign` })
      .setTimestamp();

    if (description) {
      embed.addFields({ name: 'Description', value: description.slice(0, 1024), inline: false });
    }

    await interaction.reply({ embeds: [embed] });
  },

  // ─── update ───────────────────────────────────────────────────────────────

  async _update(interaction) {
    const ref         = interaction.options.getString('ref').trim();
    const newTitle    = interaction.options.getString('title')?.trim()       ?? null;
    const description = interaction.options.getString('description')?.trim() ?? null;
    const priority    = interaction.options.getString('priority')             ?? null;

    const task = _resolve(ref);
    if (!task) {
      await interaction.reply({ content: `❌ No task found for: \`${ref}\``, ephemeral: true });
      return;
    }

    if (!newTitle && description === null && !priority) {
      await interaction.reply({
        content: '❌ Provide at least one of `title`, `description`, or `priority`.',
        ephemeral: true
      });
      return;
    }

    const updates = {};
    const changed = [];

    if (newTitle) {
      updates.title = newTitle;
      changed.push(`Title → **"${newTitle}"**`);
    }
    if (description !== null) {
      updates.description = description;
      changed.push(`Description updated`);
    }
    if (priority) {
      updates.priority = priority;
      changed.push(`Priority → ${PRIORITY_EMOJI[priority]} **${priority}**`);
    }

    _save(task.tid, updates);
    logger.command('task update', interaction.user.tag, true, { tid: task.tid });

    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle('📋 Task Updated')
      .addFields(
        { name: 'ID',      value: `\`${task.tid}\``,  inline: true },
        { name: 'Changes', value: changed.join('\n'),  inline: false }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },

  // ─── delete ───────────────────────────────────────────────────────────────

  async _delete(interaction) {
    const ref = interaction.options.getString('ref').trim();
    const task = _resolve(ref);

    if (!task) {
      await interaction.reply({ content: `❌ No task found for: \`${ref}\``, ephemeral: true });
      return;
    }

    storage.removeById(TASKS_FILE, task.tid, TASKS_KEY, 'tid');
    logger.command('task delete', interaction.user.tag, true, { tid: task.tid, title: task.title });

    await interaction.reply({
      content: `🗑️ Deleted task \`${task.tid}\` — **"${task.title}"**`,
      ephemeral: false
    });
  },

  // ─── list ─────────────────────────────────────────────────────────────────

  async _list(interaction) {
    const filter = interaction.options.getString('filter') ?? 'all';
    let tasks = storage.list(TASKS_FILE, TASKS_KEY);

    if (filter !== 'all') {
      tasks = tasks.filter(t => t.status === filter);
    }

    if (tasks.length === 0) {
      await interaction.reply({
        content: filter === 'all'
          ? '📋 No tasks yet. Use `/task create <title>` to get started.'
          : `📋 No tasks with status **${filter}**.`,
        ephemeral: true
      });
      return;
    }

    const lines = tasks.map(t => {
      const se = STATUS_EMOJI[t.status]   || '⚪';
      const pe = PRIORITY_EMOJI[t.priority] || '🟡';
      const assignStr = t.assignees?.length ? ` 👤 ${t.assignees.join(', ')}` : '';
      const dlStr     = t.deadline          ? ` 📅 ${_fmtDeadline(t.deadline)}` : '';
      return `${se}${pe} \`${t.tid}\` **${t.title}**${assignStr}${dlStr}`;
    });

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📋 Tasks${filter !== 'all' ? ` — ${filter}` : ''} (${tasks.length})`)
      .setDescription(lines.join('\n').slice(0, 4000))
      .setFooter({ text: 'Use /task status <ref> <value> to update a task status' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },

  // ─── delegate ─────────────────────────────────────────────────────────────
  // Delegates the task: assigns people + deadline → status → "ongoing".

  async _delegate(interaction) {
    const ref         = interaction.options.getString('ref').trim();
    const assigneesRaw = interaction.options.getString('assignees').trim();
    const deadlineRaw  = interaction.options.getString('deadline').trim();

    const task = _resolve(ref);
    if (!task) {
      await interaction.reply({ content: `❌ No task found for: \`${ref}\``, ephemeral: true });
      return;
    }

    // Parse assignees — comma or semicolon separated
    const assignees = assigneesRaw
      .split(/[,;]+/)
      .map(a => a.trim())
      .filter(Boolean);

    // Parse deadline
    const deadline = _parseDeadline(deadlineRaw);
    if (!deadline) {
      await interaction.reply({
        content: `❌ Could not parse deadline: **"${deadlineRaw}"**\n` +
                 'Accepted: `1d`–`9d`, `1w`–`9w`, `tomorrow`, `mon`–`sun`, `next fri`, `YYYY-MM-DD`',
        ephemeral: true
      });
      return;
    }

    _save(task.tid, {
      assignees,
      deadline,
      status: 'ongoing'   // automatically set when assigned
    });

    logger.command('task delegate', interaction.user.tag, true, { tid: task.tid, assignees });

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📋 Task Delegated')
      .addFields(
        { name: 'ID',        value: `\`${task.tid}\``,         inline: true },
        { name: 'Status',    value: `${STATUS_EMOJI.ongoing} ongoing`, inline: true },
        { name: 'Title',     value: task.title,                 inline: false },
        { name: 'Assignees', value: assignees.join(', '),       inline: true  },
        { name: 'Deadline',  value: _fmtDeadline(deadline),     inline: true  }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },

  // ─── undelegate ───────────────────────────────────────────────────────────
  // No extra params → remove all assignees, clear deadline, status → "open".
  // With params → update only the supplied fields.

  async _undelegate(interaction) {
    const ref          = interaction.options.getString('ref').trim();
    const assigneesRaw = interaction.options.getString('assignees') ?? null;
    const deadlineRaw  = interaction.options.getString('deadline')  ?? null;

    const task = _resolve(ref);
    if (!task) {
      await interaction.reply({ content: `❌ No task found for: \`${ref}\``, ephemeral: true });
      return;
    }

    const updates = {};
    const changed = [];

    const hasParams = assigneesRaw !== null || deadlineRaw !== null;

    if (!hasParams) {
      // Full reset
      updates.assignees = [];
      updates.deadline  = null;
      updates.status    = 'open';
      changed.push('Assignees removed', 'Deadline cleared', 'Status → ⚪ open');
    } else {
      // Partial reset / update
      if (assigneesRaw !== null) {
        if (assigneesRaw.toLowerCase() === 'none') {
          updates.assignees = [];
          changed.push('Assignees cleared');
        } else {
          updates.assignees = assigneesRaw.split(/[,;]+/).map(a => a.trim()).filter(Boolean);
          changed.push(`Assignees → ${updates.assignees.join(', ')}`);
        }
      }
      if (deadlineRaw !== null) {
        if (deadlineRaw.toLowerCase() === 'none') {
          updates.deadline = null;
          changed.push('Deadline cleared');
        } else {
          const dl = _parseDeadline(deadlineRaw);
          if (!dl) {
            await interaction.reply({
              content: `❌ Could not parse deadline: **"${deadlineRaw}"**\n` +
                       'Accepted: `1d`–`9d`, `1w`–`9w`, `tomorrow`, `mon`–`sun`, `next fri`, `YYYY-MM-DD`',
              ephemeral: true
            });
            return;
          }
          updates.deadline = dl;
          changed.push(`Deadline → ${_fmtDeadline(dl)}`);
        }
      }
    }

    _save(task.tid, updates);
    logger.command('task undelegate', interaction.user.tag, true, { tid: task.tid, hasParams });

    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle('📋 Task Undelegated')
      .addFields(
        { name: 'ID',      value: `\`${task.tid}\``,  inline: true },
        { name: 'Changes', value: changed.join('\n'),  inline: false }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },

  // ─── status ───────────────────────────────────────────────────────────────

  async _status(interaction) {
    const ref    = interaction.options.getString('ref').trim();
    const status = interaction.options.getString('value');

    const task = _resolve(ref);
    if (!task) {
      await interaction.reply({ content: `❌ No task found for: \`${ref}\``, ephemeral: true });
      return;
    }

    _save(task.tid, { status });
    logger.command('task status', interaction.user.tag, true, { tid: task.tid, status });

    await interaction.reply({
      content: `${STATUS_EMOJI[status]} Task \`${task.tid}\` — **"${task.title}"** → **${status}**`,
      ephemeral: false
    });
  },

  // ─── settings ─────────────────────────────────────────────────────────────
  // Global task notification settings — no ref required.
  // Stored encrypted in task-settings.enc.
  // Called with no args → show current values.
  // Called with args → update and persist.

  async _settings(interaction) {
    const noa = interaction.options.getString('notifyonassignment') ?? null;
    const nnd = interaction.options.getString('notifyneardeadline') ?? null;

    if (noa === null && nnd === null) {
      // Show current global settings
      const s = _loadGlobalSettings();
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('⚙️ Task Notification Settings')
        .setDescription('These settings apply globally to all tasks.')
        .addFields(
          {
            name:   'notifyOnAssignment',
            value:  `\`${s.notifyOnAssignment}\`  — notify Discord when a task is delegated`,
            inline: false
          },
          {
            name:   'notifyNearDeadline',
            value:  `\`${s.notifyNearDeadline}\`  — how far before a deadline to send a reminder`,
            inline: false
          }
        )
        .setFooter({ text: 'Use /task settings notifyOnAssignment:true/false to change' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // Apply updates
    const updates  = {};
    const changed  = [];

    if (noa !== null) {
      updates.notifyOnAssignment = noa === 'true';
      changed.push(`notifyOnAssignment → \`${noa}\``);
    }
    if (nnd !== null) {
      updates.notifyNearDeadline = nnd;
      changed.push(`notifyNearDeadline → \`${nnd}\``);
    }

    const saved = _saveGlobalSettings(updates);
    logger.command('task settings', interaction.user.tag, true, updates);

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('⚙️ Task Settings Updated')
      .addFields(
        { name: 'Changes',              value: changed.join('\n'),                      inline: false },
        { name: 'notifyOnAssignment',   value: `\`${saved.notifyOnAssignment}\``,       inline: true  },
        { name: 'notifyNearDeadline',   value: `\`${saved.notifyNearDeadline}\``,       inline: true  }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: false });
  },

  // ─── link ─────────────────────────────────────────────────────────────────

  async _link(interaction) {
    const ref   = interaction.options.getString('ref').trim();
    const issue = interaction.options.getString('issue').trim();

    const task = _resolve(ref);
    if (!task) {
      await interaction.reply({ content: `❌ No task found for: \`${ref}\``, ephemeral: true });
      return;
    }

    _save(task.tid, { linkedIssue: issue });
    logger.command('task link', interaction.user.tag, true, { tid: task.tid, issue });

    await interaction.reply({
      content: `🔗 Task \`${task.tid}\` linked to issue **${issue}**`,
      ephemeral: false
    });
  },

  // ─── sync ─────────────────────────────────────────────────────────────────

  async _sync(interaction) {
    await interaction.reply({
      content: '🔄 Task sync is not yet implemented.',
      ephemeral: true
    });
  }
};
