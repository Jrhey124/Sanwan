const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'help',
  description: 'Display available commands and usage information',
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Display available commands and usage information')
    .addStringOption(option =>
      option.setName('command')
        .setDescription('Get help for a specific command')
        .setRequired(false)
    ),
  
  async run(interaction) {
    const specificCommand = interaction.options.getString('command');

    if (specificCommand) {
      return await this.showCommandHelp(interaction, specificCommand);
    }

    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('📚 Sanwan Bot - Command Reference')
      .setDescription('A Discord ChatOps bot for task management, scheduling, and DevOps automation')
      .addFields(
        {
          name: '📋 Task Management',
          value: '`/task add` - Create a new task\n' +
                 '`/task list` - List all tasks\n' +
                 '`/task update` - Update task details\n' +
                 '`/task remove` - Delete a task\n' +
                 '`/task due` - Show tasks due in N days',
          inline: false
        },
        {
          name: '⏰ Scheduling',
          value: '`/schedule set` - Create a scheduled job\n' +
                 '`/schedule list` - List all schedules\n' +
                 '`/schedule history` - View execution history',
          inline: false
        },
        {
          name: '📝 Notes',
          value: '`/note add` - Create a new note\n' +
                 '`/note list` - List all notes\n' +
                 '`/note search` - Search notes by keyword\n' +
                 '`/note export` - Export note contents',
          inline: false
        },
        {
          name: '🤖 AI Assistant',
          value: '`/ask` - Ask a question to AI\n' +
                 '`/ask model list` - List available models\n' +
                 '`/ask config` - Show AI configuration\n' +
                 '`/ask switch` - Switch AI model',
          inline: false
        },
        {
          name: '🚀 Deployment',
          value: '`/deploy start` - Start a service\n' +
                 '`/deploy stop` - Stop a service\n' +
                 '`/deploy status` - Check service status\n' +
                 '`/deploy rollback` - Rollback to previous version',
          inline: false
        },
        {
          name: '📊 System Status',
          value: '`/status disks` - Show disk usage\n' +
                 '`/status resources` - Show CPU/memory usage\n' +
                 '`/status network` - Show network information',
          inline: false
        },
        {
          name: '📄 Logs',
          value: '`/logs` - View bot logs\n' +
                 '`/errors` - View error logs\n' +
                 '`/logs list` - List all log files',
          inline: false
        }
      )
      .setFooter({ text: 'Use /help <command> for detailed information about a specific command' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },

  async showCommandHelp(interaction, commandName) {
    const helpDetails = {
      task: {
        title: '📋 Task Management Commands',
        description: 'Manage tasks with deadlines, assignees, and tracking',
        commands: [
          '`/task add <task> <assignee> <deadline>` - Create a new task',
          '`/task update <tid> <field> <value>` - Update task field',
          '`/task describe <tid> <description>` - Add/update task description',
          '`/task list` - Show all tasks',
          '`/task remove <tid>` - Delete a task',
          '`/task notify <tid>` - Send reminder for a task',
          '`/task due <days>` - Show tasks due within N days',
          '`/task link <tid> <issue#>` - Link task to GitHub issue',
          '`/task sync` - Sync with external issue tracker'
        ]
      },
      schedule: {
        title: '⏰ Schedule Commands',
        description: 'Create and manage scheduled jobs with cron syntax',
        commands: [
          '`/schedule set <name> <cron>` - Create scheduled job',
          '`/schedule list` - List all schedules',
          '`/schedule history` - View execution history',
          'Example: `/schedule set daily-backup "0 2 * * *"`'
        ]
      },
      note: {
        title: '📝 Note Commands',
        description: 'Keep organized notes and documentation',
        commands: [
          '`/note add <title>` - Create a new note',
          '`/note list` - List all notes',
          '`/note search <keyword>` - Search notes',
          '`/note remove <title>` - Delete a note',
          '`/note push <sentence>` - Add line to note',
          '`/note pop` - Remove last line from note',
          '`/note export <title>` - Export note as file'
        ]
      }
    };

    const help = helpDetails[commandName];
    
    if (!help) {
      await interaction.reply({
        content: `❌ No help available for command: ${commandName}`,
        ephemeral: true
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle(help.title)
      .setDescription(help.description)
      .addFields({
        name: 'Commands',
        value: help.commands.join('\n'),
        inline: false
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
};
