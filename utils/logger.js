/**
 * Logging utility for Sanwan bot
 * Handles file-based logging and Discord error notifications
 */

const fs = require('fs');
const path = require('path');

class Logger {
  constructor(logDir = './data/logs') {
    this.logDir = path.resolve(logDir);
    this.discordClient = null;
    this.errorChannelId = null;
    
    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Set Discord client for error notifications
   */
  setDiscordClient(client, errorChannelId) {
    this.discordClient = client;
    this.errorChannelId = errorChannelId;
  }

  /**
   * Format log entry with timestamp
   */
  formatEntry(level, message, metadata = {}) {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(metadata).length > 0 ? ` ${JSON.stringify(metadata)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}\n`;
  }

  /**
   * Write to log file
   */
  writeToFile(filename, entry) {
    const filepath = path.join(this.logDir, filename);
    try {
      fs.appendFileSync(filepath, entry);
    } catch (error) {
      console.error(`Failed to write to log file ${filename}:`, error.message);
    }
  }

  /**
   * Send error notification to Discord
   */
  async notifyDiscord(message, metadata = {}) {
    if (!this.discordClient || !this.errorChannelId) {
      return;
    }

    try {
      const channel = await this.discordClient.channels.fetch(this.errorChannelId);
      if (channel) {
        const embed = {
          color: 0xff0000,
          title: '🚨 Error Alert',
          description: message.substring(0, 4000),
          fields: Object.entries(metadata).map(([key, value]) => ({
            name: key,
            value: String(value).substring(0, 1024),
            inline: true
          })),
          timestamp: new Date().toISOString()
        };
        
        await channel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error('Failed to send Discord notification:', error.message);
    }
  }

  /**
   * Log info message
   */
  info(message, metadata = {}) {
    const entry = this.formatEntry('info', message, metadata);
    this.writeToFile('bot.log', entry);
    console.log(`[INFO] ${message}`);
  }

  /**
   * Log error message
   */
  async error(message, metadata = {}) {
    const entry = this.formatEntry('error', message, metadata);
    this.writeToFile('errors.log', entry);
    this.writeToFile('bot.log', entry);
    console.error(`[ERROR] ${message}`);
    
    // Notify via Discord
    await this.notifyDiscord(message, metadata);
  }

  /**
   * Log warning message
   */
  warn(message, metadata = {}) {
    const entry = this.formatEntry('warn', message, metadata);
    this.writeToFile('bot.log', entry);
    console.warn(`[WARN] ${message}`);
  }

  /**
   * Log command execution
   */
  command(commandName, user, success, metadata = {}) {
    const message = `Command: /${commandName} by ${user} - ${success ? 'SUCCESS' : 'FAILED'}`;
    const entry = this.formatEntry('command', message, metadata);
    this.writeToFile('commands.log', entry);
    this.writeToFile('bot.log', entry);
  }

  /**
   * Log daemon activity
   */
  daemon(message, metadata = {}) {
    const entry = this.formatEntry('daemon', message, metadata);
    this.writeToFile('daemon.log', entry);
    this.writeToFile('bot.log', entry);
  }

  /**
   * Read log file
   */
  readLog(filename, lines = 50) {
    const filepath = path.join(this.logDir, filename);
    
    if (!fs.existsSync(filepath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filepath, 'utf8');
      const allLines = content.split('\n').filter(line => line.trim());
      
      // Return last N lines
      return allLines.slice(-lines).join('\n');
    } catch (error) {
      console.error(`Failed to read log file ${filename}:`, error.message);
      return null;
    }
  }

  /**
   * List all log files
   */
  listLogs() {
    try {
      return fs.readdirSync(this.logDir)
        .filter(file => file.endsWith('.log'))
        .map(file => {
          const filepath = path.join(this.logDir, file);
          const stats = fs.statSync(filepath);
          return {
            name: file,
            size: stats.size,
            modified: stats.mtime
          };
        });
    } catch (error) {
      console.error('Failed to list logs:', error.message);
      return [];
    }
  }
}

// Singleton instance
const logger = new Logger();

module.exports = logger;
