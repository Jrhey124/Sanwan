/**
 * commands/resources.js
 *
 * /resources  — show CPU and memory usage.
 *
 * Uses os-service.resourceCommand() so the right tool is called on
 * Linux, macOS, and Windows.
 */

'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { execSync }        = require('child_process');
const { resourceCommand } = require('../utils/os-service');
const logger              = require('../utils/logger');

module.exports = {
  name:        'resources',
  description: 'Show CPU and memory usage',

  data: new SlashCommandBuilder()
    .setName('resources')
    .setDescription('Show CPU and memory usage on this host'),

  async run(interaction) {
    await interaction.deferReply();

    try {
      const cmd    = resourceCommand();
      const output = execSync(cmd, { timeout: 10_000 }).toString().trim();

      const truncated = output.length > 1900
        ? output.slice(0, 1900) + '\n…(truncated)'
        : output;

      await interaction.editReply(
        `⚙️ **Resources** (\`${cmd}\`)\n\`\`\`\n${truncated}\n\`\`\``
      );

      logger.command('resources', interaction.user.tag, true);
    } catch (err) {
      logger.error('resources command failed', { error: err.message });
      await interaction.editReply(`❌ Could not retrieve resource info: ${err.message}`);
    }
  }
};
