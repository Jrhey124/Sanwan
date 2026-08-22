/**
 * commands/systeminfo.js
 *
 * /systeminfo — cross-platform system diagnostic command.
 *
 * Uses pure Node.js APIs (os module, fs.statSync) as the primary source
 * so it works identically on Windows, Linux, macOS, and cloud hosts
 * without requiring any shell, PowerShell, or system binary.
 *
 * Shell fallback is attempted for disk info only when Node APIs are
 * insufficient, with platform-safe command selection.
 */

'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const os     = require('os');
const fs     = require('fs');
const path   = require('path');
const { spawnSync } = require('child_process');
const { detectPlatform } = require('../utils/os-service');
const logger = require('../utils/logger');

// ─── Pure-Node helpers ────────────────────────────────────────────────────────

/** Format bytes into a human-readable string. */
function _bytes(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Disk usage — try Node's fs.statfsSync (Node ≥18.15 on all platforms),
 * fall back to a safe shell command if unavailable.
 *
 * Returns a formatted string.
 */
function _diskInfo() {
  // fs.statfsSync is available on Node ≥18.15 (Linux/macOS/Windows)
  if (typeof fs.statfsSync === 'function') {
    try {
      const stat  = fs.statfsSync(os.platform() === 'win32' ? 'C:\\' : '/');
      const total = stat.blocks * stat.bsize;
      const free  = stat.bfree  * stat.bsize;
      const used  = total - free;
      const pct   = total > 0 ? ((used / total) * 100).toFixed(1) : '?';
      return [
        `Root filesystem`,
        `  Total : ${_bytes(total)}`,
        `  Used  : ${_bytes(used)} (${pct}%)`,
        `  Free  : ${_bytes(free)}`
      ].join('\n');
    } catch (err) {
      // statfsSync can fail on certain virtual filesystems — fall through
    }
  }

  // Shell fallback — platform-safe, no PowerShell cmdlets
  const p = os.platform();
  let result;
  if (p === 'win32') {
    // wmic is available on all Windows versions that run Node ≥18
    result = spawnSync('wmic', ['logicaldisk', 'get', 'caption,freespace,size'], {
      timeout: 8000, encoding: 'utf8', windowsHide: true
    });
  } else {
    result = spawnSync('df', ['-h', '-x', 'tmpfs', '-x', 'devtmpfs'], {
      timeout: 8000, encoding: 'utf8'
    });
  }

  if (result && result.status === 0 && result.stdout) {
    return result.stdout.trim();
  }
  return result?.stderr?.trim() || 'Disk info unavailable';
}

/**
 * CPU and memory — pure Node.js, works everywhere.
 */
function _resourceInfo() {
  const totalMem = os.totalmem();
  const freeMem  = os.freemem();
  const usedMem  = totalMem - freeMem;
  const memPct   = ((usedMem / totalMem) * 100).toFixed(1);

  const cpus    = os.cpus();
  const cpuName = cpus.length > 0 ? cpus[0].model.trim() : 'unknown';
  const cores   = cpus.length;

  // CPU load average — not available on Windows, returns empty array
  const load = os.loadavg();
  const loadStr = load[0] > 0
    ? `${load[0].toFixed(2)} / ${load[1].toFixed(2)} / ${load[2].toFixed(2)} (1m/5m/15m)`
    : 'N/A (Windows)';

  return [
    `CPU   : ${cpuName} (${cores} core${cores !== 1 ? 's' : ''})`,
    `Load  : ${loadStr}`,
    `Memory: ${_bytes(usedMem)} used / ${_bytes(totalMem)} total (${memPct}% used)`,
    `Free  : ${_bytes(freeMem)}`
  ].join('\n');
}

/**
 * Network interfaces — pure Node.js, works everywhere.
 */
function _networkInfo() {
  const ifaces = os.networkInterfaces();
  const lines  = [];

  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const a of addrs) {
      // Skip internal loopback and link-local entries
      if (a.internal) continue;
      lines.push(`${name.padEnd(16)} ${a.family.padEnd(6)} ${a.address}`);
    }
  }

  return lines.length > 0
    ? lines.join('\n')
    : 'No external network interfaces found';
}

// ─── Embed builder ────────────────────────────────────────────────────────────

/** Trim text to fit a Discord embed field (1024 char limit). */
function _trim(text, max) {
  max = max || 900;
  return text.length > max ? text.slice(0, max) + '\n…(truncated)' : text;
}

// ─── Module export ────────────────────────────────────────────────────────────

module.exports = {
  name:        'systeminfo',
  description: 'Show disk, CPU/memory, and network information',

  data: new SlashCommandBuilder()
    .setName('systeminfo')
    .setDescription('Show disk, CPU/memory, and network information on this host')
    .addStringOption(opt =>
      opt
        .setName('section')
        .setDescription('Which section to show (default: all)')
        .setRequired(false)
        .addChoices(
          { name: 'All',       value: 'all'       },
          { name: 'Disks',     value: 'disks'     },
          { name: 'Resources', value: 'resources' },
          { name: 'Network',   value: 'network'   }
        )
    ),

  async run(interaction) {
    await interaction.deferReply();

    const section  = interaction.options.getString('section') || 'all';
    const platform = detectPlatform();

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📊 System Info — ${platform.name} (${platform.arch})`)
      .setTimestamp()
      .setFooter({ text: `Requested by ${interaction.user.tag}` });

    if (section === 'all' || section === 'disks') {
      embed.addFields({
        name:   '💾 Disk Usage',
        value:  `\`\`\`\n${_trim(_diskInfo())}\n\`\`\``,
        inline: false
      });
    }

    if (section === 'all' || section === 'resources') {
      embed.addFields({
        name:   '⚙️ CPU & Memory',
        value:  `\`\`\`\n${_trim(_resourceInfo())}\n\`\`\``,
        inline: false
      });
    }

    if (section === 'all' || section === 'network') {
      embed.addFields({
        name:   '🌐 Network',
        value:  `\`\`\`\n${_trim(_networkInfo())}\n\`\`\``,
        inline: false
      });
    }

    await interaction.editReply({ embeds: [embed] });

    logger.command('systeminfo', interaction.user.tag, true, { section });
  }
};
