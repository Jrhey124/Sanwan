const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const storage = require('../utils/storage');
const logger = require('../utils/logger');
const { isValidDateOnly, isDueWithinDays } = require('../utils/task-dates');

function canonicalTaskId(input) {
  const wanted = String(input || '').trim().toUpperCase();
  return storage.list('tasks/tasks.json', 'tasks').find(task => String(task.tid).toUpperCase() === wanted)?.tid || input;
}

function taskEmbed(task, title = '✅ Task') {
  const embed = new EmbedBuilder()
    .setColor(task.status === 'completed' ? 0x57f287 : 0x5865f2)
    .setTitle(title)
    .addFields(
      { name: 'ID', value: `\`${task.tid}\``, inline: true },
      { name: 'Title', value: task.title || 'Untitled', inline: true },
      { name: 'Status', value: task.status || 'open', inline: true },
      { name: 'Assignee', value: task.assignee || 'Unassigned', inline: true },
      { name: 'Deadline', value: task.deadline || 'None', inline: true }
    );
  if (task.description) embed.addFields({ name: 'Description', value: String(task.description).slice(0, 1024) });
  return embed;
}

async function notifyConfigured(interaction, task, title = '📋 Task Updated') {
  let channelId = null;
  try {
    const settings = storage.encryptedRead('settings.enc', {});
    channelId = settings?.bot?.errorChannel || null;
    if (!channelId || !interaction.client?.channels) {
      logger.info('Task notification skipped', { tid: task?.tid, reason: 'no configured channel' });
      return false;
    }
    const channel = await interaction.client.channels.fetch(channelId);
    if (!channel || typeof channel.send !== 'function') {
      logger.warn('Task notification failed', { tid: task?.tid, channelId, reason: 'channel unavailable' });
      return false;
    }
    await channel.send({ embeds: [taskEmbed(task, title)] });
    logger.info('Task notification sent', { tid: task?.tid, channelId, title });
    return true;
  } catch (error) {
    logger.warn('Task notification failed', { tid: task?.tid, channelId, error: error.message });
    return false;
  }
}

