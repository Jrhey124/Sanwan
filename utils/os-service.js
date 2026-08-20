/**
 * utils/os-service.js
 *
 * OS detection and platform-specific service/daemon management for Sanwan.
 *
 * Exported surface
 * ────────────────
 *  detectPlatform()       → { name, platform, shell, packageManager, serviceManager }
 *  serviceInstall(opts)   → writes the service unit / plist / task, returns instructions
 *  serviceRemove(name)    → returns the shell command to uninstall the service
 *  serviceStart(name)     → returns the shell command to start the service
 *  serviceStop(name)      → returns the shell command to stop the service
 *  diskCommand()          → platform-appropriate disk-usage shell command
 *  resourceCommand()      → platform-appropriate CPU/memory shell command
 *  networkCommand()       → platform-appropriate network-info shell command
 *
 * These helpers return *strings* (shell commands) or write *files* rather than
 * running exec() directly — that keeps them testable and lets the caller decide
 * when to actually execute something.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── Platform detection ───────────────────────────────────────────────────────

/**
 * Return a rich descriptor of the current OS.
 *
 * @returns {{
 *   name: string,
 *   platform: string,
 *   arch: string,
 *   shell: string,
 *   packageManager: string,
 *   serviceManager: string
 * }}
 */
function detectPlatform() {
  const platform = os.platform();

  switch (platform) {
    case 'linux':
      return {
        name:           'Linux',
        platform,
        arch:           os.arch(),
        shell:          'bash',
        packageManager: 'apt / yum / pacman',
        serviceManager: 'systemd (systemctl)'
      };

    case 'darwin':
      return {
        name:           'macOS',
        platform,
        arch:           os.arch(),
        shell:          'zsh',
        packageManager: 'brew',
        serviceManager: 'launchd (launchctl)'
      };

    case 'win32':
      return {
        name:           'Windows',
        platform,
        arch:           os.arch(),
        shell:          'powershell',
        packageManager: 'winget / choco',
        serviceManager: 'Windows Service Manager (sc.exe / Task Scheduler)'
      };

    default:
      return {
        name:           `Unknown (${platform})`,
        platform,
        arch:           os.arch(),
        shell:          'sh',
        packageManager: 'unknown',
        serviceManager: 'unknown'
      };
  }
}

// ─── Service installation ─────────────────────────────────────────────────────

/**
 * Write a platform-appropriate service/daemon unit file and return
 * a human-readable object with { filePath, instructions[] }.
 *
 * @param {{
 *   name: string,        service identifier, e.g. "sanwan-bot"
 *   description: string,
 *   workingDir: string,  absolute path to the project root
 *   nodeExec: string,    path to node binary (process.execPath works)
 *   script: string,      relative script path, e.g. "sanwan.js"
 *   user?: string        (Linux/macOS) run-as user
 * }} opts
 */
function serviceInstall(opts) {
  const { name, description, workingDir, nodeExec, script, user } = opts;
  const platform = os.platform();

  if (platform === 'linux') {
    return _installSystemd({ name, description, workingDir, nodeExec, script, user });
  }

  if (platform === 'darwin') {
    return _installLaunchd({ name, description, workingDir, nodeExec, script, user });
  }

  if (platform === 'win32') {
    return _installWindowsTask({ name, description, workingDir, nodeExec, script });
  }

  return {
    filePath: null,
    instructions: [
      `Unsupported platform "${platform}".`,
      'Start the bot manually: node ' + script
    ]
  };
}

// ── Linux / systemd ────────────────────────────────────────────────────────

function _installSystemd({ name, description, workingDir, nodeExec, script, user }) {
  const unitContent = [
    '[Unit]',
    `Description=${description}`,
    'After=network.target',
    '',
    '[Service]',
    `Type=simple`,
    user ? `User=${user}` : `# User=<your-user>   ← uncomment and set`,
    `WorkingDirectory=${workingDir}`,
    `ExecStart=${nodeExec} ${path.join(workingDir, script)}`,
    'Restart=on-failure',
    'RestartSec=10',
    'StandardOutput=journal',
    'StandardError=journal',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    ''
  ].join('\n');

  const filePath = `/etc/systemd/system/${name}.service`;

  // Write to a local staging file — the user must copy it as root
  const stagingPath = path.join(workingDir, `${name}.service`);
  fs.writeFileSync(stagingPath, unitContent, 'utf8');

  return {
    filePath: stagingPath,
    instructions: [
      `Unit file staged at: ${stagingPath}`,
      `1. sudo cp ${stagingPath} ${filePath}`,
      `2. sudo systemctl daemon-reload`,
      `3. sudo systemctl enable ${name}`,
      `4. sudo systemctl start ${name}`,
      `5. sudo systemctl status ${name}`
    ]
  };
}

// ── macOS / launchd ────────────────────────────────────────────────────────

