#!/usr/bin/env node
/**
 * Sanwan Daemon Service
 * Handles scheduled tasks and reminders
 */

const fs = require('fs');
const path = require('path');
const { CronJob } = require('cron');
const { Client, GatewayIntentBits } = require('discord.js');
const storage = require('./utils/storage');
const logger = require('./utils/logger');

require('dotenv').config();

class SanwanDaemon {
  constructor() {
    this.jobs = new Map();
    this.client = null;
    this.configPath = 'data/daemon-config.json';
  }

  /**
   * Initialize Discord client
   */
  async initializeClient() {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds]
    });

    this.client.once('ready', () => {
      logger.daemon('Daemon Discord client ready', { user: this.client.user.tag });
      console.log(`✅ Daemon connected as ${this.client.user.tag}`);
    });

    await this.client.login(process.env.DISCORD_TOKEN);
  }

  /**
   * Load daemon configuration
   */
  loadConfig() {
    const config = storage.read(this.configPath, { enabled: false, schedules: [] });
    
    if (!config.enabled) {
      logger.daemon('Daemon is disabled in configuration');
      return null;
    }

    return config;
  }

  /**
   * Load schedules from storage
   */
  loadSchedules() {
    storage.initializeIfMissing('schedules/schedules.json', {
      schedules: [],
      nextId: 1,
      history: []
    });

    const data = storage.read('schedules/schedules.json', { schedules: [] });
    return data.schedules.filter(schedule => schedule.enabled);
  }

  /**
   * Create cron job for a schedule
   */
  createJob(schedule) {
    try {
      const job = new CronJob(
        schedule.when,
        async () => await this.executeSchedule(schedule),
        null,
        false,
        'America/New_York' // Adjust timezone as needed
      );

      this.jobs.set(schedule.sid, job);
      logger.daemon(`Created job for schedule ${schedule.sid}`, { name: schedule.name });
      
      return job;
    } catch (error) {
      logger.error(`Failed to create job for schedule ${schedule.sid}`, {
        error: error.message,
        schedule: schedule.name
      });
      return null;
    }
  }

  /**
   * Execute a scheduled task
   */
  async executeSchedule(schedule) {
    logger.daemon(`Executing schedule: ${schedule.name}`, { sid: schedule.sid });

    try {
      // Record execution in history
      this.recordExecution(schedule.sid, 'started');

      // Parse and execute command
      const result = await this.executeCommand(schedule.command);

      // Record success
      this.recordExecution(schedule.sid, 'completed', result);

      // Notify via Discord if configured
      if (schedule.notifyChannel) {
        await this.notifyExecution(schedule, 'success', result);
      }

    } catch (error) {
      logger.error(`Schedule execution failed: ${schedule.name}`, {
        sid: schedule.sid,
        error: error.message
      });
      
      this.recordExecution(schedule.sid, 'failed', error.message);
      
      if (schedule.notifyChannel) {
        await this.notifyExecution(schedule, 'error', error.message);
      }
    }
  }

  /**
   * Execute a command (placeholder for actual implementation)
   */
  async executeCommand(command) {
    // In a real implementation, this would:
    // 1. Parse the command
    // 2. Execute the appropriate bot command or system command
    // 3. Return the result
    
    logger.daemon(`Executing command: ${command}`);
    
    // Placeholder implementation
    return { status: 'success', message: `Executed: ${command}` };
  }

  /**
   * Record schedule execution in history
   */
  recordExecution(sid, status, result = null) {
    const data = storage.read('schedules/schedules.json', {
      schedules: [],
      history: []
    });

    if (!data.history) {
      data.history = [];
    }

    data.history.push({
      sid,
      status,
      result: result ? String(result).substring(0, 500) : null,
      timestamp: new Date().toISOString()
    });

    // Keep only last 100 executions
    if (data.history.length > 100) {
      data.history = data.history.slice(-100);
    }

    storage.write('schedules/schedules.json', data);
  }

  /**
   * Notify about schedule execution via Discord
   */
  async notifyExecution(schedule, status, result) {
    if (!this.client) return;

    try {
      const channel = await this.client.channels.fetch(schedule.notifyChannel);
      if (!channel) return;

      const emoji = status === 'success' ? '✅' : '❌';
      const color = status === 'success' ? 0x00ff00 : 0xff0000;

      const embed = {
        color,
        title: `${emoji} Scheduled Task: ${schedule.name}`,
        fields: [
          { name: 'Status', value: status.toUpperCase(), inline: true },
          { name: 'Schedule', value: schedule.when, inline: true },
          { name: 'Command', value: schedule.command, inline: false }
        ],
        timestamp: new Date().toISOString()
      };

      if (result) {
        embed.fields.push({
          name: 'Result',
          value: String(result).substring(0, 1024),
          inline: false
        });
      }

      await channel.send({ embeds: [embed] });
    } catch (error) {
      logger.error('Failed to send schedule notification', {
        schedule: schedule.name,
        error: error.message
      });
    }
  }

  /**
   * Check for task reminders
   */
  async checkTaskReminders() {
    const tasks = storage.list('tasks/tasks.json', 'tasks');
    const now = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const upcomingTasks = tasks.filter(task => {
      if (!task.deadline || task.status === 'completed') return false;
      
      const deadline = new Date(task.deadline);
      return deadline > now && deadline <= tomorrow;
    });

    for (const task of upcomingTasks) {
      await this.sendTaskReminder(task);
    }
  }

  /**
   * Send task reminder
   */
  async sendTaskReminder(task) {
    const settings = storage.read('settings.json', { bot: {} });
    const channelId = settings.bot.errorChannel; // Reuse error channel for now

    if (!channelId || !this.client) return;

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel) return;

      const embed = {
        color: 0xffaa00,
        title: '⏰ Task Reminder',
        description: `Task **${task.tid}** is due soon!`,
        fields: [
          { name: 'Title', value: task.title, inline: false },
          { name: 'Assignee', value: task.assignee, inline: true },
          { name: 'Deadline', value: task.deadline, inline: true }
        ],
        timestamp: new Date().toISOString()
      };

      await channel.send({ embeds: [embed] });
      logger.daemon('Sent task reminder', { tid: task.tid });
    } catch (error) {
      logger.error('Failed to send task reminder', {
        tid: task.tid,
        error: error.message
      });
    }
  }

  /**
   * Start the daemon
   */
  async start() {
    console.log('🚀 Starting Sanwan Daemon...');
    logger.daemon('Daemon starting');

    // Load configuration
    const config = this.loadConfig();
    
    if (!config) {
      console.log('⚠️  Daemon is disabled. Enable it in daemon-config.json');
      return;
    }

    // Initialize Discord client
    await this.initializeClient();

    // Load and start schedules
    const schedules = this.loadSchedules();
    console.log(`📅 Loaded ${schedules.length} schedule(s)`);

    for (const schedule of schedules) {
      const job = this.createJob(schedule);
      if (job) {
        job.start();
        console.log(`✓ Started: ${schedule.name} (${schedule.when})`);
      }
    }

    // Start task reminder check (every hour)
    const reminderJob = new CronJob('0 * * * *', async () => {
      await this.checkTaskReminders();
    });
    reminderJob.start();
    console.log('✓ Task reminder checker started');

    logger.daemon('Daemon started successfully', {
      schedules: schedules.length
    });

    console.log('\n✅ Daemon is running. Press Ctrl+C to stop.');
  }

  /**
   * Stop the daemon
   */
  stop() {
    console.log('\n🛑 Stopping daemon...');
    logger.daemon('Daemon stopping');

    this.jobs.forEach((job, sid) => {
      job.stop();
      console.log(`✓ Stopped: ${sid}`);
    });

    if (this.client) {
      this.client.destroy();
    }

    console.log('✅ Daemon stopped.');
    logger.daemon('Daemon stopped');
  }
}

// Handle shutdown signals
const daemon = new SanwanDaemon();

process.on('SIGINT', () => {
  daemon.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  daemon.stop();
  process.exit(0);
});

// Start daemon if run directly
if (require.main === module) {
  daemon.start().catch(error => {
    console.error('❌ Daemon failed to start:', error);
    logger.error('Daemon startup failed', { error: error.message });
    process.exit(1);
  });
}

module.exports = SanwanDaemon;
