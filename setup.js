#!/usr/bin/env node
/**
 * setup.js  —  Sanwan interactive setup wizard
 *
 * Steps
 * ─────
 *  0.  .env overwrite-or-update guard
 *  1.  Detect and report host OS
 *  2.  Create required data directories
 *  3.  Build / update .env  (Discord, AI, encryption key, GitHub webhook)
 *  4.  Discover available /cmd command files
 *  5.  Allowed-commands registry  (add / remove / update per record)
 *  5b. Role-based permissions     (per-command Discord role mapping)
 *  6.  Discord error-log channel
 *  7.  Log-sources registry       (add / remove / update per record)
 *  7b. Deploy-services registry   (add / remove / update per record)
 *  8.  GitHub webhook instructions
 *  9.  Daemon / service installation
 * 10.  Initialise encrypted data files
 * 11.  Initialise plain data files
 * 12.  Initialise log files
 * 13.  Persist settings
 * 14.  Next-step instructions
 *
 * Re-running setup is always safe — every step checks existing values
 * before prompting and uses the current value as the default.
 */

'use strict';

require('dotenv').config();

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const os       = require('os');

const { generateKey }              = require('./utils/crypto');
const { detectPlatform, serviceInstall } = require('./utils/os-service');

// ─── Terminal colours ─────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m'
};

function print(msg, colour = 'reset') {
  console.log(`${C[colour]}${msg}${C.reset}`);
}

function section(title) {
  print(`\n${'─'.repeat(56)}`, 'cyan');
  print(`  ${title}`, 'bold');
  print('─'.repeat(56), 'cyan');
}

function hint(msg) {
  print(`  ${msg}`, 'dim');
}

// ─── Readline ─────────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(prompt) {
  return new Promise(resolve => rl.question(prompt, a => resolve(a.trim())));
}

async function confirm(prompt, defaultYes = false) {
  const tag = defaultYes ? '[Y/n]' : '[y/N]';
  const raw = await ask(`${prompt} ${tag}: `);
  if (raw === '') return defaultYes;
  return /^y(es)?$/i.test(raw);
}

// ─── .env helpers ─────────────────────────────────────────────────────────────

const ENV_PATH = path.join(__dirname, '.env');

function parseEnvFile(p) {
  if (!fs.existsSync(p)) return {};
  const out = {};
  fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
    const eq = line.indexOf('=');
    if (eq < 1) return;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k) out[k] = v;
  });
  return out;
}

function writeEnvFile(vars) {
  fs.writeFileSync(
    ENV_PATH,
    Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n',
    'utf8'
  );
}

/**
 * Resolve SETTINGS_PATH to the key that storage.encryptedRead / encryptedWrite
 * expects — i.e. the path RELATIVE TO storage's data/ directory.
 *
 * SETTINGS_PATH in .env is typically "./data/settings.enc".
 * storage resolves filenames against its own dataDir (./data/), so the correct
 * key is just "settings.enc" — not "data/settings.enc".
 *
 * Stripping rules (applied in order, first match wins):
 *   1. Remove a leading "./data/"  → "settings.enc"
 *   2. Remove a leading "data/"   → "settings.enc"
 *   3. Remove a leading "./"      → whatever remains (e.g. "settings.enc")
 *   4. Return as-is               (already a bare filename)
 */