module.exports = {
  name: 'task',
  description: 'Task management commands',
  data: new SlashCommandBuilder()
    .setName('task')
    .setDescription('Manage tasks with deadlines and assignments')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Create a new task')
        .addStringOption(option => option.setName('title').setDescription('Task title').setRequired(true))
        .addStringOption(option => option.setName('assignee').setDescription('Assignee (@user)').setRequired(false))
        .addStringOption(option => option.setName('deadline').setDescription('Deadline (YYYY-MM-DD)').setRequired(false))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all tasks')
        .addStringOption(option =>
          option.setName('filter')
            .setDescription('Filter by status')
            .addChoices(
              { name: 'All', value: 'all' },
              { name: 'Open', value: 'open' },
              { name: 'In Progress', value: 'in_progress' },
              { name: 'Completed', value: 'completed' }
            )
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('update')
        .setDescription('Update a task')
        .addStringOption(option => option.setName('tid').setDescription('Task ID').setRequired(true))
        .addStringOption(option =>
          option.setName('field')
            .setDescription('Field to update')
            .addChoices(
              { name: 'Status', value: 'status' },
              { name: 'Assignee', value: 'assignee' },
              { name: 'Deadline', value: 'deadline' },
              { name: 'Title', value: 'title' }
            )
            .setRequired(true)
        )
        .addStringOption(option => option.setName('value').setDescription('New value').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('describe')
        .setDescription('Add or update task description')
        .addStringOption(option => option.setName('tid').setDescription('Task ID').setRequired(true))
        .addStringOption(option => option.setName('description').setDescription('Task description').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Delete a task')
        .addStringOption(option => option.setName('tid').setDescription('Task ID').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('due')
        .setDescription('Show tasks due within N days')
        .addIntegerOption(option => option.setName('days').setDescription('Number of days').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('link')
        .setDescription('Link task to GitHub issue')
        .addStringOption(option => option.setName('tid').setDescription('Task ID').setRequired(true))
        .addStringOption(option => option.setName('issue').setDescription('Issue number (#123)').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('notify')
        .setDescription('Send this task to the configured notification channel')
        .addStringOption(option => option.setName('tid').setDescription('Task ID').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand.setName('sync').setDescription('Sync tasks with external issue tracker')
    ),

  async run(interaction) {
    const subcommand = interaction.options.getSubcommand();

    // Initialize tasks file if it doesn't exist
    storage.initializeIfMissing('tasks/tasks.json', {
      tasks: [],
      nextId: 1
    });

    try {
      switch (subcommand) {
        case 'add':
          await this.addTask(interaction);
          break;
        case 'list':
          await this.listTasks(interaction);
          break;
        case 'update':
          await this.updateTask(interaction);
          break;
        case 'describe':
          await this.describeTask(interaction);
          break;
        case 'remove':
          await this.removeTask(interaction);
          break;
        case 'due':
          await this.showDueTasks(interaction);
          break;
        case 'link':
          await this.linkTask(interaction);
          break;
        case 'notify':
          await this.notifyTask(interaction);
          break;
        case 'sync':
          await this.syncTasks(interaction);
          break;
        default:
          await interaction.reply({ content: '❌ Unknown subcommand', ephemeral: true });
      }
    } catch (error) {
      logger.error('Task command error', { subcommand, error: error.message });
      await interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
    }
  },

  async addTask(interaction) {
    const title = interaction.options.getString('title');
    const assignee = interaction.options.getString('assignee') || 'Unassigned';
    const deadline = interaction.options.getString('deadline') || null;

    if (deadline && !isValidDateOnly(deadline)) {
      await interaction.reply({ content: '❌ Deadline must be a real calendar date in YYYY-MM-DD format.', ephemeral: true });
      return;
    }

    // IDs are deliberately compact and human-friendly: T0, T1, …
    const tid = `T${storage.getNextId('tasks/tasks.json') - 1}`;
    
    const task = {
      tid,
      title,
      assignee,
      deadline,
      status: 'open',
      description: '',
      linkedIssue: null,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      createdBy: interaction.user.tag
    };

    if (!storage.append('tasks/tasks.json', task, 'tasks')) {
      throw new Error('Could not save the task.');
    }
    
    logger.command('task add', interaction.user.tag, true, { tid, title });
    await notifyConfigured(interaction, task, '📋 Task Delegated');

    await interaction.reply({ embeds: [taskEmbed(task, '✅ Task Created')],
      content: `✅ Task created!\n**ID:** ${tid}\n**Title:** ${title}\n**Assignee:** ${assignee}${deadline ? `\n**Deadline:** ${deadline}` : ''}`,
      ephemeral: false
    });
  },

  async listTasks(interaction) {
    const filter = interaction.options.getString('filter') || 'all';
    
    let tasks = storage.list('tasks/tasks.json', 'tasks');
    
    if (filter !== 'all') {
      tasks = tasks.filter(task => task.status === filter);
    }

    if (tasks.length === 0) {
      await interaction.reply({ content: '📋 No tasks found.', ephemeral: true });
      return;
    }

    const taskList = tasks
      .map(task => {
        const statusEmoji = {
          open: '⚪',
          in_progress: '🔵',
          completed: '✅'
        }[task.status] || '⚪';
        
        const description = String(task.description || '').replace(/\s+/g, ' ').trim();
        const preview = description.length > 250 ? `${description.slice(0, 249)}…` : description;
        return `${statusEmoji} **${task.tid}** - ${task.title}\n` +
               `   ${preview ? `"${preview}"\n   ` : ''}👤 ${task.assignee} ${task.deadline ? `| 📅 ${task.deadline}` : ''}`;
      })
      .join('\n\n');

    await interaction.reply({
      content: `📋 **Tasks** (${tasks.length} found)\n\n${taskList}`,
      ephemeral: false
    });
  },

  async updateTask(interaction) {
    const tid = interaction.options.getString('tid');
    const field = interaction.options.getString('field');
    const value = interaction.options.getString('value');

    if (field === 'deadline' && !isValidDateOnly(value)) {
      await interaction.reply({ content: '❌ Deadline must be a real calendar date in YYYY-MM-DD format.', ephemeral: true });
      return;
    }

    const canonicalTid = canonicalTaskId(tid);
    const task = storage.findById('tasks/tasks.json', canonicalTid, 'tasks', 'tid');
    
    if (!task) {
      await interaction.reply({ content: `❌ Task ${tid} not found.`, ephemeral: true });
      return;
    }

    const updates = {
      [field]: value,
      updated: new Date().toISOString()
    };

    const success = storage.updateById('tasks/tasks.json', canonicalTid, updates, 'tasks', 'tid');
    
    if (success) {
      await notifyConfigured(interaction, { ...task, ...updates }, '📋 Task Updated');
      logger.command('task update', interaction.user.tag, true, { tid, field, value });
      await interaction.reply({
        content: `✅ Task ${tid} updated!\n**${field}:** ${value}`,
        ephemeral: false
      });
    } else {
      await interaction.reply({ content: `❌ Failed to update task ${tid}.`, ephemeral: true });
    }
  },

  async describeTask(interaction) {
    const tid = interaction.options.getString('tid');
    const description = interaction.options.getString('description');

    const success = storage.updateById('tasks/tasks.json', canonicalTaskId(tid), {
      description,
      updated: new Date().toISOString()
    }, 'tasks', 'tid');

    if (success) {
      const task = storage.findById('tasks/tasks.json', canonicalTaskId(tid), 'tasks', 'tid');
      if (task) await notifyConfigured(interaction, task, '📋 Task Description Updated');
      await interaction.reply({
        content: `✅ Description added to task ${tid}`,
        ephemeral: false
      });
    } else {
      await interaction.reply({ content: `❌ Task ${tid} not found.`, ephemeral: true });
    }
  },

  async removeTask(interaction) {
    const tid = interaction.options.getString('tid');

    const success = storage.removeById('tasks/tasks.json', canonicalTaskId(tid), 'tasks', 'tid');

    if (success) {
      logger.command('task remove', interaction.user.tag, true, { tid });
      await interaction.reply({ content: `✅ Task ${tid} deleted.`, ephemeral: false });
    } else {
      await interaction.reply({ content: `❌ Task ${tid} not found.`, ephemeral: true });
    }
  },

  async showDueTasks(interaction) {
    const days = interaction.options.getInteger('days');
    if (!Number.isInteger(days) || days < 0 || days > 3650) {
      await interaction.reply({ content: '❌ Days must be a whole number between 0 and 3650.', ephemeral: true });
      return;
    }
    const tasks = storage.list('tasks/tasks.json', 'tasks');
    
    const now = new Date();
    const dueTasks = tasks.filter(task => {
      if (!task.deadline || task.status === 'completed') return false;
      return isDueWithinDays(task.deadline, days, now);
    });

    if (dueTasks.length === 0) {
      await interaction.reply({
        content: `📅 No tasks due within ${days} day(s).`,
        ephemeral: true
      });
      return;
    }

    const taskList = dueTasks
      .map(task => `**${task.tid}** - ${task.title}\n   📅 ${task.deadline} | 👤 ${task.assignee}`)
      .join('\n\n');

    await interaction.reply({
      content: `⏰ **Tasks due within ${days} day(s):** (${dueTasks.length} found)\n\n${taskList}`,
      ephemeral: false
    });
  },

  async linkTask(interaction) {
    const tid = interaction.options.getString('tid');
    const issue = interaction.options.getString('issue');

    const success = storage.updateById('tasks/tasks.json', canonicalTaskId(tid), {
      linkedIssue: issue,
      updated: new Date().toISOString()
    }, 'tasks', 'tid');

    if (success) {
      const task = storage.findById('tasks/tasks.json', canonicalTaskId(tid), 'tasks', 'tid');
      if (task) await notifyConfigured(interaction, task, '📋 Task Linked');
      await interaction.reply({
        content: `✅ Task ${tid} linked to issue ${issue}`,
        ephemeral: false
      });
    } else {
      await interaction.reply({ content: `❌ Task ${tid} not found.`, ephemeral: true });
    }
  },

  async notifyTask(interaction) {
    const tid = interaction.options.getString('tid');
    const task = storage.findById('tasks/tasks.json', canonicalTaskId(tid), 'tasks', 'tid');
    if (!task) {
      await interaction.reply({ content: `❌ Task ${tid} not found.`, ephemeral: true });
      return;
    }
    const settings = storage.encryptedRead('settings.enc', {});
    const channelId = settings?.bot?.errorChannel;
    if (!channelId) {
      await interaction.reply({ content: '❌ No notification channel is configured. Run setup and configure the Discord error-log channel.', ephemeral: true });
      return;
    }
    const channel = await interaction.client.channels.fetch(channelId);
    if (!channel || typeof channel.send !== 'function') {
      await interaction.reply({ content: '❌ The configured notification channel could not be accessed.', ephemeral: true });
      return;
    }
    await channel.send({ embeds: [taskEmbed(task, '📋 Task Delegation')] });
    await interaction.reply({ content: `✅ Task ${task.tid} sent to <#${channelId}>.`, ephemeral: true });
  },

  async syncTasks(interaction) {
    await interaction.reply({
      content: '🔄 Task sync not yet implemented. Coming soon!',
      ephemeral: true
    });
  }
};
