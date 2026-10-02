/**
 * commands/service.js
 *
 * /service — manage the three Sanwan system services from Discord.
 *
 * Services:
 *   sanwan-bot      — main Discord bot process
 *   sanwan-daemon   — cron scheduler + task reminder daemon
 *   sanwan-webhook  — GitHub webhook HTTP server
 *
 * Subcommands:
 *   start   <service>
 *   stop    <service>
 *   restart <service>
 *   enable  <service>      — enable auto-start on boot
 *   disable <service>      — disable auto-start on boot
 *   status  <service|all>  — show running state
 *
 * Platform implementation:
 *   Windows : schtasks.exe   (/Run /End /Change /Query — no PowerShell required)
 *   Linux   : systemctl      (requires passwordless sudo or polkit rule)
 *   macOS   : launchctl      (LaunchAgent plist in ~/Library/LaunchAgents)
 *
 * Security:
 *   Gate A + Gate B enforced by queue.js before run() is called.
 *   Restrict to admin roles in setup step 5b.
 */

'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const os                  = require('os');
const { serviceControl }  = require('../utils/os-service');
const logger              = require('../utils/logger');

// ─── Service registry ─────────────────────────────────────────────────────────

const SERVICES = [
  { id: 'sanwan-bot',     label: 'Bot',     icon: '🤖', description: 'Main Discord bot process' },
  { id: 'sanwan-daemon',  label: 'Daemon',  icon: '⏰', description: 'Cron scheduler & task reminders' },
  { id: 'sanwan-webhook', label: 'Webhook', icon: '🔗', description: 'GitHub webhook HTTP server' }
];

const SERVICE_CHOICES = SERVICES.map(s => ({ name: `${s.icon} ${s.label}`, value: s.id }));

// ─── Module export ────────────────────────────────────────────────────────────

module.exports = {
  name:        'service',
  description: 'Start, stop, enable, disable, or check status of Sanwan services',

  data: new SlashCommandBuilder()
    .setName('service')
    .setDescription('Manage Sanwan system services')

    .addSubcommand(sub =>
      sub.setName('start').setDescription('Start a service')
        .addStringOption(o =>
          o.setName('name').setDescription('Service').setRequired(true)
            .addChoices(...SERVICE_CHOICES)
        )
    )
    .addSubcommand(sub =>
      sub.setName('stop').setDescription('Stop a service')
        .addStringOption(o =>
          o.setName('name').setDescription('Service').setRequired(true)
            .addChoices(...SERVICE_CHOICES)
        )
    )
    .addSubcommand(sub =>
      sub.setName('restart').setDescription('Restart a service')
        .addStringOption(o =>
          o.setName('name').setDescription('Service').setRequired(true)
            .addChoices(...SERVICE_CHOICES)
        )
    )
    .addSubcommand(sub =>
      sub.setName('enable').setDescription('Enable a service to start on boot')
        .addStringOption(o =>
          o.setName('name').setDescription('Service').setRequired(true)
            .addChoices(...SERVICE_CHOICES)
        )
    )
    .addSubcommand(sub =>
      sub.setName('disable').setDescription('Disable a service from starting on boot')
        .addStringOption(o =>
          o.setName('name').setDescription('Service').setRequired(true)
            .addChoices(...SERVICE_CHOICES)
        )
    )
    .addSubcommand(sub =>
      sub.setName('status').setDescription('Show the status of a service (or all)')
        .addStringOption(o =>
          o.setName('name').setDescription('Service or "all"').setRequired(true)
            .addChoices(
              ...SERVICE_CHOICES,
              { name: '📋 All', value: 'all' }
            )
        )
    ),

  async run(interaction) {
    await interaction.deferReply();

    const subcommand = interaction.options.getSubcommand();
    const nameArg    = interaction.options.getString('name');

    const targets = nameArg === 'all'
      ? SERVICES.map(s => s.id)
      : [nameArg];

    try {
      // Run the action on every target service
      const results = targets.map(id => {
        const meta           = SERVICES.find(s => s.id === id);
        const { ok, output } = serviceControl(subcommand, id);
        return { id, label: meta?.label ?? id, icon: meta?.icon ?? '⚙️', ok, output };
      });

      // ── Build embed ────────────────────────────────────────────────────────
      const allOk   = results.every(r => r.ok);
      const anyOk   = results.some(r => r.ok);
      const colour  = allOk ? 0x57f287 : anyOk ? 0xfee75c : 0xed4245;

      const ACTION_LABEL = {
        start:   '▶ Start',
        stop:    '⏹ Stop',
        restart: '🔄 Restart',
        enable:  '✅ Enable',
        disable: '🚫 Disable',
        status:  '📊 Status'
      };

      const embed = new EmbedBuilder()
        .setColor(colour)
        .setTitle(`${ACTION_LABEL[subcommand] ?? subcommand} — ${nameArg === 'all' ? 'All Services' : nameArg}`)
        .setTimestamp()
        .setFooter({ text: `${interaction.user.tag} · ${os.platform()}` });

      for (const r of results) {
        const badge   = r.ok ? '✅' : '❌';
        const display = r.output.length > 900
          ? r.output.slice(0, 900) + '\n…(truncated)'
          : r.output;

        embed.addFields({
          name:   `${r.icon} ${r.label} (${r.id})  ${badge}`,
          value:  `\`\`\`\n${display || '(no output)'}\n\`\`\``,
          inline: false
        });
      }

      await interaction.editReply({ embeds: [embed] });

      logger.command(
        `service ${subcommand}`,
        interaction.user.tag,
        allOk,
        { targets, ok: results.map(r => ({ id: r.id, ok: r.ok })) }
      );

    } catch (error) {
      logger.error('Service command error', { subcommand, name: nameArg, error: error.message });
      await interaction.editReply({ content: `❌ Error: ${error.message}` });
    }
  }
};
