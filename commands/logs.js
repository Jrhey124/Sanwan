const { SlashCommandBuilder } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  name: 'logs',
  description: 'View bot logs',
  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('View and manage bot logs')
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View log file contents')
        .addStringOption(option =>
          option.setName('file')
            .setDescription('Log file to view')
            .addChoices(
              { name: 'Bot Logs', value: 'bot.log' },
              { name: 'Error Logs', value: 'errors.log' },
              { name: 'Command Logs', value: 'commands.log' },
              { name: 'Daemon Logs', value: 'daemon.log' }
            )
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option.setName('lines')
            .setDescription('Number of lines to show (default: 50)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('list').setDescription('List all log files')
    ),

  async run(interaction) {
    const subcommand = interaction.options.getSubcommand();

    try {
      switch (subcommand) {
        case 'view':
          await this.viewLogs(interaction);
          break;
        case 'list':
          await this.listLogs(interaction);
          break;
        default:
          await interaction.reply({ content: '❌ Unknown subcommand', ephemeral: true });
      }
    } catch (error) {
      logger.error('Logs command error', { subcommand, error: error.message });
      await interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
    }
  },

  async viewLogs(interaction) {
    const filename = interaction.options.getString('file');
    const lines = interaction.options.getInteger('lines') || 50;

    const content = logger.readLog(filename, lines);

    if (!content) {
      await interaction.reply({
        content: `❌ Log file not found: ${filename}`,
        ephemeral: true
      });
      return;
    }

    // Discord has a 2000 character limit for messages
    const truncated = content.length > 1900 ? content.substring(content.length - 1900) : content;

    await interaction.reply({
      content: `📄 **${filename}** (last ${lines} lines)\n\`\`\`\n${truncated}\n\`\`\``,
      ephemeral: true
    });
  },

  async listLogs(interaction) {
    const logs = logger.listLogs();

    if (logs.length === 0) {
      await interaction.reply({ content: '📄 No log files found.', ephemeral: true });
      return;
    }

    const formatBytes = (bytes) => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1048576) return `${(bytes / 1024).toFixed(2)} KB`;
      return `${(bytes / 1048576).toFixed(2)} MB`;
    };

    const logList = logs
      .map(log => `📄 **${log.name}**\n   Size: ${formatBytes(log.size)} | Modified: ${new Date(log.modified).toLocaleString()}`)
      .join('\n\n');

    await interaction.reply({
      content: `📋 **Available Log Files:**\n\n${logList}`,
      ephemeral: true
    });
  }
};
