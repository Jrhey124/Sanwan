const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const storage = require('../utils/storage');
const logger = require('../utils/logger');

module.exports = {
  name: 'note',
  description: 'Manage notes and documentation',
  data: new SlashCommandBuilder()
    .setName('note')
    .setDescription('Create and manage notes')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Create a new note')
        .addStringOption(option =>
          option.setName('title')
            .setDescription('Note title')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('list').setDescription('List all notes')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('search')
        .setDescription('Search notes by keyword')
        .addStringOption(option =>
          option.setName('keyword')
            .setDescription('Search keyword')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Delete a note')
        .addStringOption(option =>
          option.setName('title')
            .setDescription('Note title')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('push')
        .setDescription('Add line(s) to a note')
        .addStringOption(option =>
          option.setName('title')
            .setDescription('Note title')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('content')
            .setDescription('Line(s) to add (use \\n for multiple lines)')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('pop')
        .setDescription('Remove last line from a note')
        .addStringOption(option =>
          option.setName('title')
            .setDescription('Note title')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('export')
        .setDescription('Export note as text file')
        .addStringOption(option =>
          option.setName('title')
            .setDescription('Note title')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View note contents')
        .addStringOption(option =>
          option.setName('title')
            .setDescription('Note title')
            .setRequired(true)
        )
    ),

  async run(interaction) {
    const subcommand = interaction.options.getSubcommand();

    // Initialize notes file
    storage.initializeIfMissing('notes/notes.json', {
      notes: [],
      nextId: 1
    });

    try {
      switch (subcommand) {
        case 'add':
          await this.addNote(interaction);
          break;
        case 'list':
          await this.listNotes(interaction);
          break;
        case 'search':
          await this.searchNotes(interaction);
          break;
        case 'remove':
          await this.removeNote(interaction);
          break;
        case 'push':
          await this.pushContent(interaction);
          break;
        case 'pop':
          await this.popContent(interaction);
          break;
        case 'export':
          await this.exportNote(interaction);
          break;
        case 'view':
          await this.viewNote(interaction);
          break;
        default:
          await interaction.reply({ content: '❌ Unknown subcommand', ephemeral: true });
      }
    } catch (error) {
      logger.error('Note command error', { subcommand, error: error.message });
      await interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
    }
  },

  async addNote(interaction) {
    const title = interaction.options.getString('title');

    // Check if note already exists
    const existing = storage.search('notes/notes.json', 'title', title, 'notes');
    if (existing.length > 0) {
      await interaction.reply({
        content: `❌ Note already exists: ${title}\nUse \`/note push\` to add content.`,
        ephemeral: true
      });
      return;
    }

    const nid = storage.getNextId('notes/notes.json', 'N');

    const note = {
      nid,
      title,
      content: [],
      tags: [],
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      createdBy: interaction.user.tag
    };

    storage.append('notes/notes.json', note, 'notes');
    logger.command('note add', interaction.user.tag, true, { nid, title });

    await interaction.reply({
      content: `✅ Note created: **${title}**\n**ID:** ${nid}\n\nUse \`/note push ${title} <content>\` to add lines.`,
      ephemeral: false
    });
  },

  async listNotes(interaction) {
    const notes = storage.list('notes/notes.json', 'notes');

    if (notes.length === 0) {
      await interaction.reply({ content: '📝 No notes found.', ephemeral: true });
      return;
    }

    const noteList = notes
      .map(note => {
        const lineCount = note.content.length;
        const preview = note.content[0] ? ` - ${note.content[0].substring(0, 50)}...` : '';
        return `📝 **${note.nid}** - ${note.title}\n   ${lineCount} line(s)${preview}`;
      })
      .join('\n\n');

    await interaction.reply({
      content: `📝 **Notes** (${notes.length} total)\n\n${noteList}`,
      ephemeral: false
    });
  },

  async searchNotes(interaction) {
    const keyword = interaction.options.getString('keyword');
    const notes = storage.list('notes/notes.json', 'notes');

    const results = notes.filter(note => {
      const titleMatch = note.title.toLowerCase().includes(keyword.toLowerCase());
      const contentMatch = note.content.some(line => 
        line.toLowerCase().includes(keyword.toLowerCase())
      );
      return titleMatch || contentMatch;
    });

    if (results.length === 0) {
      await interaction.reply({
        content: `🔍 No notes found matching: "${keyword}"`,
        ephemeral: true
      });
      return;
    }

    const resultList = results
      .map(note => `📝 **${note.nid}** - ${note.title}\n   ${note.content.length} line(s)`)
      .join('\n\n');

    await interaction.reply({
      content: `🔍 **Search Results** for "${keyword}" (${results.length} found)\n\n${resultList}`,
      ephemeral: false
    });
  },

  async removeNote(interaction) {
    const title = interaction.options.getString('title');
    const notes = storage.list('notes/notes.json', 'notes');

    const note = notes.find(n => n.title === title);
    if (!note) {
      await interaction.reply({ content: `❌ Note not found: ${title}`, ephemeral: true });
      return;
    }

    const success = storage.removeById('notes/notes.json', note.nid, 'notes', 'nid');

    if (success) {
      logger.command('note remove', interaction.user.tag, true, { title });
      await interaction.reply({ content: `✅ Note deleted: ${title}`, ephemeral: false });
    } else {
      await interaction.reply({ content: `❌ Failed to delete note: ${title}`, ephemeral: true });
    }
  },

  async pushContent(interaction) {
    const title = interaction.options.getString('title');
    const content = interaction.options.getString('content');
    const notes = storage.list('notes/notes.json', 'notes');

    const note = notes.find(n => n.title === title);
    if (!note) {
      await interaction.reply({ content: `❌ Note not found: ${title}`, ephemeral: true });
      return;
    }

    // Split by \n to support multiple lines
    const lines = content.split('\\n');
    note.content.push(...lines);
    note.updated = new Date().toISOString();

    const success = storage.updateById('notes/notes.json', note.nid, {
      content: note.content,
      updated: note.updated
    }, 'notes', 'nid');

    if (success) {
      await interaction.reply({
        content: `✅ Added ${lines.length} line(s) to: ${title}\nTotal lines: ${note.content.length}`,
        ephemeral: false
      });
    } else {
      await interaction.reply({ content: `❌ Failed to update note: ${title}`, ephemeral: true });
    }
  },

  async popContent(interaction) {
    const title = interaction.options.getString('title');
    const notes = storage.list('notes/notes.json', 'notes');

    const note = notes.find(n => n.title === title);
    if (!note) {
      await interaction.reply({ content: `❌ Note not found: ${title}`, ephemeral: true });
      return;
    }

    if (note.content.length === 0) {
      await interaction.reply({ content: `❌ Note is empty: ${title}`, ephemeral: true });
      return;
    }

    const removedLine = note.content.pop();
    note.updated = new Date().toISOString();

    const success = storage.updateById('notes/notes.json', note.nid, {
      content: note.content,
      updated: note.updated
    }, 'notes', 'nid');

    if (success) {
      await interaction.reply({
        content: `✅ Removed line from: ${title}\n\`\`\`\n${removedLine}\n\`\`\`\nRemaining lines: ${note.content.length}`,
        ephemeral: false
      });
    } else {
      await interaction.reply({ content: `❌ Failed to update note: ${title}`, ephemeral: true });
    }
  },

  async exportNote(interaction) {
    const title = interaction.options.getString('title');
    const notes = storage.list('notes/notes.json', 'notes');

    const note = notes.find(n => n.title === title);
    if (!note) {
      await interaction.reply({ content: `❌ Note not found: ${title}`, ephemeral: true });
      return;
    }

    const fileContent = `# ${note.title}\n\n` +
      `Created: ${new Date(note.created).toLocaleString()}\n` +
      `Updated: ${new Date(note.updated).toLocaleString()}\n` +
      `By: ${note.createdBy}\n\n` +
      `---\n\n` +
      note.content.join('\n');

    const filename = `${title.replace(/[^a-z0-9]/gi, '_')}.txt`;
    const attachment = new AttachmentBuilder(Buffer.from(fileContent), { name: filename });

    await interaction.reply({
      content: `📄 Exported: **${title}** (${note.content.length} lines)`,
      files: [attachment],
      ephemeral: false
    });

    logger.command('note export', interaction.user.tag, true, { title });
  },

  async viewNote(interaction) {
    const title = interaction.options.getString('title');
    const notes = storage.list('notes/notes.json', 'notes');

    const note = notes.find(n => n.title === title);
    if (!note) {
      await interaction.reply({ content: `❌ Note not found: ${title}`, ephemeral: true });
      return;
    }

    if (note.content.length === 0) {
      await interaction.reply({
        content: `📝 **${title}**\n\n(Note is empty)`,
        ephemeral: true
      });
      return;
    }

    const content = note.content.join('\n');
    const truncated = content.length > 1800 ? content.substring(0, 1800) + '\n...(truncated)' : content;

    await interaction.reply({
      content: `📝 **${title}** (${note.content.length} lines)\n\`\`\`\n${truncated}\n\`\`\``,
      ephemeral: false
    });
  }
};
