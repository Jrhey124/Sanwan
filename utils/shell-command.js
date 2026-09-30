'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { tokenizeArguments } = require('./arguments');

const SHELLS = new Set([
  'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe',
  'sh', 'bash', 'dash', 'zsh', 'fish', 'ksh', 'csh', 'tcsh', 'ash', 'nu'
]);

function resolveShellCommand(entry, getValue = () => undefined) {
  if (!entry || entry.type !== 'shell' || entry.enabled === false) {
    throw new Error('Shortcut is not an enabled shell command.');
  }
  const executable = entry.filepath;
  if (typeof executable !== 'string' || !executable.trim()) {
    throw new Error('Shortcut has no executable configured.');
  }

  const template = entry.command || `${executable}${entry.params ? ` ${entry.params}` : ''}`;
  if (!template.startsWith(executable) || (template.length > executable.length && !/\s/.test(template[executable.length]))) {
    throw new Error('Shortcut command must begin with its configured executable path.');
  }
  const argsTemplate = template.slice(executable.length).trim();
  const args = tokenizeArguments(argsTemplate);
  const placeholders = new Set([...argsTemplate.matchAll(/\{(\w+)\}/g)].map(([, name]) => name));
  const executableName = path.win32.basename(executable).toLowerCase().replace(/\.exe$/i, '');
  if (placeholders.size > 0 && SHELLS.has(executableName)) {
    throw new Error('Placeholders are not allowed for shell interpreter shortcuts.');
  }

  const resolvedArgs = args.map(arg => arg.replace(/\{(\w+)\}/g, (_match, name) => {
    const value = getValue(name);
    if (value === null || value === undefined) throw new Error(`Missing value for required placeholder {${name}}.`);
    return String(value);
  }));
  return { executable, args: resolvedArgs };
}

function runShellCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, { windowsHide: true, shell: false });
    const maxBuffer = options.maxBuffer ?? 1024 * 1024;
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;

    const finish = (error, output) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`Command timed out after ${options.timeout ?? 15_000} ms.`));
    }, options.timeout ?? 15_000);

    const collect = (target, chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxBuffer) {
        child.kill();
        finish(new Error(`Command output exceeded ${maxBuffer} bytes.`));
        return;
      }
      target.push(chunk);
    };

    child.stdout.on('data', chunk => collect(stdout, chunk));
    child.stderr.on('data', chunk => collect(stderr, chunk));
    child.on('error', error => finish(error));
    child.on('close', (code, signal) => {
      if (settled) return;
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) {
        const error = new Error(signal ? `Command terminated by ${signal}.` : `Command exited with status ${code}.`);
        error.stderr = err;
        error.stdout = out;
        finish(error);
      } else {
        finish(null, out.trim());
      }
    });
  });
}

function parseScheduleInvocation(invocation) {
  if (typeof invocation !== 'string') throw new Error('Scheduled command must be text.');
  const match = invocation.trim().match(/^\/cmd\s+(\S+)(?:\s+([\s\S]+))?$/);
  if (!match) throw new Error('Use `/cmd <shortcut-id> {"placeholder":"value"}` with an enabled registry shortcut.');
  let values = {};
  if (match[2]) {
    try { values = JSON.parse(match[2]); }
    catch { throw new Error('Scheduled command arguments must be a valid JSON object.'); }
    if (!values || Array.isArray(values) || typeof values !== 'object' || Object.values(values).some(value => !['string', 'number', 'boolean'].includes(typeof value))) {
      throw new Error('Scheduled command arguments must be a JSON object containing only strings, numbers, or booleans.');
    }
    values = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  }
  return { shortcutId: match[1], values };
}

async function runScheduledShortcut(invocation, allowedCommands) {
  const { shortcutId, values } = parseScheduleInvocation(invocation);
  const entry = allowedCommands.find(item => item.id === shortcutId && item.type === 'shell' && item.enabled !== false);
  if (!entry) throw new Error(`No enabled shell shortcut named "${shortcutId}" is registered.`);
  const command = resolveShellCommand(entry, name => values[name.toLowerCase()]);
  return (await runShellCommand(command)) || '(no output)';
}

module.exports = { resolveShellCommand, runShellCommand, parseScheduleInvocation, runScheduledShortcut };
