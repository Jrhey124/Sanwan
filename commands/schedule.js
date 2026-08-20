const { SlashCommandBuilder } = require('discord.js');
const storage = require('../utils/storage');
const logger = require('../utils/logger');

module.exports = {
  name: 'schedule',
  description: 'Manage scheduled tasks',
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Manage scheduled tasks with cron expressions')
    .addSubcommand(subcommand =>
      subcommand
        .setName('set')
        .setDescription('Create a new scheduled task')
        .addStringOption(option =>
          option.setName('name')
            .setDescription('Schedule name')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('cron')
            .setDescription('Cron expression (e.g., "0 2 * * *" for daily at 2am)')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('command')
            .setDescription('Command to execute')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('list').setDescription('List all scheduled tasks')
    )
    .addSubcommand(subcommand =>
      subcommand.setName('history').setDescription('View execution history')
        .addStringOption(option =>
          option.setName('name')
            .setDescription('Schedule name (optional)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a scheduled task')
        .addStringOption(option =>
          option.setName('name')
            .setDescription('Schedule name')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('toggle')
        .setDescription('Enable/disable a scheduled task')
        .addStringOption(option =>
          option.setName('name')
            .setDescription('Schedule name')
            .setRequired(true)
        )
    ),

  async run(interaction) {
    const subcommand = interaction.options.getSubcommand();

    // Initialize schedules file
    storage.initializeIfMissing('schedules/schedules.json', {
      schedules: [],
      nextId: 1,
      history: []
    });

    try {
      switch (subcommand) {
        case 'set':
          await this.setSchedule(interaction);
          break;
        case 'list':
          await this.listSchedules(interaction);
          break;
        case 'history':
          await this.showHistory(interaction);
          break;
        case 'remove':
          await this.removeSchedule(interaction);
          break;
        case 'toggle':
          await this.toggleSchedule(interaction);
          break;
        default:
          await interaction.reply({ content: '❌ Unknown subcommand', ephemeral: true });
      }
    } catch (error) {
      logger.error('Schedule command error', { subcommand, error: error.message });
      await interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
    }
  },

  async setSchedule(interaction) {
    const name = interaction.options.getString('name');
    const cron = interaction.options.getString('cron');
    const command = interaction.options.getString('command');

    // Basic cron validation
    const cronParts = cron.split(' ');
    if (cronParts.length !== 5) {
      await interaction.reply({
        content: '❌ Invalid cron expression. Format: "minute hour day month weekday"\nExample: "0 2 * * *" (daily at 2am)',
        ephemeral: true
      });
      return;
    }

    const sid = storage.getNextId('schedules/schedules.json', 'S');

    const schedule = {
      sid,
      name,
      when: cron,
      command,
      enabled: true,
      notifyChannel: interaction.channelId,
      created: new Date().toISOString(),
      createdBy: interaction.user.tag
    };

    storage.append('schedules/schedules.json', schedule, 'schedules');
    logger.command('schedule set', interaction.user.tag, true, { sid, name });

    await interaction.reply({
      content: `✅ Schedule created!\n**ID:** ${sid}\n**Name:** ${name}\n**Cron:** ${cron}\n**Command:** ${command}\n\n⚠️ Restart the daemon to activate: \`npm run daemon\``,
      ephemeral: false
    });
  },

  async listSchedules(interaction) {
    const schedules = storage.list('schedules/schedules.json', 'schedules');

    if (schedules.length === 0) {
      await interaction.reply({ content: '⏰ No schedules found.', ephemeral: true });
      return;
    }

    const scheduleList = schedules
      .map(schedule => {
        const statusEmoji = schedule.enabled ? '✅' : '⏸️';
        return `${statusEmoji} **${schedule.sid}** - ${schedule.name}\n` +
               `   ⏰ ${schedule.when}\n` +
               `   📝 ${schedule.command}`;
      })
      .join('\n\n');

    await interaction.reply({
      content: `⏰ **Scheduled Tasks** (${schedules.length} total)\n\n${scheduleList}\n\n💡 Use \`/help schedule\` for cron examples`,
      ephemeral: false
    });
  },

  async showHistory(interaction) {
    const name = interaction.options.getString('name');
    const data = storage.read('schedules/schedules.json', { schedules: [], history: [] });

    let history = data.history || [];

    // Filter by schedule name if provided
    if (name) {
      const schedule = data.schedules.find(s => s.name === name);
      if (!schedule) {
        await interaction.reply({ content: `❌ Schedule not found: ${name}`, ephemeral: true });
        return;
      }
      history = history.filter(h => h.sid === schedule.sid);
    }

    if (history.length === 0) {
      await interaction.reply({
        content: name ? `📊 No execution history for: ${name}` : '📊 No execution history yet.',
        ephemeral: true
      });
      return;
    }

    // Show last 10 executions
    const recent = history.slice(-10).reverse();
    const historyList = recent
      .map(entry => {
        const statusEmoji = entry.status === 'completed' ? '✅' : entry.status === 'failed' ? '❌' : '⏳';
        const timestamp = new Date(entry.timestamp).toLocaleString();
        return `${statusEmoji} ${entry.sid} - ${timestamp}\n   Status: ${entry.status}`;
      })
      .join('\n\n');

    await interaction.reply({
      content: `📊 **Execution History** (last 10)\n\n${historyList}`,
      ephemeral: false
    });
  },

  async removeSchedule(interaction) {
    const name = interaction.options.getString('name');
    const schedules = storage.list('schedules/schedules.json', 'schedules');
    
    const schedule = schedules.find(s => s.name === name);
    if (!schedule) {
      await interaction.reply({ content: `❌ Schedule not found: ${name}`, ephemeral: true });
      return;
    }

    const success = storage.removeById('schedules/schedules.json', schedule.sid, 'schedules', 'sid');

    if (success) {
      logger.command('schedule remove', interaction.user.tag, true, { name });
      await interaction.reply({
        content: `✅ Schedule removed: ${name}\n\n⚠️ Restart the daemon to apply changes: \`npm run daemon\``,
        ephemeral: false
      });
    } else {
      await interaction.reply({ content: `❌ Failed to remove schedule: ${name}`, ephemeral: true });
    }
  },

  async toggleSchedule(interaction) {
    const name = interaction.options.getString('name');
    const schedules = storage.list('schedules/schedules.json', 'schedules');
    
    const schedule = schedules.find(s => s.name === name);
    if (!schedule) {
      await interaction.reply({ content: `❌ Schedule not found: ${name}`, ephemeral: true });
      return;
    }

    const newState = !schedule.enabled;
    const success = storage.updateById('schedules/schedules.json', schedule.sid, {
      enabled: newState
    }, 'schedules', 'sid');

    if (success) {
      logger.command('schedule toggle', interaction.user.tag, true, { name, enabled: newState });
      await interaction.reply({
        content: `${newState ? '✅' : '⏸️'} Schedule ${newState ? 'enabled' : 'disabled'}: ${name}\n\n⚠️ Restart the daemon to apply changes: \`npm run daemon\``,
        ephemeral: false
      });
    } else {
      await interaction.reply({ content: `❌ Failed to toggle schedule: ${name}`, ephemeral: true });
    }
  }
};