function settingsStorageKey() {
  const raw = process.env.SETTINGS_PATH || './data/settings.enc';
  return raw
    .replace(/^\.\/data\//, '')   // ./data/settings.enc → settings.enc
    .replace(/^data\//, '')       // data/settings.enc  → settings.enc
    .replace(/^\.\//, '');        // ./settings.enc     → settings.enc
}

// ─── Step 0 — .env overwrite-or-update guard ─────────────────────────────────

async function step0EnvGuard() {
  section('Step 0 — Existing Configuration Check');

  if (!fs.existsSync(ENV_PATH)) {
    print('  No .env file found — a new one will be created.', 'green');
    return 'create';
  }

  const existing = parseEnvFile(ENV_PATH);
  const keyCount = Object.keys(existing).length;
  print(`  Found .env with ${keyCount} key(s).`, 'yellow');

  const choice = await ask(
    '  What would you like to do?\n' +
    '    [1] Update — keep existing values, prompt only for missing/changed ones\n' +
    '    [2] Overwrite — re-enter every value from scratch\n' +
    '    [3] Skip — keep .env as-is and continue to other setup steps\n' +
    '  Choice [1]: '
  );

  if (choice === '2') {
    print('  ✓ Will overwrite .env from scratch.', 'yellow');
    return 'overwrite';
  }
  if (choice === '3') {
    print('  ✓ Keeping .env unchanged.', 'green');
    // Still reload into process.env so subsequent steps see the values
    Object.assign(process.env, existing);
    return 'skip';
  }
  // Default: update
  print('  ✓ Will update .env — press Enter on any prompt to keep current value.', 'yellow');
  return 'update';
}

// ─── Step 1 — OS detection ────────────────────────────────────────────────────

function step1DetectOS() {
  section('Step 1 — Host Operating System');
  const info = detectPlatform();

  print(`  OS              : ${info.name}`,             'green');
  print(`  Platform        : ${info.platform}`);
  print(`  Architecture    : ${info.arch}`);
  print(`  Shell           : ${info.shell}`);
  print(`  Package manager : ${info.packageManager}`);
  print(`  Service manager : ${info.serviceManager}`);

  return info;
}

// ─── Step 2 — Directories ─────────────────────────────────────────────────────

function step2Directories() {
  section('Step 2 — Directory Structure');

  const dirs = [
    'data', 'data/tasks', 'data/schedules',
    'data/notes', 'data/logs', 'data/backups',
    'commands', 'utils'
  ];

  dirs.forEach(rel => {
    const full = path.join(__dirname, rel);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(full, { recursive: true });
      print(`  ✓ Created : ${rel}`, 'green');
    } else {
      print(`  · Exists  : ${rel}`, 'dim');
    }
  });
}

// ─── Step 3 — Build .env ─────────────────────────────────────────────────────

async function step3BuildEnv(mode) {
  section('Step 3 — Environment Variables (.env)');

  if (mode === 'skip') {
    print('  Skipped (keep existing).', 'yellow');
    return parseEnvFile(ENV_PATH);
  }

  const existing = mode === 'overwrite' ? {} : parseEnvFile(ENV_PATH);

  // Helper: ask with current-value hint
  async function askVar(key, label, fallback = '') {
    const cur     = existing[key] || fallback;
    const preview = cur
      ? ` (current: ${cur.substring(0, 28)}${cur.length > 28 ? '…' : ''})`
      : '';
    const answer = await ask(`  ${label}${preview}\n  ${key}: `);
    return answer !== '' ? answer : cur;
  }

  const vars = { ...existing };

  // Discord ──────────────────────────────────────────────────────────────────
  print('\n  Discord credentials (required):', 'cyan');
  vars.DISCORD_TOKEN = await askVar('DISCORD_TOKEN', 'Bot token from discord.com/developers');
  vars.CLIENT_ID     = await askVar('CLIENT_ID',     'Application / Client ID');
  vars.GUILD_ID      = await askVar('GUILD_ID',      'Server (Guild) ID');

  // AI ───────────────────────────────────────────────────────────────────────
  const hasAI = !!(existing.AI_PROVIDER || existing.AI_TOKEN || existing.AI_MODEL);
  const setupAI = await confirm(
    `\n  Configure AI provider?${hasAI ? ' (already configured)' : ''}`,
    hasAI
  );
  if (setupAI) {
    print('  AI provider:', 'cyan');
    vars.AI_PROVIDER = await askVar('AI_PROVIDER', 'Provider: openai / anthropic / ollama');
    vars.AI_TOKEN    = await askVar('AI_TOKEN',    'API token (blank for ollama)');
    vars.AI_MODEL    = await askVar('AI_MODEL',    'Model e.g. gpt-4 / claude-3-opus / llama3');
  } else {
    print('  · AI provider skipped.', 'dim');
    // Preserve any existing values unchanged
    vars.AI_PROVIDER = existing.AI_PROVIDER || '';
    vars.AI_TOKEN    = existing.AI_TOKEN    || '';
    vars.AI_MODEL    = existing.AI_MODEL    || '';
  }

  // Encryption key ───────────────────────────────────────────────────────────
  print('\n  Encryption key:', 'cyan');
  let settingsKey = await askVar('SETTINGS_KEY', '64-hex key (auto-generated if blank)');
  if (!settingsKey) {
    settingsKey = generateKey();
    print(`  ✓ Generated SETTINGS_KEY: ${settingsKey.slice(0, 20)}…`, 'green');
  }
  vars.SETTINGS_KEY  = settingsKey;
  vars.SETTINGS_PATH = await askVar('SETTINGS_PATH', 'Settings file path', './data/settings.enc');

  // GitHub webhook ───────────────────────────────────────────────────────────
  const hasWebhook = !!(existing.GITHUB_WEBHOOK_SECRET);
  const setupWebhook = await confirm(
    `\n  Configure GitHub webhook?${hasWebhook ? ' (already configured)' : ''}`,
    hasWebhook
  );
  if (setupWebhook) {
    print('  GitHub webhook:', 'cyan');
    vars.GITHUB_WEBHOOK_SECRET = await askVar('GITHUB_WEBHOOK_SECRET', 'HMAC secret (set the same value in GitHub repo → Settings → Webhooks)');
    vars.GITHUB_WEBHOOK_PORT   = await askVar('GITHUB_WEBHOOK_PORT',   'Listen port', '3000');
    vars.GITHUB_WEBHOOK_PATH   = await askVar('GITHUB_WEBHOOK_PATH',   'URL path',    '/webhook');
  } else {
    print('  · GitHub webhook skipped.', 'dim');
    vars.GITHUB_WEBHOOK_SECRET = existing.GITHUB_WEBHOOK_SECRET || '';
    vars.GITHUB_WEBHOOK_PORT   = existing.GITHUB_WEBHOOK_PORT   || '3000';
    vars.GITHUB_WEBHOOK_PATH   = existing.GITHUB_WEBHOOK_PATH   || '/webhook';
  }

  writeEnvFile(vars);
  Object.assign(process.env, vars);
  print('\n  ✓ .env written.', 'green');

  return vars;
}

// ─── Step 3b — Stale encrypted file detection ────────────────────────────────
//
// Encrypted files on disk become unreadable whenever SETTINGS_KEY changes
// (or when setup created them before the key was available).  Detect this
// early — before any step tries to read them — and offer to delete+recreate
// them so the rest of setup can proceed cleanly.
//
// Files checked: data/registry.enc, data/settings.enc (and notes.enc)

async function step3bCheckStaleEncFiles() {
  if (!process.env.SETTINGS_KEY) return; // nothing to check without a key

  const dataDir   = path.join(__dirname, 'data');
  const storage   = require('./utils/storage');

  // Every encrypted file the bot manages
  const encFiles = [
    'registry.enc',
    'settings.enc',
    path.join('notes', 'notes.enc')
  ];

  const stale = [];

  for (const rel of encFiles) {
    const full = path.join(dataDir, rel);
    if (!fs.existsSync(full)) continue; // doesn't exist → fine

    try {
      storage.encryptedRead(rel, null); // attempt decryption with current key
    } catch (err) {
      if (err.code === 'ERR_KEY_MISMATCH' || err.message.includes('cannot be decrypted')) {
        stale.push({ rel, full });
      }
      // Any other error (missing key, etc.) is not our problem here
    }
  }

  if (stale.length === 0) return; // all good

  // ── Warn and offer recovery ───────────────────────────────────────────────
  section('Step 3b — Stale Encrypted Files Detected');

  print('  The following file(s) were encrypted with a different SETTINGS_KEY', 'yellow');
  print('  and cannot be read with the current key:\n', 'yellow');
  stale.forEach(({ rel }) => print(`    • data/${rel}`, 'red'));

  print('\n  This happens when the key changed between setup runs.', 'yellow');
  print('  The only recovery option is to delete and recreate them.', 'yellow');
  print('  All stored data (allowed-commands, log sources, services) will be lost.\n', 'yellow');

  const reset = await confirm(
    '  Delete and recreate stale encrypted files now?',
    true
  );

  if (!reset) {
    print('  Skipped — encrypted steps will likely fail.', 'red');
    print('  To fix manually: delete the files listed above, then re-run setup.', 'yellow');
    return;
  }

  // Backup then delete each stale file
  const backupDir = path.join(dataDir, 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  for (const { rel, full } of stale) {
    const stamp  = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(backupDir, `${path.basename(rel, '.enc')}_stale_${stamp}.enc`);

    fs.copyFileSync(full, backup);
    fs.unlinkSync(full);

    print(`  ✓ Backed up data/${rel} → backups/${path.basename(backup)}`, 'green');
    print(`  ✓ Deleted data/${rel}`, 'green');
  }

  print('\n  Stale files removed. Setup will recreate them with the current key.', 'green');
}

// ─── Step 4 — Command discovery ───────────────────────────────────────────────

function step4DiscoverCommands() {
  section('Step 4 — Command Discovery');

  const dir = path.join(__dirname, 'commands');
  if (!fs.existsSync(dir)) {
    print('  ⚠ commands/ directory not found.', 'yellow');
    return [];
  }

  const commands = [];
  fs.readdirSync(dir).filter(f => f.endsWith('.js')).forEach(file => {
    try {
      const full = path.join(dir, file);
      delete require.cache[require.resolve(full)];
      const cmd = require(full);
      if (cmd.name && typeof cmd.run === 'function') {
        commands.push({ name: cmd.name, file, description: cmd.description || '' });
        print(`  ✓ /${cmd.name.padEnd(14)} ${cmd.description || ''}`, 'green');
      } else {
        print(`  ✗ ${file}: missing name or run()`, 'red');
      }
    } catch (err) {
      print(`  ✗ ${file}: ${err.message}`, 'red');
    }
  });

  print(`\n  Discovered: ${commands.length} command(s)`);
  return commands;
}

// ─── Step 5 — Allowed-commands registry ──────────────────────────────────────
//
// Three sub-steps, in order:
//   5a. /help is silently added — no prompt, always enabled.
//   5b. One yes/no prompt for diagnostic tools (/disks, /resources, /network).
//   5c. Owner enters explicit shell commands (one per line, blank = done).
//       Each entry may contain {param} placeholders.
//       Stored encrypted via registry.allowedCommands.
//
// The registry stores two kinds of record:
//   • Bot slash-commands  → { id, name, description, enabled, type: 'bot' }
//   • Owner shell commands → { id, name, description, enabled, type: 'shell', command }
//       "command" is the raw shell string, e.g. "script1.exe {param1} {param2}"

async function step5AllowedCommands() {
  section('Step 5 — Allowed Commands');

  if (!process.env.SETTINGS_KEY) {
    print('  ⚠ SETTINGS_KEY not set — skipping.', 'yellow');
    return;
  }

  const registry = require('./utils/registry');

  // ── 5a. /help — always enabled, no prompt ────────────────────────────────
  _ensureHelpEnabled(registry);
  print('  ✓ /help — always enabled.', 'green');

  // ── 5b. Diagnostic tools ─────────────────────────────────────────────────
  const diagnostics = ['disks', 'resources', 'network'];

  const enableDiag = await confirm(
    '\n  Enable basic diagnostic tools? (/disks, /resources, /network)',
    false
  );

  for (const name of diagnostics) {
    _setSlashCommand(registry, name, enableDiag,
      `Show ${name} status`);
  }

  print(
    enableDiag
      ? '  ✓ Diagnostic tools enabled.'
      : '  · Diagnostic tools disabled.',
    enableDiag ? 'green' : 'dim'
  );

  // ── 5c. Explicit owner shell commands ────────────────────────────────────
  print('\n  Define explicit commands Sanwan is allowed to run.', 'cyan');
  hint('Enter one command per line. Use {name} for parameters.');
  hint('Examples:  script.exe');
  hint('           script1.exe {param1} {param2}');
  hint('           cat script.exe');
  hint('Leave a blank line when done.');

  // Show existing shell commands so re-running setup is non-destructive
  const existing = registry.listAllowedCommands().filter(r => r.type === 'shell');
  if (existing.length > 0) {
    print('\n  Currently registered shell commands:', 'cyan');
    existing.forEach(r => {
      const flag = r.enabled ? '✓' : '✗';
      print(`    ${flag}  ${r.command}`, r.enabled ? 'green' : 'dim');
    });
    print('');
  }

  // Collect new entries until blank line
  const added = [];
  while (true) {
    const line = await ask('  > ');
    if (line === '') break;

    // Use the base executable/command as the ID (stripped of params)
    const id = _shellCommandId(line);

    // If this ID already exists, update it; otherwise add
    const existingEntry = registry.listAllowedCommands().find(r => r.id === id);
    if (existingEntry) {
      registry.updateAllowedCommand(id, { command: line, enabled: true });
      print(`    ↺ Updated: ${line}`, 'yellow');
    } else {
      registry.addAllowedCommand({
        id,
        name:        id,
        description: `Owner shell command: ${line}`,
        enabled:     true,
        type:        'shell',
        command:     line
      });
      print(`    ✓ Added: ${line}`, 'green');
    }
    added.push(line);
  }

  if (added.length === 0 && existing.length === 0) {
    print('  · No shell commands registered.', 'dim');
  } else {
    print(`\n  ✓ Shell commands saved (${added.length} new, ${existing.length} pre-existing).`, 'green');
  }
}

/**
 * Ensure /help is always present and enabled.
 * Called silently — no user prompt.
 *
 * @param {object} registry
 */
function _ensureHelpEnabled(registry) {
  const entry = registry.listAllowedCommands().find(r => r.id === 'help');
  if (!entry) {
    registry.addAllowedCommand({
      id:          'help',
      name:        'help',
      description: 'Always permitted',
      enabled:     true,
      type:        'bot'
    });
  } else if (!entry.enabled) {
    registry.updateAllowedCommand('help', { enabled: true });
  }
}

/**
 * Add or update a slash-command entry (bot type) in the registry.
 *
 * @param {object}  registry
 * @param {string}  name
 * @param {boolean} enabled
 * @param {string}  description
 */
function _setSlashCommand(registry, name, enabled, description) {
  const entry = registry.listAllowedCommands().find(r => r.id === name);
  if (entry) {
    registry.updateAllowedCommand(name, { enabled });
  } else {
    registry.addAllowedCommand({ id: name, name, description, enabled, type: 'bot' });
  }
}

/**
 * Derive a stable registry ID from a raw shell command string.
 * Takes the first token (the executable / verb), strips path separators
 * and extension so "path/to/script.exe" becomes "script".
 *
 * @param {string} commandLine  e.g. "script1.exe {param1}"
 * @returns {string}
 */
function _shellCommandId(commandLine) {
  const base  = commandLine.trim().split(/\s+/)[0];        // first token
  const noExt = base.replace(/\.[^/.]+$/, '');              // strip extension
  const name  = noExt.replace(/.*[/\\]/, '');               // strip path prefix
  // Append a short hash so two different commands with the same binary name
  // can coexist (e.g. "script.exe start" vs "script.exe stop").
  const hash  = commandLine.trim().split('').reduce(
    (acc, ch) => (acc * 31 + ch.charCodeAt(0)) & 0xffff, 0
  ).toString(16).padStart(4, '0');
  return `${name}_${hash}`;
}

// ─── Step 5b — Role-based permissions ────────────────────────────────────────

async function step5bRolePermissions(commands) {
  section('Step 5b — Role-Based Permission Mapping');

  if (!process.env.SETTINGS_KEY) {
    print('  ⚠ SETTINGS_KEY not set — skipping.', 'yellow');
    return;
  }

  const perms   = require('./utils/permissions');
  const roleMap = perms.loadRoleMap();

  hint('Assign Discord role IDs to control who can run each command.');
  hint('Leave roles blank to allow ALL members to run the command.');
  hint('Role IDs look like: 1234567890123456789  (find in Discord → Server Settings → Roles)');

  const configure = await confirm('\n  Configure role-based permissions now?', false);
  if (!configure) {
    print('  Skipped — all commands open to all members.', 'yellow');
    return;
  }

  // Show current mappings
  const existing = perms.listRoleMap();
  if (existing.length > 0) {
    print('\n  Current role mappings:', 'cyan');
    existing.forEach(e => {
      const roles = e.requiredRoles.length ? e.requiredRoles.join(', ') : '(all members)';
      print(`    /${e.command.padEnd(14)} → ${roles}`);
    });
  }

  print('\n  Enter configuration for each command.', 'yellow');
  print('  Press Enter to keep the current setting (or skip with no change).', 'dim');

  const sensitiveByDefault = ['deploy', 'status', 'schedule', 'logs'];

  for (const cmd of commands) {
    if (cmd.name === 'help') continue; // always open

    const cur = roleMap[cmd.name];
    const curRoles = cur?.requiredRoles?.join(', ') || '';

    print(`\n  /${cmd.name}  (${cmd.description || 'no description'})`, 'cyan');

    if (cur) {
      print(`    Current roles: ${curRoles || '(all members)'}`, 'dim');
    } else if (sensitiveByDefault.includes(cmd.name)) {
      print(`    Suggested: restrict to admin/moderator role`, 'yellow');
    }

    const rolesInput = await ask(
      `    Role IDs (comma-separated, blank = all members): `
    );

    const roles = rolesInput
      ? rolesInput.split(',').map(r => r.trim()).filter(Boolean)
      : (cur?.requiredRoles ?? []);

    const requireAll = roles.length > 1
      ? await confirm(`    Require ALL of these roles (not just one)?`, false)
      : false;

    const description = await ask(
      `    Description${cur?.description ? ` (current: "${cur.description}")` : ''}: `
    ) || cur?.description || cmd.description || '';

    perms.setCommandRoles(cmd.name, { requiredRoles: roles, requireAll, description, enabled: true });
    print(`    ✓ /${cmd.name} → ${roles.length ? roles.join(', ') : 'all members'}`, 'green');
  }

  print('\n  ✓ Role permissions saved.', 'green');
}

// ─── Step 6 — Discord error-log channel ──────────────────────────────────────

async function step6ErrorLog() {
  section('Step 6 — Discord Error-Log Channel');

  hint('Errors will be posted to this Discord channel as embeds.');

  const storage = require('./utils/storage');
  const file    = settingsStorageKey();

  let current = null;
  if (process.env.SETTINGS_KEY) {
    try {
      const s = storage.encryptedRead(file, {});
      current = s?.bot?.errorChannel || null;
    } catch { /* file may not exist yet */ }
  }

  if (current) print(`  Current channel: ${current}`, 'dim');

  const setup = await confirm('  Configure an error-log channel?', false);
  if (!setup) {
    print('  Skipped.', 'yellow');
    return { errorChannelId: current };
  }

  const channelId = await ask('  Paste the Discord Channel ID: ');
  if (!channelId) {
    print('  No ID entered — kept unchanged.', 'yellow');
    return { errorChannelId: current };
  }

  print(`  ✓ Error channel set to ${channelId}`, 'green');
  return { errorChannelId: channelId };
}

// ─── Step 7 — Log-sources registry ───────────────────────────────────────────
//
// One yes/no gate: "Allow to streamline logs? [y/N]"
// If yes: keep asking "<title> <path>" pairs until a blank line is entered.
// /logs and /errors both read from these sources directly.
// Existing sources are shown; re-running setup is non-destructive.

async function step7LogSources() {
  section('Step 7 — Log Sources');

  if (!process.env.SETTINGS_KEY) {
    print('  ⚠ SETTINGS_KEY not set — skipping.', 'yellow');
    return;
  }

  const registry = require('./utils/registry');
  const current  = registry.listLogSources();

  const enable = await confirm('  Allow Sanwan to streamline logs?', false);
  if (!enable) {
    print('  · Log sources disabled.', 'dim');
    return;
  }

  // Show existing sources
  if (current.length > 0) {
    print('\n  Currently registered log sources:', 'cyan');
    current.forEach(s => {
      print(`    ✓  ${s.name.padEnd(16)} ${s.path}`, 'green');
    });
  }

  print('\n  Enter log sources — one per line as:  <title> <path>', 'cyan');
  hint('Example:  service1 /var/log/service1.log');
  hint('          service2 /var/log/service2.log');
  hint('Leave a blank line when done.');

  const added = [];
  while (true) {
    const line = await ask('  > ');
    if (line === '') break;

    // Split on first whitespace: everything before is the title, rest is path
    const spaceIdx = line.search(/\s/);
    if (spaceIdx === -1) {
      print('  ✗ Format must be: <title> <path>  (space-separated)', 'red');
      continue;
    }

    const title = line.slice(0, spaceIdx).trim();
    const src   = line.slice(spaceIdx + 1).trim();

    if (!title || !src) {
      print('  ✗ Both title and path are required.', 'red');
      continue;
    }

    const existingEntry = registry.listLogSources().find(r => r.id === title);
    if (existingEntry) {
      registry.updateLogSource(title, { path: src });
      print(`    ↺ Updated: ${title} → ${src}`, 'yellow');
    } else {
      try {
        registry.addLogSource({ id: title, name: title, path: src, enabled: true });
        print(`    ✓ Added: ${title} → ${src}`, 'green');
        added.push(title);
      } catch (err) {
        print(`    ✗ ${err.message}`, 'red');
      }
    }
  }

  print(
    `\n  ✓ Log sources saved (${added.length} new, ${current.length} pre-existing).`,
    'green'
  );
}

// ─── Step 7b — Deploy-services registry ──────────────────────────────────────
//
// Prompt: "Add or manage a service? [Y/n]"
// Options in a loop: [a]dd / [r]emove / [u]pdate / [l]ist / [d]one
// Each add collects all fields in one block (blank = optional / skip).
// Used by both /schedule and /deploy.

async function step7bDeployServices() {
  section('Step 7b — Services  (/deploy and /schedule)');

  if (!process.env.SETTINGS_KEY) {
    print('  ⚠ SETTINGS_KEY not set — skipping.', 'yellow');
    return;
  }

  const registry = require('./utils/registry');
  const current  = registry.listDeployServices();

  if (current.length > 0) {
    print('\n  Current services:', 'cyan');
    current.forEach(s => {
      const flag = s.enabled ? '✓' : '✗';
      print(`    ${flag}  ${s.id.padEnd(16)} ${s.description || s.name}`, s.enabled ? 'green' : 'dim');
    });
  }

  const manage = await confirm('\n  Add or manage a service?', true);
  if (!manage) {
    print('  Skipped.', 'yellow');
    return;
  }


  let loop = true;
  while (loop) {
    hint('[a]dd · [r]emove · [u]pdate · [l]ist · [d]one');
    const action = (await ask('\n  Action [a]: ')).toLowerCase() || 'a';

    switch (action) {

      // ── Done ──────────────────────────────────────────────────────────────
      case 'd':
        loop = false;
        break;

      // ── List ──────────────────────────────────────────────────────────────
      case 'l':
        registry.listDeployServices().forEach(s => {
          print(`    ${s.id.padEnd(16)}  start: ${s.startCmd || '(none)'}`, 'cyan');
        });
        break;

      // ── Remove ────────────────────────────────────────────────────────────
      case 'r': {
        const id = await ask('  Service ID to remove: ');
        const ok = registry.removeDeployService(id);
        print(ok ? `  ✓ Removed: ${id}` : `  ✗ Not found: ${id}`, ok ? 'green' : 'red');
        break;
      }

      // ── Update ────────────────────────────────────────────────────────────
      case 'u': {
        const id  = await ask('  Service ID to update: ');
        const svc = registry.findDeployService(id);
        if (!svc) { print(`  ✗ Not found: ${id}`, 'red'); break; }

        print('  Leave blank to keep current value.', 'dim');
        const upd  = {};
        const flds = [
          ['startCmd',    'Start command'],
          ['stopCmd',     'Stop command'],
          ['restartCmd',  'Restart command'],
          ['statusCmd',   'Status command'],
          ['rollbackCmd', 'Rollback command ({version} placeholder)'],
          ['description', 'Description'],
          ['production',  'Production branch'],
          ['staging',     'Staging branch']
        ];
        for (const [field, label] of flds) {
          const cur = svc[field] ? `  (current: ${svc[field]})` : '';
          const v   = await ask(`  ${label}${cur}: `);
          if (v) upd[field] = v;
        }
        const result = registry.updateDeployService(id, upd);
        print(result ? `  ✓ Updated: ${id}` : `  ✗ Update failed`, result ? 'green' : 'red');
        break;
      }

      // ── Add ───────────────────────────────────────────────────────────────
      default: {
        print('\n  New service — leave any command blank if not applicable.', 'dim');

        const id   = await ask('  Service ID (short name, e.g. "api"): ');
        if (!id) { print('  ID is required.', 'red'); break; }

        const name        = (await ask(`  Display name [${id}]: `)) || id;
        const description = await ask('  Description: ');
        const startCmd    = await ask('  Start command: ');
        const stopCmd     = await ask('  Stop command: ');
        const restartCmd  = await ask('  Restart command: ');
        const statusCmd   = await ask('  Status command: ');
        const rollbackCmd = await ask('  Rollback command (use {version}, or blank): ');
        const production  = (await ask('  Production branch [main]: ')) || 'main';
        const staging     = (await ask('  Staging branch [develop]: ')) || 'develop';

        try {
          registry.addDeployService({
            id, name, description,
            startCmd:    startCmd    || '',
            stopCmd:     stopCmd     || '',
            restartCmd:  restartCmd  || '',
            statusCmd:   statusCmd   || '',
            rollbackCmd: rollbackCmd || null,
            production,
            staging,
            enabled: true
          });
          print(`  ✓ Added: ${id}`, 'green');
        } catch (err) {
          print(`  ✗ ${err.message}`, 'red');
        }
        break;
      }
    }
  }

  print('\n  ✓ Services saved.', 'green');
}

// ─── Step 8 — GitHub webhook instructions ────────────────────────────────────

function step8GitHubWebhook(envVars) {
  section('Step 8 — GitHub Webhook');

  const secret = envVars.GITHUB_WEBHOOK_SECRET;
  const port   = envVars.GITHUB_WEBHOOK_PORT || '3000';
  const wpath  = envVars.GITHUB_WEBHOOK_PATH || '/webhook';

  if (!secret) {
    print('  ⚠ GITHUB_WEBHOOK_SECRET not set — payloads will NOT be signature-verified.', 'yellow');
  } else {
    print('  ✓ Webhook HMAC secret configured.', 'green');
  }

  print('\n  GitHub repo setup:');
  print(`  1. Payload URL : http://<your-server>:${port}${wpath}`);
  print('  2. Content type: application/json');
  print('  3. Secret      : <value of GITHUB_WEBHOOK_SECRET>');
  print('  4. Events      : push, pull_request, workflow_run, release');
  print('\n  Run locally:  npx ngrok http ' + port, 'cyan');
  print('  Start server: npm run webhook', 'cyan');
}

// ─── Step 9 — Daemon / service install ───────────────────────────────────────

async function step9DaemonInstall(osInfo) {
  section('Step 9 — Daemon / Service Installation');

  print(`  Service manager: ${osInfo.serviceManager}`, 'cyan');
  const install = await confirm('  Install Sanwan as a system service?', false);

  if (!install) {
    print('  Skipped — start manually with: npm start', 'yellow');
    return;
  }

  const user = os.userInfo().username;

  for (const [name, script, desc] of [
    ['sanwan-bot',    'sanwan.js',  'Sanwan Discord ChatOps Bot'],
    ['sanwan-daemon', 'daemon.js',  'Sanwan Scheduler & Reminder Daemon'],
    ['sanwan-webhook','webhook-server.js', 'Sanwan GitHub Webhook Server']
  ]) {
    const result = serviceInstall({ name, description: desc, workingDir: __dirname, nodeExec: process.execPath, script, user });
    print(`\n  ${name}:`, 'cyan');
    result.instructions.forEach(line => print(`    ${line}`));
  }
}

// ─── Step 10 — Encrypted file initialisation ─────────────────────────────────

function step10EncryptedFiles() {
  section('Step 10 — Encrypted File Initialisation');

  if (!process.env.SETTINGS_KEY) {
    print('  ⚠ SETTINGS_KEY not set — skipping.', 'yellow');
    return;
  }

  const storage = require('./utils/storage');
  const file    = settingsStorageKey();

  storage.initializeEncryptedIfMissing(file, {
    bot: { name: 'Sanwan', version: '1.0.0', errorChannel: null, allowedCommands: [] },
    permissions: { roleMap: {} },
    deploy:        { production: 'main', staging: 'develop' },
    notifications: { taskReminders: true, scheduleNotifications: true, githubPushNotifications: true },
    github:        { webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '', webhookPort: Number(process.env.GITHUB_WEBHOOK_PORT || 3000), webhookPath: process.env.GITHUB_WEBHOOK_PATH || '/webhook' }
  });
  print(`  ✓ ${file}`, 'green');

  storage.initializeEncryptedIfMissing('notes/notes.enc', { notes: [], nextId: 1 });
  print('  ✓ notes/notes.enc', 'green');
}

// ─── Step 11 — Plain data file initialisation ────────────────────────────────

function step11PlainFiles() {
  section('Step 11 — Plain Data File Initialisation');
  const storage = require('./utils/storage');

  storage.initializeIfMissing('tasks/tasks.json',       { tasks: [], nextId: 1 });
  print('  ✓ tasks/tasks.json', 'green');

  storage.initializeIfMissing('schedules/schedules.json', { schedules: [], nextId: 1, history: [] });
  print('  ✓ schedules/schedules.json', 'green');

  storage.initializeIfMissing('daemon-config.json', { enabled: false, timezone: 'UTC' });
  print('  ✓ daemon-config.json', 'green');
}

// ─── Step 12 — Log file initialisation ───────────────────────────────────────

function step12LogFiles() {
  section('Step 12 — Log File Initialisation');

  const logDir   = path.join(__dirname, 'data', 'logs');
  const logFiles = ['bot.log', 'errors.log', 'commands.log', 'daemon.log'];

  logFiles.forEach(name => {
    const full = path.join(logDir, name);
    if (!fs.existsSync(full)) {
      fs.writeFileSync(full, `# ${name} — created ${new Date().toISOString()}\n`, 'utf8');
      print(`  ✓ Created : data/logs/${name}`, 'green');
    } else {
      print(`  · Exists  : data/logs/${name}`, 'dim');
    }
  });
}

// ─── Step 13 — Persist collected settings ────────────────────────────────────

function step13PersistSettings({ errorChannelId }) {
  section('Step 13 — Persisting Configuration');

  if (!process.env.SETTINGS_KEY) {
    print('  ⚠ SETTINGS_KEY not set — cannot persist encrypted settings.', 'yellow');
    return;
  }

  const storage = require('./utils/storage');
  const file    = settingsStorageKey();

  try {
    const settings = storage.encryptedRead(file, { bot: {}, permissions: {}, github: {}, deploy: {}, notifications: {} });

    if (errorChannelId) settings.bot.errorChannel = errorChannelId;

    // Mirror allowed-commands list into settings for sanwan.js backward compat
    const registry = require('./utils/registry');
    settings.bot.allowedCommands = registry
      .listAllowedCommands()
      .filter(r => r.enabled)
      .map(r => r.name);

    storage.encryptedWrite(file, settings);
    print('  ✓ Settings persisted.', 'green');
  } catch (err) {
    print(`  ✗ Failed: ${err.message}`, 'red');
  }
}

// ─── Step 14 — Next steps ─────────────────────────────────────────────────────

function step14NextSteps() {
  section('Setup Complete ✓');

  print('\n  Next steps:', 'bold');
  print('');
  print('  1.  npm install            — install dependencies',   'cyan');
  print('  2.  npm run deploy         — register slash commands', 'cyan');
  print('  3.  npm run test           — validate everything',     'cyan');
  print('  4.  npm start              — start the bot',           'cyan');
  print('  5.  npm run daemon         — start the scheduler',     'cyan');
  print('  6.  npm run webhook        — start GitHub webhook',    'cyan');
  print('');
  hint('Use ngrok to expose the webhook locally:  npx ngrok http 3000');
  print('');
}

// ─── Step 15 — Run test suite ─────────────────────────────────────────────────

async function step15RunTests() {
  section('Step 15 — Post-Setup Validation');

  print('  Running test suite to confirm everything is wired correctly…\n', 'cyan');

  let results;
  try {
    // Lazy-require so dotenv changes made during setup are already in process.env
    const { runTests } = require('./test');
    results = runTests();
  } catch (err) {
    print(`  ✗ Test suite could not be loaded: ${err.message}`, 'red');
    print('  Continuing setup — run  npm run test  manually to diagnose.', 'yellow');
    return { passed: 0, failed: 1, warnings: 0 };
  }

  print('');
  if (results.failed > 0) {
    print(`  ⚠  ${results.failed} test(s) failed. Review the output above before starting the bot.`, 'yellow');
    print('     Fix the issues, then re-run:  npm run setup  or  npm run test', 'yellow');
  } else {
    print(`  ✓ All tests passed (${results.passed} passed, ${results.warnings} warning(s)).`, 'green');
  }

  return results;
}

// ─── Step 16 — Deploy slash commands to Discord ───────────────────────────────

async function step16DeployCommands() {
  section('Step 16 — Deploy Slash Commands to Discord');

  // Check minimum requirements before even asking
  if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID) {
    print('  ⚠ Discord credentials not set — skipping command deployment.', 'yellow');
    hint('Run  npm run deploy  manually once credentials are configured.');
    return;
  }

  const deploy = await confirm('  Deploy slash commands to Discord now?', true);
  if (!deploy) {
    print('  Skipped — run  npm run deploy  when ready.', 'yellow');
    return;
  }

  try {
    const { deployCommands } = require('./deploy-commands');
    const { deployed, names } = await deployCommands();

    if (deployed === 0) {
      print('  ⚠ No commands were deployed (none found or all skipped).', 'yellow');
    } else {
      print(`\n  ✅ Deployed ${deployed} command(s) to Discord:`, 'green');
      names.forEach(n => print(`     /${n}`, 'green'));
      print('\n  Commands are live immediately. Refresh Discord (Ctrl+R) if not visible.', 'cyan');
    }
  } catch (err) {
    print(`\n  ✗ Deployment failed: ${err.message}`, 'red');
    hint('Run  npm run deploy  manually to retry.');
  }
}



async function main() {
  print('');
  print('╔════════════════════════════════════════════════════╗', 'cyan');
  print('║           SANWAN  —  SETUP WIZARD                  ║', 'cyan');
  print('╚════════════════════════════════════════════════════╝', 'cyan');

  try {
    // 0. .env guard
    const envMode = await step0EnvGuard();

    // 1. OS
    const osInfo = step1DetectOS();

    // 2. Directories
    step2Directories();

    // 3. .env
    const envVars = await step3BuildEnv(envMode);

    // 3b. Detect and recover from stale encrypted files (key mismatch)
    await step3bCheckStaleEncFiles();

    // 4. Commands
    const commands = step4DiscoverCommands();

    // 5. Allowed-commands registry
    await step5AllowedCommands();

    // 5b. Role permissions
    await step5bRolePermissions(commands);

    // 6. Error-log channel
    const { errorChannelId } = await step6ErrorLog();

    // 7. Log sources
    await step7LogSources();

    // 7b. Deploy services
    await step7bDeployServices();

    // 8. GitHub webhook
    step8GitHubWebhook(envVars);

    // 9. Daemon install
    await step9DaemonInstall(osInfo);

    // 10–12. File initialisation
    step10EncryptedFiles();
    step11PlainFiles();
    step12LogFiles();

    // 13. Persist
    step13PersistSettings({ errorChannelId });

    // 14. Done
    step14NextSteps();

    // 15. Run test suite inline
    await step15RunTests();

    // 16. Deploy slash commands to Discord
    await step16DeployCommands();

  } catch (err) {
    print(`\n  ✗ Setup failed: ${err.message}`, 'red');
    console.error(err);
    process.exit(1);
  } finally {
    rl.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { step1DetectOS, step4DiscoverCommands };
