/**
 * commands/ping.js
 *
 * /ping — check bot responsiveness and show round-trip latency.
 *
 * Reports two numbers:
 *   Roundtrip — time between the interaction being sent and the bot replying
 *   WebSocket  — Discord gateway heartbeat latency (client.ws.ping)
 */

'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  name:        'ping',
  description: 'Check bot latency and responsiveness',

  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot latency and responsiveness'),

  async run(interaction) {
    // Record the time before we do anything so the roundtrip is accurate
    const sent = Date.now();

    // Defer so we have something to edit — also gives us a baseline timestamp
    await interaction.deferReply();

    const roundtrip = Date.now() - sent;
    const ws        = interaction.client.ws.ping;

    // Colour the embed based on latency
    const colour =
      roundtrip < 150  ? 0x57f287 :   // green  — fast
      roundtrip < 400  ? 0xfee75c :   // yellow — acceptable
                         0xed4245;    // red    — slow

    const embed = new EmbedBuilder()
      .setColor(colour)
      .setTitle('🏓 Pong!')
      .addFields(
        {
          name:   '📡 Roundtrip',
          value:  `\`${roundtrip} ms\``,
          inline: true
        },
        {
          name:   '💓 WebSocket',
          value:  ws >= 0 ? `\`${ws} ms\`` : '`—`',
          inline: true
        }
      )
      .setTimestamp()
      .setFooter({ text: `Requested by ${interaction.user.tag}` });

    await interaction.editReply({ embeds: [embed] });

    logger.command('ping', interaction.user.tag, true, {
      roundtrip,
      ws: ws >= 0 ? ws : null
    });
  }
};
