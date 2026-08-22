/**
 * commands/note.js
 *
 * /note — personal note management.
 *
 * Every note has a plain numeric ID: N1, N2, … N99999 (no zero-padding).
 * All lookup subcommands accept either the ID or the title (case-insensitive).
 *
 * Storage: data/notes/notes.json  (plain JSON, array of Note objects)
 *
 * Note schema:
 *   {
 *     nid:       "N1",            // auto-generated, unique, e.g. N1 / N42 / N999
 *     title:     "Meeting notes", // human-readable name
 *     content:   string[],        // lines of text
 *     created:   ISO string,
 *     updated:   ISO string,
 *     createdBy: "user#0000"
 *   }
 *
 * Subcommands
 * ───────────
 *   insert <title> [content]
 *       Create a note.  If a note with that title already exists,
 *       OVERWRITE its content — keeping the same ID and created date.
 *
 *   append <title> [content]
 *       If the title exists: append content lines to the END of that note.
 *       If not found: create a new note (identical to insert for new titles).
 *
 *   read   <title | id>       — display full note contents
 *   update <title | id>       — rename title or replace content
 *
 *   list   [view]
 *       full    (default) — ID, title, line count, first-line preview
 *       compact           — ID and title only
 *
 *   search <keyword>          — search titles and content, show matching lines
 *   remove <title | id>       — delete a specific note by title or ID
 *
 *   push   [content]
 *       Add a new note entry to the END of the list.
 *       Title is auto-generated as "note-YYYYMMDD-HHmmss".
 *       Content is optional.
 *
 *   pop
 *       Delete the LAST note entry in the list (no ref needed — stack-style).
 *
 *   export <title | id>       — download note as a .txt file attachment
 */

'use strict';

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const storage = require('../utils/storage');
const logger  = require('../utils/logger');

const NOTES_FILE = 'notes/notes.json';
const NOTES_KEY  = 'notes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Ensure the notes file exists with a valid default structure. */
function _init() {
  storage.initializeIfMissing(NOTES_FILE, { notes: [], nextId: 1 });
}

/**
 * Resolve title-or-ID to a note object.
 *
 * ID format: N1, N2, … N99999 (no zero-padding).
 * Matching is case-insensitive for both ID and title.
 *
 * @param {string} ref  e.g. "n1", "N42", "My note title"
 * @returns {{ note: object|null }}
 */
function _resolve(ref) {
  const notes = storage.list(NOTES_FILE, NOTES_KEY);
  const upper = ref.trim().toUpperCase();

  // Try ID match first (e.g. "n1" matches note with nid "N1")
  let note = notes.find(n => n.nid?.toUpperCase() === upper);

  // Fall back to case-insensitive title match
  if (!note) {
    note = notes.find(n => n.title?.toLowerCase() === ref.trim().toLowerCase());
  }

  return { note: note ?? null };
}

/**
 * Persist updated fields for a note back to disk.
 * Always stamps the current time as `updated`.
 */
function _save(nid, updates) {
  return storage.updateById(NOTES_FILE, nid, {
    ...updates,
    updated: new Date().toISOString()
  }, NOTES_KEY, 'nid');
}

/**
 * Generate a pseudo-title for push entries.
 * Format: note-YYYYMMDD-HHmmss
 */