function _installLaunchd({ name, description, workingDir, nodeExec, script }) {
  const label    = `com.sanwan.${name}`;
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);

  const plistContent = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"',
    '  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key>           <string>${label}</string>`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    `    <string>${nodeExec}</string>`,
    `    <string>${path.join(workingDir, script)}</string>`,
    `  </array>`,
    `  <key>WorkingDirectory</key> <string>${workingDir}</string>`,
    `  <key>RunAtLoad</key>        <true/>`,
    `  <key>KeepAlive</key>        <true/>`,
    `  <key>StandardOutPath</key>  <string>${path.join(workingDir, 'data/logs/bot.log')}</string>`,
    `  <key>StandardErrorPath</key><string>${path.join(workingDir, 'data/logs/errors.log')}</string>`,
    '</dict>',
    '</plist>',
    ''
  ].join('\n');

  // Ensure LaunchAgents directory exists
  const launchAgentsDir = path.dirname(plistPath);
  if (!fs.existsSync(launchAgentsDir)) {
    fs.mkdirSync(launchAgentsDir, { recursive: true });
  }

  fs.writeFileSync(plistPath, plistContent, 'utf8');

  return {
    filePath: plistPath,
    instructions: [
      `Plist written to: ${plistPath}`,
      `1. launchctl load ${plistPath}`,
      `   (or) launchctl bootstrap gui/$(id -u) ${plistPath}`,
      `To stop:  launchctl unload ${plistPath}`,
      `To check: launchctl list | grep ${label}`
    ]
  };
}

// ── Windows / Task Scheduler ───────────────────────────────────────────────

function _installWindowsTask({ name, description, workingDir, nodeExec, script }) {
  // Build a minimal XML task definition
  const xmlContent = [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <RegistrationInfo>',
    `    <Description>${description}</Description>`,
    '  </RegistrationInfo>',
    '  <Triggers>',
    '    <BootTrigger><Enabled>true</Enabled></BootTrigger>',
    '  </Triggers>',
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <RestartOnFailure>',
    '      <Interval>PT1M</Interval><Count>3</Count>',
    '    </RestartOnFailure>',
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
    '  </Settings>',
    '  <Actions>',
    '    <Exec>',
    `      <Command>${nodeExec}</Command>`,
    `      <Arguments>${path.join(workingDir, script)}</Arguments>`,
    `      <WorkingDirectory>${workingDir}</WorkingDirectory>`,
    '    </Exec>',
    '  </Actions>',
    '</Task>',
    ''
  ].join('\r\n');

  const xmlPath = path.join(workingDir, `${name}-task.xml`);
  fs.writeFileSync(xmlPath, xmlContent, 'utf8');

  return {
    filePath: xmlPath,
    instructions: [
      `Task XML staged at: ${xmlPath}`,
      `Run in an elevated PowerShell:`,
      `  Register-ScheduledTask -TaskName "${name}" -Xml (Get-Content "${xmlPath}" | Out-String) -Force`,
      `To start:  Start-ScheduledTask -TaskName "${name}"`,
      `To stop:   Stop-ScheduledTask  -TaskName "${name}"`,
      `To status: Get-ScheduledTask   -TaskName "${name}"`
    ]
  };
}

// ─── Service control commands (return strings, not exec) ──────────────────────

function serviceRemove(name) {
  const p = os.platform();
  if (p === 'linux')  return `sudo systemctl disable ${name} && sudo rm /etc/systemd/system/${name}.service && sudo systemctl daemon-reload`;
  if (p === 'darwin') return `launchctl unload ~/Library/LaunchAgents/com.sanwan.${name}.plist && rm ~/Library/LaunchAgents/com.sanwan.${name}.plist`;
  if (p === 'win32')  return `Unregister-ScheduledTask -TaskName "${name}" -Confirm:$false`;
  return `# Manual removal required on ${p}`;
}

function serviceStart(name) {
  const p = os.platform();
  if (p === 'linux')  return `sudo systemctl start ${name}`;
  if (p === 'darwin') return `launchctl load ~/Library/LaunchAgents/com.sanwan.${name}.plist`;
  if (p === 'win32')  return `Start-ScheduledTask -TaskName "${name}"`;
  return `node sanwan.js`;
}

function serviceStop(name) {
  const p = os.platform();
  if (p === 'linux')  return `sudo systemctl stop ${name}`;
  if (p === 'darwin') return `launchctl unload ~/Library/LaunchAgents/com.sanwan.${name}.plist`;
  if (p === 'win32')  return `Stop-ScheduledTask -TaskName "${name}"`;
  return `# Manual stop required on ${p}`;
}

// ─── Platform-specific monitoring commands ────────────────────────────────────

function diskCommand() {
  const p = os.platform();
  if (p === 'win32')  return 'Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free';
  if (p === 'darwin') return 'df -h';
  return 'df -h';                  // Linux default
}

function resourceCommand() {
  const p = os.platform();
  if (p === 'win32')  return 'Get-Process | Sort-Object CPU -Desc | Select-Object -First 10 Name,CPU,WorkingSet';
  if (p === 'darwin') return "top -l 1 -stats pid,command,cpu,rsize | head -20";
  return "top -bn1 | head -20";    // Linux default
}

function networkCommand() {
  const p = os.platform();
  if (p === 'win32')  return 'Get-NetIPAddress | Select-Object InterfaceAlias,IPAddress,PrefixLength';
  if (p === 'darwin') return 'ifconfig | grep -E "^[a-z]|inet "';
  return 'ip addr show || ifconfig'; // Linux default
}

module.exports = {
  detectPlatform,
  serviceInstall,
  serviceRemove,
  serviceStart,
  serviceStop,
  diskCommand,
  resourceCommand,
  networkCommand
};
