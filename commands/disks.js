/**
 * commands/disks.js
 *
 * /status disks  — show disk usage using the platform-appropriate command.
 *
 * Uses os-service.diskCommand() so the right tool is called on Linux,
 * macOS, and Windows without hardcoding OS-specific strings here.
 */

'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { execSync }     = require('child_process');
const { diskCommand }  = require('../utils/os-service');
const logger           = require('../utils/logger');

module.exports = {
  name:        'disks',
  description: 'Show disk usage',

  data: new SlashCommandBuilder()
    .setName('disks')
    .setDescription('Show disk usage on this host'),

  async run(interaction) {
    await interaction.deferReply();

    try {
      const cmd    = diskCommand();
      const output = execSync(cmd, { timeout: 10_000 }).toString().trim();

      const truncated = output.length > 1900
        ? output.slice(0, 1900) + '\n…(truncated)'
        : output;

      await interaction.editReply(
        `💾 **Disk usage** (\`${cmd}\`)\n\`\`\`\n${truncated}\n\`\`\``
      );

      logger.command('disks', interaction.user.tag, true);
    } catch (err) {
      logger.error('disks command failed', { error: err.message });
      await interaction.editReply(`❌ Could not retrieve disk usage: ${err.message}`);
    }
  }
};