function _pseudoTitle() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `note-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * Generate the next note ID in the format N1, N2, … N99999.
 * Does NOT zero-pad — IDs are plain numeric: N1, N12, N999.
 *
 * Reads and bumps the `nextId` counter in the notes file directly
 * so we never call storage.getNextId() (which pads to 3 digits).
 *
 * @returns {string}  e.g. "N1", "N42", "N99999"
 */
function _nextId() {
  const data = storage.read(NOTES_FILE, { notes: [], nextId: 1 });
  const next = data.nextId || 1;
  data.nextId = next + 1;
  storage.write(NOTES_FILE, data);
  return `N${next}`;
}

// ─── Slash command definition ─────────────────────────────────────────────────

module.exports = {
  name:        'note',
  description: 'Create and manage personal notes',

  data: new SlashCommandBuilder()
    .setName('note')
    .setDescription('Create and manage personal notes')

    // insert ───────────────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('insert')
        .setDescription('Create a note — overwrites existing note with the same title')
        .addStringOption(opt =>
          opt.setName('title')
            .setDescription('Note title')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('content')
            .setDescription('Content (use \\n for multiple lines, optional)')
            .setRequired(false)
        )
    )

    // append ───────────────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('append')
        .setDescription('Append content to an existing note, or create it if it does not exist')
        .addStringOption(opt =>
          opt.setName('title')
            .setDescription('Note title')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('content')
            .setDescription('Content to append (use \\n for multiple lines, optional)')
            .setRequired(false)
        )
    )

    // read ─────────────────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('read')
        .setDescription('Read a note by title or ID')
        .addStringOption(opt =>
          opt.setName('ref')
            .setDescription('Note title or ID (e.g. N001)')
            .setRequired(true)
        )
    )

    // update ───────────────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('update')
        .setDescription('Rename a note or fully replace its content')
        .addStringOption(opt =>
          opt.setName('ref')
            .setDescription('Note title or ID (e.g. N001)')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('title')
            .setDescription('New title (leave blank to keep current)')
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('content')
            .setDescription('Replace entire content (use \\n for lines, leave blank to keep current)')
            .setRequired(false)
        )
    )

    // list ─────────────────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List all notes')
        .addStringOption(opt =>
          opt
            .setName('view')
            .setDescription('How much detail to show (default: full)')
            .setRequired(false)
            .addChoices(
              { name: 'full    — ID, title, and content preview', value: 'full'    },
              { name: 'compact — ID and title only',              value: 'compact' }
            )
        )
    )

    // search ───────────────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('search')
        .setDescription('Search notes by keyword')
        .addStringOption(opt =>
          opt.setName('keyword')
            .setDescription('Keyword to search in titles and content')
            .setRequired(true)
        )
    )

    // remove ───────────────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Delete a specific note by title or ID')
        .addStringOption(opt =>
          opt.setName('ref')
            .setDescription('Note title or ID (e.g. N001)')
            .setRequired(true)
        )
    )

    // push ─────────────────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('push')
        .setDescription('Push a new note entry with an auto-generated title')
        .addStringOption(opt =>
          opt.setName('content')
            .setDescription('Content for the new note entry (use \\n for multiple lines, optional)')
            .setRequired(false)
        )
    )

    // pop ──────────────────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub.setName('pop').setDescription('Delete the last note entry in the list')
    )

    // export ───────────────────────────────────────────────────────────────
    .addSubcommand(sub =>
      sub
        .setName('export')
        .setDescription('Export a note as a .txt file attachment')
        .addStringOption(opt =>
          opt.setName('ref')
            .setDescription('Note title or ID (e.g. N001)')
            .setRequired(true)
        )
    ),

  // ─── Dispatch ─────────────────────────────────────────────────────────────

  async run(interaction) {
    _init();

    const sub = interaction.options.getSubcommand();

    try {
      switch (sub) {
        case 'insert': return await this._insert(interaction);
        case 'append': return await this._append(interaction);
        case 'read':   return await this._read(interaction);
        case 'update': return await this._update(interaction);
        case 'list':   return await this._list(interaction);
        case 'search': return await this._search(interaction);
        case 'remove': return await this._remove(interaction);
        case 'push':   return await this._push(interaction);
        case 'pop':    return await this._pop(interaction);
        case 'export': return await this._export(interaction);
        default:
          await interaction.reply({ content: '❌ Unknown subcommand.', ephemeral: true });
      }
    } catch (err) {
      logger.error('note command error', { sub, error: err.message });
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: `❌ Error: ${err.message}` });
      } else {
        await interaction.reply({ content: `❌ Error: ${err.message}`, ephemeral: true });
      }
    }
  },

  // ─── insert ───────────────────────────────────────────────────────────────
  // Create a note. If the title already exists → overwrite its content.

  async _insert(interaction) {
    const title      = interaction.options.getString('title').trim();
    const rawContent = interaction.options.getString('content') ?? '';
    const content    = rawContent ? rawContent.split('\\n') : [];

    const { note: existing } = _resolve(title);

    if (existing) {
      // Overwrite — keep the same nid and created date, replace content
      _save(existing.nid, { content });
      logger.command('note insert', interaction.user.tag, true, { nid: existing.nid, action: 'overwrite' });

      const embed = new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle('📝 Note Overwritten')
        .addFields(
          { name: 'ID',    value: `\`${existing.nid}\``,   inline: true },
          { name: 'Title', value: existing.title,            inline: true },
          { name: 'Lines', value: `${content.length}`,       inline: true }
        )
        .setFooter({ text: `Previous content replaced — ID ${existing.nid} retained` })
        .setTimestamp();

      if (content.length > 0) {
        embed.addFields({ name: 'New Content', value: `\`\`\`\n${content.join('\n').slice(0, 900)}\n\`\`\``, inline: false });
      }

      await interaction.reply({ embeds: [embed] });

    } else {
      // New note
      const nid  = _nextId();
      const note = {
        nid,
        title,
        content,
        created:   new Date().toISOString(),
        updated:   new Date().toISOString(),
        createdBy: interaction.user.tag
      };

      storage.append(NOTES_FILE, note, NOTES_KEY);
      logger.command('note insert', interaction.user.tag, true, { nid, title, action: 'create' });

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('📝 Note Created')
        .addFields(
          { name: 'ID',    value: `\`${nid}\``,          inline: true },
          { name: 'Title', value: title,                   inline: true },
          { name: 'Lines', value: `${content.length}`,     inline: true }
        )
        .setFooter({ text: `Use /note append "${title}" <text> to add more lines` })
        .setTimestamp();

      if (content.length > 0) {
        embed.addFields({ name: 'Content', value: `\`\`\`\n${content.join('\n').slice(0, 900)}\n\`\`\``, inline: false });
      }

      await interaction.reply({ embeds: [embed] });
    }
  },

  // ─── append ───────────────────────────────────────────────────────────────
  // Append to an existing note. Create a new one if the title does not exist.

  async _append(interaction) {
    const title      = interaction.options.getString('title').trim();
    const rawContent = interaction.options.getString('content') ?? '';
    const newLines   = rawContent ? rawContent.split('\\n') : [];

    const { note: existing } = _resolve(title);

    if (existing) {
      // Append to the end of the existing note's content
      const updated = [...existing.content, ...newLines];
      _save(existing.nid, { content: updated });
      logger.command('note append', interaction.user.tag, true, { nid: existing.nid, lines: newLines.length });

      await interaction.reply({
        content: `✅ Appended **${newLines.length}** line(s) to \`${existing.nid}\` — **"${existing.title}"**\nTotal lines: **${updated.length}**`,
        ephemeral: false
      });

    } else {
      // Note not found — create it (same behaviour as insert for new titles)
      const nid  = _nextId();
      const note = {
        nid,
        title,
        content:   newLines,
        created:   new Date().toISOString(),
        updated:   new Date().toISOString(),
        createdBy: interaction.user.tag
      };

      storage.append(NOTES_FILE, note, NOTES_KEY);
      logger.command('note append', interaction.user.tag, true, { nid, title, action: 'create' });

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('📝 Note Created')
        .setDescription(`*No note titled **"${title}"** existed — a new one was created.*`)
        .addFields(
          { name: 'ID',    value: `\`${nid}\``,        inline: true },
          { name: 'Title', value: title,                 inline: true },
          { name: 'Lines', value: `${newLines.length}`,  inline: true }
        )
        .setTimestamp();

      if (newLines.length > 0) {
        embed.addFields({ name: 'Content', value: `\`\`\`\n${newLines.join('\n').slice(0, 900)}\n\`\`\``, inline: false });
      }

      await interaction.reply({ embeds: [embed] });
    }
  },

  // ─── read ─────────────────────────────────────────────────────────────────

  async _read(interaction) {
    const ref = interaction.options.getString('ref').trim();
    const { note } = _resolve(ref);

    if (!note) {
      await interaction.reply({ content: `❌ No note found for: \`${ref}\``, ephemeral: true });
      return;
    }

    const body      = note.content.length > 0 ? note.content.join('\n') : '*(empty note)*';
    const truncated = body.length > 100 ? body.slice(0, 100) + '…' : body;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📝 ${note.title}`)
      .setDescription(`\`\`\`\n${truncated}\n\`\`\``)
      .addFields(
        { name: 'ID',      value: `\`${note.nid}\``,                        inline: true },
        { name: 'Lines',   value: `${note.content.length}`,                  inline: true },
        { name: 'Updated', value: new Date(note.updated).toLocaleString(),   inline: true }
      )
      .setFooter({ text: `Created by ${note.createdBy}` })
      .setTimestamp(new Date(note.created));

    await interaction.reply({ embeds: [embed] });
  },

  // ─── update ───────────────────────────────────────────────────────────────

  async _update(interaction) {
    const ref        = interaction.options.getString('ref').trim();
    const newTitle   = interaction.options.getString('title')?.trim() ?? null;
    const rawContent = interaction.options.getString('content')       ?? null;

    const { note } = _resolve(ref);
    if (!note) {
      await interaction.reply({ content: `❌ No note found for: \`${ref}\``, ephemeral: true });
      return;
    }

    if (!newTitle && rawContent === null) {
      await interaction.reply({
        content: '❌ Provide at least one of `title` or `content` to update.',
        ephemeral: true
      });
      return;
    }

    const updates = {};
    const changed = [];

    if (newTitle && newTitle !== note.title) {
      const { note: conflict } = _resolve(newTitle);
      if (conflict && conflict.nid !== note.nid) {
        await interaction.reply({
          content: `❌ A note titled **"${newTitle}"** already exists (\`${conflict.nid}\`).`,
          ephemeral: true
        });
        return;
      }
      updates.title = newTitle;
      changed.push(`Title → **"${newTitle}"**`);
    }

    if (rawContent !== null) {
      updates.content = rawContent.split('\\n');
      changed.push(`Content replaced (${updates.content.length} line(s))`);
    }

    _save(note.nid, updates);
    logger.command('note update', interaction.user.tag, true, { nid: note.nid });

    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle('📝 Note Updated')
      .addFields(
        { name: 'ID',      value: `\`${note.nid}\``,  inline: true },
        { name: 'Changes', value: changed.join('\n'),  inline: false }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },

  // ─── list ─────────────────────────────────────────────────────────────────
  // view=full (default) — shows ID, title, and first-line content preview
  // view=compact        — shows ID and title only (no content preview)

  async _list(interaction) {
    const notes = storage.list(NOTES_FILE, NOTES_KEY);
    const view  = interaction.options.getString('view') ?? 'full';

    if (notes.length === 0) {
      await interaction.reply({
        content: '📝 No notes yet. Use `/note insert <title>` to create one.',
        ephemeral: true
      });
      return;
    }

    const lines = notes.map(n => {
      if (view === 'compact') {
        // compact: just ID and title
        return `\`${n.nid}\` **${n.title}**`;
      }

      // full: ID, title, line count, and first-line preview
      const preview = n.content[0]
        ? `  *${n.content[0].slice(0, 60)}${n.content[0].length > 60 ? '…' : ''}*`
        : '';
      return `\`${n.nid}\` **${n.title}** — ${n.content.length} line(s)${preview}`;
    });

    const footerText = view === 'compact'
      ? 'Use /note read <id> to view contents'
      : 'Use /note read <id> to view a note  ·  /note list view:compact for ID+title only';

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📝 Notes (${notes.length})`)
      .setDescription(lines.join('\n').slice(0, 4000))
      .setFooter({ text: footerText })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },

  // ─── search ───────────────────────────────────────────────────────────────

  async _search(interaction) {
    const keyword = interaction.options.getString('keyword').trim().toLowerCase();
    const notes   = storage.list(NOTES_FILE, NOTES_KEY);

    const results = notes.filter(n => {
      const inTitle   = n.title.toLowerCase().includes(keyword);
      const inContent = n.content.some(l => l.toLowerCase().includes(keyword));
      return inTitle || inContent;
    });

    if (results.length === 0) {
      await interaction.reply({ content: `🔍 No notes match: **"${keyword}"**`, ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🔍 Search: "${keyword}" — ${results.length} result(s)`)
      .setDescription(
        results
          .map(n => {
            const hits = n.content
              .filter(l => l.toLowerCase().includes(keyword))
              .slice(0, 2)
              .map(l => `  *…${l.slice(0, 80)}…*`);
            return `\`${n.nid}\` **${n.title}**\n${hits.join('\n')}`;
          })
          .join('\n\n')
          .slice(0, 4000)
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },

  // ─── remove ───────────────────────────────────────────────────────────────

  async _remove(interaction) {
    const ref = interaction.options.getString('ref').trim();
    const { note } = _resolve(ref);

    if (!note) {
      await interaction.reply({ content: `❌ No note found for: \`${ref}\``, ephemeral: true });
      return;
    }

    storage.removeById(NOTES_FILE, note.nid, NOTES_KEY, 'nid');
    logger.command('note remove', interaction.user.tag, true, { nid: note.nid });

    await interaction.reply({
      content: `🗑️ Deleted note \`${note.nid}\` — **"${note.title}"**`,
      ephemeral: false
    });
  },

  // ─── push ─────────────────────────────────────────────────────────────────
  // Push a brand-new note entry onto the list with an auto-generated title.

  async _push(interaction) {
    const rawContent = interaction.options.getString('content') ?? '';
    const content    = rawContent ? rawContent.split('\\n') : [];
    const title      = _pseudoTitle();
    const nid        = _nextId();

    const note = {
      nid,
      title,
      content,
      created:   new Date().toISOString(),
      updated:   new Date().toISOString(),
      createdBy: interaction.user.tag
    };

    storage.append(NOTES_FILE, note, NOTES_KEY);
    logger.command('note push', interaction.user.tag, true, { nid, title });

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('📝 Note Pushed')
      .setDescription('A new note entry was added to the end of the list.')
      .addFields(
        { name: 'ID',    value: `\`${nid}\``,        inline: true },
        { name: 'Title', value: `\`${title}\``,       inline: true },
        { name: 'Lines', value: `${content.length}`,  inline: true }
      )
      .setFooter({ text: 'Use /note pop to remove the last entry' })
      .setTimestamp();

    if (content.length > 0) {
      embed.addFields({ name: 'Content', value: `\`\`\`\n${content.join('\n').slice(0, 900)}\n\`\`\``, inline: false });
    }

    await interaction.reply({ embeds: [embed] });
  },

  // ─── pop ──────────────────────────────────────────────────────────────────
  // Delete the last note entry in the list (no ref needed).

  async _pop(interaction) {
    const notes = storage.list(NOTES_FILE, NOTES_KEY);

    if (notes.length === 0) {
      await interaction.reply({ content: '❌ No notes to pop — the list is empty.', ephemeral: true });
      return;
    }

    const last = notes[notes.length - 1];
    storage.removeById(NOTES_FILE, last.nid, NOTES_KEY, 'nid');
    logger.command('note pop', interaction.user.tag, true, { nid: last.nid, title: last.title });

    const remaining = storage.list(NOTES_FILE, NOTES_KEY).length;

    // Build content preview — show all lines, truncated to fit Discord embed
    const body      = last.content.length > 0 ? last.content.join('\n') : '*(empty note)*';
    const truncated = body.length > 100 ? body.slice(0, 100) + '…' : body;

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('🗑️ Note Popped')
      .addFields(
        { name: 'ID',       value: `\`${last.nid}\``,  inline: true },
        { name: 'Title',    value: last.title,           inline: true },
        { name: 'Lines',    value: `${last.content.length}`, inline: true },
        { name: 'Content',  value: `\`\`\`\n${truncated}\n\`\`\``, inline: false },
        { name: 'Remaining', value: `${remaining} note(s) left`, inline: false }
      )
      .setFooter({ text: `Deleted by ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: false });
  },

  // ─── export ───────────────────────────────────────────────────────────────

  async _export(interaction) {
    const ref = interaction.options.getString('ref').trim();
    const { note } = _resolve(ref);

    if (!note) {
      await interaction.reply({ content: `❌ No note found for: \`${ref}\``, ephemeral: true });
      return;
    }

    const fileContent = [
      `# ${note.title}`,
      `ID      : ${note.nid}`,
      `Created : ${new Date(note.created).toLocaleString()}`,
      `Updated : ${new Date(note.updated).toLocaleString()}`,
      `Author  : ${note.createdBy}`,
      '',
      '---',
      '',
      ...note.content
    ].join('\n');

    const safeTitle  = note.title.replace(/[^a-z0-9_-]/gi, '_');
    const filename   = `${note.nid}_${safeTitle}.txt`;
    const attachment = new AttachmentBuilder(Buffer.from(fileContent, 'utf8'), { name: filename });

    await interaction.reply({
      content:  `📄 Exported \`${note.nid}\` — **"${note.title}"** (${note.content.length} lines)`,
      files:    [attachment],
      ephemeral: false
    });

    logger.command('note export', interaction.user.tag, true, { nid: note.nid });
  }
};
