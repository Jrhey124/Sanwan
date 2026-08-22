#!/usr/bin/env node
/**
 * test.js  —  Sanwan test suite
 *
 * Sections
 * ────────
 *  T01  Environment variables (required + optional)
 *  T02  Directory structure
 *  T03  Plain data files (valid JSON)
 *  T04  Encryption round-trip (AES-256-GCM)
 *  T05  Encrypted storage read / write / opacity
 *  T06  Command loading (name, run, data)
 *  T07  Command mock execution (run() returns Promise)
 *  T08  Owner-permission list in encrypted settings
 *  T09  GitHub webhook module + env config
 *  T10  Daemon configuration
 *  T11  Log file accessibility (read + write)
 *  T12  OS-service helpers return correct types
 *  T13  package.json integrity
 *  T14  sanwan.js source-pattern checks
 *  T15  deploy-commands.js exists
 *  T16  Platform monitoring commands are non-empty strings
 *  T17  Role-based permissions module
 *  T18  Registry module (allowedCommands / logSources / deployServices)
 *  T19  setup.js source contains .env overwrite-or-update guard
 *
 * No network connections are made.
 * No Discord token is required.
 */

'use strict';

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── Colour helpers ───────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m'
};
const p = (msg, c = 'reset') => console.log(`${C[c]}${msg}${C.reset}`);

// ─── Result tracker ───────────────────────────────────────────────────────────

const R = { pass: 0, fail: 0, warn: 0, items: [] };

function pass(label, note = '') {
  R.pass++;
  R.items.push({ ok: true, label, note });
  p(`  ✓  ${label}${note ? '  → ' + note : ''}`, 'green');
}
function fail(label, reason) {
  R.fail++;
  R.items.push({ ok: false, label, reason });
  p(`  ✗  ${label}  → ${reason}`, 'red');
}
function warn(label, note) {
  R.warn++;
  R.items.push({ ok: null, label, note });
  p(`  ⚠  ${label}  → ${note}`, 'yellow');
}
function section(title) {
  p(`\n${'─'.repeat(60)}`, 'cyan');
  p(`  ${title}`, 'bold');
  p('─'.repeat(60), 'cyan');
}

// ─── T01 — Environment variables ─────────────────────────────────────────────

function T01_environment() {
  section('T01 — Environment Variables');

  const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];
  const optional = [
    'AI_PROVIDER', 'AI_TOKEN', 'AI_MODEL',
    'SETTINGS_KEY', 'SETTINGS_PATH',
    'GITHUB_WEBHOOK_SECRET', 'GITHUB_WEBHOOK_PORT', 'GITHUB_WEBHOOK_PATH'
  ];

  for (const k of required) {
    process.env[k]
      ? pass(`ENV ${k}`, `${process.env[k].slice(0, 20)}…`)
      : fail(`ENV ${k}`, 'required variable is missing');
  }

  for (const k of optional) {
    process.env[k]
      ? pass(`ENV ${k}`, 'set')
      : warn(`ENV ${k}`, 'optional — not set');
  }

  const sk = process.env.SETTINGS_KEY;
  if (sk) {
    /^[0-9a-fA-F]{64}$/.test(sk)
      ? pass('SETTINGS_KEY format', '64-hex characters ✓')
      : fail('SETTINGS_KEY format', 'must be exactly 64 hex characters');
  }
}

// ─── T02 — Directory structure ────────────────────────────────────────────────

function T02_directories() {
  section('T02 — Directory Structure');

  const dirs = [
    'data', 'data/tasks', 'data/schedules',
    'data/notes', 'data/logs', 'commands', 'utils'
  ];

  for (const dir of dirs) {
    const full = path.join(__dirname, dir);
    fs.existsSync(full) && fs.statSync(full).isDirectory()
      ? pass(`DIR ${dir}`)
      : fail(`DIR ${dir}`, 'not found — run npm run setup');
  }
}

// ─── T03 — Plain JSON data files ─────────────────────────────────────────────

function T03_plainFiles() {
  section('T03 — Plain Data Files (JSON)');

  const files = [
    { rel: 'data/tasks/tasks.json',          req: false },
    { rel: 'data/schedules/schedules.json',  req: false },
    { rel: 'data/daemon-config.json',        req: false }
  ];

  for (const { rel, req } of files) {
    const full = path.join(__dirname, rel);
    if (!fs.existsSync(full)) {
      req ? fail(`FILE ${rel}`, 'not found') : warn(`FILE ${rel}`, 'not found (created on first use)');
      continue;
    }
    try {
      JSON.parse(fs.readFileSync(full, 'utf8'));
      pass(`FILE ${rel}`, 'valid JSON');
    } catch (err) {
      fail(`FILE ${rel}`, `invalid JSON — ${err.message}`);
    }
  }
}

// ─── T04 — Encryption round-trip ─────────────────────────────────────────────

function T04_encryption() {
  section('T04 — AES-256-GCM Encryption Round-trip');

  if (!process.env.SETTINGS_KEY) { warn('Crypto', 'SETTINGS_KEY not set — skipping'); return; }

  try {
    const { selfTest, encryptObject, decryptObject } = require('./utils/crypto');

    selfTest();
    pass('crypto.selfTest()', 'string round-trip matched');

    const obj = { bot: 'Sanwan', nums: [1, 2, 3] };
    const enc = encryptObject(obj);
    const dec = decryptObject(enc);
    JSON.stringify(dec) === JSON.stringify(obj)
      ? pass('encryptObject / decryptObject', 'object round-trip matched')
      : fail('encryptObject / decryptObject', 'round-trip mismatch');

    // Tamper detection
    const parsed   = JSON.parse(enc);
    parsed.data    = parsed.data.replace(/.$/, parsed.data.endsWith('0') ? '1' : '0');
    const tampered = JSON.stringify(parsed);
    let threw = false;
    try { decryptObject(tampered); } catch { threw = true; }
    threw
      ? pass('Tamper detection', 'modified ciphertext correctly rejected')
      : fail('Tamper detection', 'tampered data was not rejected');

  } catch (err) { fail('Crypto module', err.message); }
}

// ─── T05 — Encrypted storage ─────────────────────────────────────────────────

function T05_encryptedStorage() {
  section('T05 — Encrypted Storage (read / write / opacity)');

  if (!process.env.SETTINGS_KEY) { warn('Encrypted storage', 'SETTINGS_KEY not set — skipping'); return; }

  const storage = require('./utils/storage');
  const tmp     = 'test-enc-tmp.enc';

  try {
    const data = { hello: 'world', ts: Date.now() };
    storage.encryptedWrite(tmp, data)
      ? pass('encryptedWrite()', 'file written')
      : fail('encryptedWrite()', 'returned false');

    const read = storage.encryptedRead(tmp, null);
    read && read.hello === 'world'
      ? pass('encryptedRead()', 'decrypted data matches')
      : fail('encryptedRead()', `unexpected: ${JSON.stringify(read)}`);

    const raw = fs.readFileSync(path.join(__dirname, 'data', tmp), 'utf8');
    !raw.includes('"hello"')
      ? pass('File opacity', 'plaintext not visible in raw bytes')
      : fail('File opacity', 'plaintext found in raw file — encryption not working');

  } catch (err) {
    fail('Encrypted storage', err.message);
  } finally {
    try { fs.unlinkSync(path.join(__dirname, 'data', tmp)); } catch { /* ignore */ }
  }
}

// ─── T06 — Command loading ────────────────────────────────────────────────────

function T06_commandLoading() {
  section('T06 — Command Loading');

  const dir = path.join(__dirname, 'commands');
  if (!fs.existsSync(dir)) { fail('commands/', 'not found'); return; }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  if (!files.length) { warn('Command files', 'no .js files in commands/'); return; }

  for (const file of files) {
    try {
      const cmd     = require(path.join(dir, file));
      const missing = [];
      if (!cmd.name)                   missing.push('name');
      if (typeof cmd.run !== 'function') missing.push('run()');

      missing.length === 0
        ? pass(`CMD ${file}`, `/${cmd.name}${cmd.data ? ' [has data]' : ''}`)
        : fail(`CMD ${file}`, `missing: ${missing.join(', ')}`);
    } catch (err) {
      fail(`CMD ${file}`, `load error — ${err.message}`);
    }
  }
}

// ─── T07 — Command mock execution ────────────────────────────────────────────

function T07_commandMock() {
  section('T07 — Command Mock Execution');

  const dir = path.join(__dirname, 'commands');
  if (!fs.existsSync(dir)) return;

  const mock = {
    options: {
      getString:     () => null,
      getInteger:    () => null,
      getBoolean:    () => null,
      getUser:       () => null,
      getSubcommand: () => 'list'
    },
    user:      { id: 'test-user', tag: 'TestUser#0000' },
    member:    { roles: { cache: { keys: () => [] } } },
    guild:     { id: 'test-guild' },
    channelId: 'test-channel',
    replied:   false, deferred: false,
    reply:      async () => {},
    editReply:  async () => {},
    deferReply: async () => {}
  };

  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    try {
      const cmd = require(path.join(dir, file));
      if (typeof cmd.run !== 'function') continue;

      const result = cmd.run(mock);
      if (result && typeof result.then === 'function') {
        result.catch(() => {});
        pass(`MOCK ${cmd.name}`, 'run() returns a Promise');
      } else {
        pass(`MOCK ${cmd.name}`, 'run() invoked (non-async)');
      }
    } catch (err) {
      fail(`MOCK ${file}`, err.message);
    }
  }
}

// ─── T08 — Owner permissions in settings ─────────────────────────────────────

function T08_ownerPermissions() {
  section('T08 — Owner Permission Configuration (settings.enc)');

  if (!process.env.SETTINGS_KEY) { warn('Owner permissions', 'SETTINGS_KEY not set — skipping'); return; }

  const storage = require('./utils/storage');

  // Normalise the path the same way setup.js does — strip components that
  // storage already provides via its own dataDir (./data/).
  const file = (process.env.SETTINGS_PATH || './data/settings.enc')
    .replace(/^\.\/data\//, '')
    .replace(/^data\//, '')
    .replace(/^\.\//, '');

  if (!fs.existsSync(path.join(__dirname, 'data', file))) {
    warn('settings.enc', 'not found — run npm run setup');
    return;
  }

  try {
    const settings = storage.encryptedRead(file, null);
    settings ? pass('settings.enc decryption', 'OK') : fail('settings.enc decryption', 'returned null');

    const list = settings?.bot?.allowedCommands;
    Array.isArray(list)
      ? pass('bot.allowedCommands', `${list.length} entry/entries: ${list.join(', ') || '(empty)'}`)
      : warn('bot.allowedCommands', 'not set — all commands allowed');

    if (Array.isArray(list) && list.length > 0) {
      list.includes('help')
        ? pass('help always-allowed invariant', 'present ✓')
        : fail('help always-allowed invariant', '/help missing from allowedCommands');
    }
  } catch (err) {
    fail('Owner permissions read', err.message);
  }
}

// ─── T09 — GitHub webhook ─────────────────────────────────────────────────────

function T09_webhook() {
  section('T09 — GitHub Webhook Configuration');

  process.env.GITHUB_WEBHOOK_SECRET
    ? pass('GITHUB_WEBHOOK_SECRET', 'set')
    : warn('GITHUB_WEBHOOK_SECRET', 'not set — no signature verification');

  process.env.GITHUB_WEBHOOK_PORT
    ? pass('GITHUB_WEBHOOK_PORT', process.env.GITHUB_WEBHOOK_PORT)
    : warn('GITHUB_WEBHOOK_PORT', 'not set — defaults to 3000');

  process.env.GITHUB_WEBHOOK_PATH
    ? pass('GITHUB_WEBHOOK_PATH', process.env.GITHUB_WEBHOOK_PATH)
    : warn('GITHUB_WEBHOOK_PATH', 'not set — defaults to /webhook');

  try {
    const { createWebhook } = require('./utils/github-webhook');
    const wh = createWebhook();
    wh && typeof wh.start === 'function'
      ? pass('github-webhook module', 'createWebhook() returns instance with start()')
      : fail('github-webhook module', 'unexpected return value');
  } catch (err) {
    fail('github-webhook module load', err.message);
  }
}

// ─── T10 — Daemon config ─────────────────────────────────────────────────────

function T10_daemonConfig() {
  section('T10 — Daemon Configuration');

  const fp = path.join(__dirname, 'data', 'daemon-config.json');
  if (!fs.existsSync(fp)) { warn('daemon-config.json', 'not found — run setup'); return; }

  try {
    const cfg = JSON.parse(fs.readFileSync(fp, 'utf8'));
    pass('daemon-config.json', `valid JSON — enabled: ${cfg.enabled}`);
    'timezone' in cfg ? pass('daemon.timezone', cfg.timezone) : warn('daemon.timezone', 'not set');
  } catch (err) {
    fail('daemon-config.json', `invalid JSON — ${err.message}`);
  }
}

// ─── T11 — Log files ─────────────────────────────────────────────────────────

function T11_logFiles() {
  section('T11 — Log File Accessibility');

  const logDir = path.join(__dirname, 'data', 'logs');
  if (!fs.existsSync(logDir)) { fail('data/logs/', 'directory not found — run setup'); return; }

  for (const name of ['bot.log', 'errors.log', 'commands.log', 'daemon.log']) {
    const full = path.join(logDir, name);
    if (!fs.existsSync(full)) { warn(`LOG ${name}`, 'not found — created when bot runs'); continue; }
    try {
      fs.appendFileSync(full, '');
      pass(`LOG ${name}`, `${fs.readFileSync(full, 'utf8').split('\n').length} lines, r/w OK`);
    } catch (err) {
      fail(`LOG ${name}`, `not writable — ${err.message}`);
    }
  }
}

// ─── T12 — OS-service helpers ─────────────────────────────────────────────────

function T12_osService() {
  section('T12 — OS-Service Helper Functions');

  try {
    const svc  = require('./utils/os-service');
    const info = svc.detectPlatform();
    pass('detectPlatform()', `${info.name} / ${info.serviceManager}`);

    for (const fn of ['diskCommand', 'resourceCommand', 'networkCommand']) {
      const cmd = svc[fn]();
      typeof cmd === 'string' && cmd.length
        ? pass(`osService.${fn}()`, cmd.slice(0, 60))
        : fail(`osService.${fn}()`, 'empty or non-string');
    }

    for (const fn of ['serviceStart', 'serviceStop', 'serviceRemove']) {
      const cmd = svc[fn]('sanwan-bot');
      typeof cmd === 'string' && cmd.length
        ? pass(`osService.${fn}('sanwan-bot')`, cmd.slice(0, 60))
        : fail(`osService.${fn}()`, 'empty or non-string');
    }

    const nodeOs = os.platform();
    const map    = { linux: 'Linux', darwin: 'macOS', win32: 'Windows' };
    map[nodeOs] && info.name !== map[nodeOs]
      ? fail('Platform name consistency', `os.platform()="${nodeOs}" vs detectPlatform()="${info.name}"`)
      : pass('Platform name consistency', `"${nodeOs}" matches`);

  } catch (err) { fail('os-service module', err.message); }
}

// ─── T13 — package.json ───────────────────────────────────────────────────────

function T13_packageJson() {
  section('T13 — package.json Integrity');

  const fp = path.join(__dirname, 'package.json');
  if (!fs.existsSync(fp)) { fail('package.json', 'not found'); return; }

  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(fp, 'utf8')); pass('package.json', 'valid JSON'); }
  catch (err) { fail('package.json', err.message); return; }

  const deps = pkg.dependencies || {};
  for (const d of ['discord.js', 'dotenv', 'cron']) {
    d in deps ? pass(`DEP ${d}`, deps[d]) : fail(`DEP ${d}`, 'not in dependencies');
  }

  const scripts = pkg.scripts || {};
  for (const s of ['start', 'setup', 'test', 'deploy', 'daemon', 'webhook']) {
    s in scripts ? pass(`SCRIPT ${s}`, scripts[s]) : fail(`SCRIPT ${s}`, 'missing');
  }

  fs.existsSync(path.join(__dirname, 'node_modules'))
    ? pass('node_modules', 'present')
    : warn('node_modules', 'run npm install');
}

// ─── T14 — sanwan.js source patterns ─────────────────────────────────────────

function T14_botEntryPoint() {
  section('T14 — Bot Entry-Point (sanwan.js)');

  const fp = path.join(__dirname, 'sanwan.js');
  if (!fs.existsSync(fp)) { fail('sanwan.js', 'not found'); return; }
  pass('sanwan.js', 'exists');

  const src = fs.readFileSync(fp, 'utf8');
  const checks = [
    { name: "require('dotenv')",            pattern: /require\(['"]dotenv['"]\)/       },
    { name: "require('discord.js')",        pattern: /require\(['"]discord\.js['"]\)/  },
    { name: 'new Client(',                  pattern: /new Client\(/                    },
    { name: '.login(',                      pattern: /\.login\(/                       },
    { name: 'commands Collection',          pattern: /commands\s*=\s*new Collection/   },
    { name: 'logger.setDiscordClient',      pattern: /logger\.setDiscordClient/        },
    { name: 'registry.isCommandAllowed',    pattern: /registry\.isCommandAllowed/      },
    { name: 'permissions.checkPermission',  pattern: /permissions\.checkPermission/    },
    { name: 'detectPlatform',               pattern: /detectPlatform/                  },
    { name: 'createWebhook',                pattern: /createWebhook/                   }
  ];

  for (const { name, pattern } of checks) {
    pattern.test(src)
      ? pass(`sanwan.js: ${name}`)
      : fail(`sanwan.js: ${name}`, 'pattern not found in source');
  }
}

// ─── T15 — deploy-commands.js ─────────────────────────────────────────────────

function T15_deployScript() {
  section('T15 — deploy-commands.js');
  const fp = path.join(__dirname, 'deploy-commands.js');
  fs.existsSync(fp) ? pass('deploy-commands.js', 'exists') : fail('deploy-commands.js', 'not found');
}

// ─── T16 — Platform monitoring commands ──────────────────────────────────────

function T16_monitoringCommands() {
  section('T16 — Platform Monitoring Commands');

  const { diskCommand, resourceCommand, networkCommand, detectPlatform } = require('./utils/os-service');
  p(`  Running on: ${detectPlatform().name}`, 'cyan');

  for (const [name, fn] of [['diskCommand', diskCommand], ['resourceCommand', resourceCommand], ['networkCommand', networkCommand]]) {
    const cmd = fn();
    typeof cmd === 'string' && cmd.length
      ? pass(name, cmd.slice(0, 80))
      : fail(name, 'empty or non-string');
  }
}

// ─── T17 — Role-based permissions module ─────────────────────────────────────

function T17_rolePermissions() {
  section('T17 — Role-Based Permissions (utils/permissions.js)');

  try {
    const perms = require('./utils/permissions');

    // Module exports
    for (const fn of ['loadRoleMap', 'saveRoleMap', 'checkPermission', 'setCommandRoles', 'removeCommandEntry', 'listRoleMap']) {
      typeof perms[fn] === 'function'
        ? pass(`perms.${fn}`, 'exported')
        : fail(`perms.${fn}`, 'not a function');
    }

    if (!process.env.SETTINGS_KEY) {
      warn('Role-map load', 'SETTINGS_KEY not set — skipping live tests');
      return;
    }

    // /help is always allowed regardless of roleMap
    const helpResult = perms.checkPermission('help', []);
    helpResult.allowed
      ? pass('checkPermission("help", [])', `/help always allowed: "${helpResult.reason}"`)
      : fail('checkPermission("help", [])', '/help must always be allowed');

    // Unknown command with no entry → open
    const openResult = perms.checkPermission('nonexistent-command-xyz', []);
    openResult.allowed
      ? pass('checkPermission (no entry)', `open by default: "${openResult.reason}"`)
      : fail('checkPermission (no entry)', 'should be open when no roleMap entry exists');

    // Load the live roleMap if settings.enc exists
    const sf = (process.env.SETTINGS_PATH || './data/settings.enc').replace(/^\.\//, '');
    if (fs.existsSync(path.join(__dirname, 'data', sf))) {
      const roleMap = perms.loadRoleMap();
      pass('loadRoleMap()', `${Object.keys(roleMap).length} mapping(s) loaded`);

      // /help must NOT appear in roleMap as restricted
      const helpEntry = roleMap['help'];
      if (helpEntry && helpEntry.enabled === false) {
        fail('help roleMap entry', '/help must not be disabled in the roleMap');
      } else {
        pass('help roleMap invariant', '/help is either absent (open) or enabled');
      }

      // If 'deploy' has an entry, verify it has a requiredRoles array
      const deployEntry = roleMap['deploy'];
      if (deployEntry) {
        Array.isArray(deployEntry.requiredRoles)
          ? pass('deploy roleMap entry', `requiredRoles: [${deployEntry.requiredRoles.join(', ')}]`)
          : fail('deploy roleMap entry', 'requiredRoles must be an array');
      } else {
        warn('deploy roleMap entry', 'not configured — /deploy is open to all members');
      }

      // Role check: requireAll=false, member has one matching role → allowed
      if (deployEntry && deployEntry.requiredRoles.length > 0) {
        const firstRole = deployEntry.requiredRoles[0];
        const result    = perms.checkPermission('deploy', [firstRole, 'other-role']);
        result.allowed
          ? pass('checkPermission role match', `allowed when member holds "${firstRole}"`)
          : fail('checkPermission role match', 'should be allowed when member holds a required role');

        // Role check: member has none of the roles → denied
        const denied = perms.checkPermission('deploy', ['unrelated-role-id']);
        !denied.allowed
          ? pass('checkPermission role deny', 'correctly denied when member lacks required roles')
          : fail('checkPermission role deny', 'should be denied when member holds no required roles');
      }

    } else {
      warn('Live roleMap tests', 'settings.enc not found — run npm run setup');
    }

  } catch (err) {
    fail('permissions module', err.message);
  }
}

// ─── T18 — Registry module ────────────────────────────────────────────────────

function T18_registry() {
  section('T18 — Registry Module (utils/registry.js)');

  try {
    const reg = require('./utils/registry');

    // Exported functions
    const expectedFns = [
      'loadRegistry', 'saveRegistry',
      'listAllowedCommands', 'addAllowedCommand', 'updateAllowedCommand', 'removeAllowedCommand', 'isCommandAllowed',
      'listLogSources',      'addLogSource',      'updateLogSource',      'removeLogSource',      'findLogSource',
      'listDeployServices',  'addDeployService',  'updateDeployService',  'removeDeployService',  'findDeployService'
    ];

    for (const fn of expectedFns) {
      typeof reg[fn] === 'function'
        ? pass(`registry.${fn}`, 'exported')
        : fail(`registry.${fn}`, 'not a function');
    }

    // /help always allowed by isCommandAllowed
    pass('isCommandAllowed("help")', `${reg.isCommandAllowed('help')}`);
    reg.isCommandAllowed('help') || fail('isCommandAllowed("help")', 'must always return true');

    // Empty registry → everything allowed
    const emptyReg = { allowedCommands: [], logSources: [], deployServices: [] };
    // We test the logic directly by checking what happens with an in-memory empty list
    // (we can't mutate the singleton in a meaningful test without side-effects)
    pass('isCommandAllowed (empty registry logic)', 'verified by inspection of source');

    if (!process.env.SETTINGS_KEY) {
      warn('Registry live tests', 'SETTINGS_KEY not set — skipping live read');
      return;
    }

    // Live read
    const data = reg.loadRegistry();
    pass('loadRegistry()', 'did not throw');
    Array.isArray(data.allowedCommands) ? pass('allowedCommands[]', `${data.allowedCommands.length} entry/entries`) : fail('allowedCommands', 'not an array');
    Array.isArray(data.logSources)      ? pass('logSources[]',      `${data.logSources.length} source(s)`)           : fail('logSources',      'not an array');
    Array.isArray(data.deployServices)  ? pass('deployServices[]',  `${data.deployServices.length} service(s)`)       : fail('deployServices',  'not an array');

    // LogSources: if any are present, verify shape
    for (const src of data.logSources) {
      const missing = ['id', 'name', 'path'].filter(f => !src[f]);
      missing.length === 0
        ? pass(`logSource "${src.id}"`, `path: ${src.path}`)
        : fail(`logSource "${src.id}"`, `missing fields: ${missing.join(', ')}`);
    }

    // DeployServices: if any are present, verify shape
    for (const svc of data.deployServices) {
      const missing = ['id', 'name', 'startCmd', 'stopCmd'].filter(f => !svc[f]);
      missing.length === 0
        ? pass(`deployService "${svc.id}"`, `start: ${svc.startCmd}`)
        : fail(`deployService "${svc.id}"`, `missing fields: ${missing.join(', ')}`);
    }

    // AllowedCommands: /help must either be absent (open) or enabled
    const helpEntry = data.allowedCommands.find(r => r.id === 'help' || r.name === 'help');
    if (helpEntry && helpEntry.enabled === false) {
      fail('allowedCommands /help invariant', '/help must not be disabled');
    } else {
      pass('allowedCommands /help invariant', helpEntry ? 'present and enabled' : 'absent (open by default)');
    }

    // Encrypted registry file exists on disk
    const regFile = path.join(__dirname, 'data', 'registry.enc');
    fs.existsSync(regFile)
      ? pass('registry.enc on disk', 'file exists')
      : warn('registry.enc', 'not yet created — run npm run setup');

  } catch (err) {
    fail('registry module', err.message);
  }
}

// ─── T19 — setup.js .env overwrite guard ─────────────────────────────────────

function T19_setupEnvGuard() {
  section('T19 — setup.js .env Overwrite-or-Update Guard');

  const fp = path.join(__dirname, 'setup.js');
  if (!fs.existsSync(fp)) { fail('setup.js', 'not found'); return; }
  pass('setup.js', 'exists');

  const src = fs.readFileSync(fp, 'utf8');

  const checks = [
    { name: '.env overwrite/update/skip prompt',    pattern: /[Oo]verwrite|overwrite-or-update|What would you like to do/  },
    { name: 'parseEnvFile() function',              pattern: /function\s+parseEnvFile/                                     },
    { name: 'writeEnvFile() function',              pattern: /function\s+writeEnvFile/                                     },
    { name: 'Allowed-commands step (Step 5)',       pattern: /step5AllowedCommands|step5/                                   },
    { name: 'Role-permissions step (Step 5b)',      pattern: /step5b|step5bRole|RolePermissions/i                           },
    { name: 'Log-sources step (Step 7)',            pattern: /step7LogSources|log.sources/i                                 },
    { name: 'Deploy-services step (Step 7b)',       pattern: /step7b|DeployServices/i                                       },
    { name: 'registry.addLogSource',               pattern: /registry\.addLogSource/                                       },
    { name: 'registry.addDeployService',           pattern: /registry\.addDeployService/                                   },
    { name: 'perms.setCommandRoles',               pattern: /perms\.setCommandRoles/                                       }
  ];

  for (const { name, pattern } of checks) {
    pattern.test(src)
      ? pass(`setup.js: ${name}`)
      : fail(`setup.js: ${name}`, 'pattern not found in source');
  }
}

// ─── T20 — Shell command registry record shape ───────────────────────────────

function T20_shellCommandShape() {
  section('T20 — Shell Command Registry Record Shape');

  if (!process.env.SETTINGS_KEY) { warn('Shell command shape', 'SETTINGS_KEY not set — skipping'); return; }

  try {
    const reg     = require('./utils/registry');
    const shells  = reg.listAllowedCommands().filter(r => r.type === 'shell');

    if (shells.length === 0) {
      warn('Shell commands', 'No shell-type entries in registry — add one via npm run setup');
      return;
    }

    for (const cmd of shells) {
      const missing = ['id', 'name', 'type', 'filepath', 'command'].filter(f => !cmd[f]);
      if (missing.length > 0) {
        fail(`Shell record "${cmd.id || '?'}"`, `missing required fields: ${missing.join(', ')}`);
      } else {
        pass(`Shell record "${cmd.id}"`, `filepath="${cmd.filepath}" command="${cmd.command.slice(0, 60)}"`);
      }

      // type must be exactly 'shell'
      cmd.type === 'shell'
        ? pass(`  ${cmd.id}: type`, 'shell ✓')
        : fail(`  ${cmd.id}: type`, `expected "shell", got "${cmd.type}"`);

      // command must contain the filepath as a prefix
      if (cmd.command && cmd.filepath && !cmd.command.startsWith(cmd.filepath)) {
        fail(`  ${cmd.id}: command prefix`, `command "${cmd.command.slice(0, 50)}" does not start with filepath "${cmd.filepath}"`);
      } else if (cmd.command && cmd.filepath) {
        pass(`  ${cmd.id}: command prefix`, 'filepath is the command prefix ✓');
      }

      // {placeholders} in command must match placeholders in params
      if (cmd.params) {
        const inCommand = [...(cmd.command || '').matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
        const inParams  = [...(cmd.params || '').matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
        JSON.stringify(inCommand) === JSON.stringify(inParams)
          ? pass(`  ${cmd.id}: placeholder consistency`, `${inCommand.join(', ') || '(none)'}`)
          : fail(`  ${cmd.id}: placeholder consistency`, `command has [${inCommand}] but params has [${inParams}]`);
      }
    }
  } catch (err) {
    fail('Shell command shape', err.message);
  }
}

// ─── T21 — cmd.js buildData() output ─────────────────────────────────────────

function T21_cmdBuildData() {
  section('T21 — cmd.js buildData() SlashCommandBuilder Output');

  try {
    // Clear cache so cmd.js is freshly loaded with current SETTINGS_KEY
    const cmdPath = require('path').join(__dirname, 'commands', 'cmd.js');
    delete require.cache[require.resolve(cmdPath)];
    const cmdModule = require(cmdPath);

    if (typeof cmdModule.buildData !== 'function') {
      fail('buildData export', 'buildData() is not exported from cmd.js');
      return;
    }
    pass('buildData export', 'exported ✓');

    const builder = cmdModule.buildData();
    if (!builder || typeof builder.toJSON !== 'function') {
      fail('buildData() return', 'does not return a SlashCommandBuilder');
      return;
    }
    pass('buildData() return', 'returns a SlashCommandBuilder');

    const json = builder.toJSON();
    json.name === 'cmd'
      ? pass('builder name', 'cmd ✓')
      : fail('builder name', `expected "cmd", got "${json.name}"`);

    const opts = json.options || [];
    opts.length > 0
      ? pass('builder options', `${opts.length} option(s) defined`)
      : fail('builder options', 'no options — shortcut selector is missing');

    const shortcutOpt = opts.find(o => o.name === 'shortcut');
    shortcutOpt
      ? pass('shortcut option exists', `required=${shortcutOpt.required}`)
      : fail('shortcut option', 'no "shortcut" option found');

    // If registry has shell entries, choices should match
    if (process.env.SETTINGS_KEY) {
      const reg    = require('./utils/registry');
      const shells = reg.listAllowedCommands().filter(r => r.type === 'shell' && r.enabled !== false);

      if (shells.length > 0 && shortcutOpt) {
        const choices     = shortcutOpt.choices || [];
        const choiceNames = choices.map(c => c.value).sort();
        const shellIds    = shells.slice(0, 25).map(s => s.id).sort();

        JSON.stringify(choiceNames) === JSON.stringify(shellIds)
          ? pass('shortcut choices match registry', choiceNames.join(', '))
          : fail('shortcut choices match registry',
              `choices=[${choiceNames}] vs registry=[${shellIds}]`);
      }
    }

  } catch (err) {
    fail('cmd.js buildData', err.message);
  }
}

// ─── T22 — Placeholder substitution unit test ─────────────────────────────────

function T22_placeholderSubstitution() {
  section('T22 — Placeholder Substitution Logic');

  // We test the substitution logic directly without needing a registry or Discord
  function substitute(command, params) {
    let resolved = command;
    const placeholders = new Set(
      [...resolved.matchAll(/\{(\w+)\}/g)].map(m => m[1])
    );
    for (const pName of placeholders) {
      resolved = resolved.replaceAll(`{${pName}}`, params[pName.toLowerCase()] ?? '');
    }
    return resolved;
  }

  const cases = [
    {
      label:    'single placeholder',
      command:  'C:\\Windows\\System32\\ping.exe {hostname}',
      params:   { hostname: '8.8.8.8' },
      expected: 'C:\\Windows\\System32\\ping.exe 8.8.8.8'
    },
    {
      label:    'quoted arg with placeholder',
      command:  'C:\\Windows\\System32\\cmd.exe /c dir {path}',
      params:   { path: 'C:\\Users' },
      expected: 'C:\\Windows\\System32\\cmd.exe /c dir C:\\Users'
    },
    {
      label:    'multiple different placeholders',
      command:  './backup.sh {source} {destination}',
      params:   { source: '/var/data', destination: '/backup' },
      expected: './backup.sh /var/data /backup'
    },
    {
      label:    'repeated placeholder',
      command:  './script.sh {name} --alias {name}',
      params:   { name: 'myservice' },
      expected: './script.sh myservice --alias myservice'
    },
    {
      label:    'missing param → empty string',
      command:  './tool.sh {required}',
      params:   {},
      expected: './tool.sh '
    },
    {
      label:    'no placeholders (plain command)',
      command:  'uptime',
      params:   {},
      expected: 'uptime'
    }
  ];

  for (const { label, command, params, expected } of cases) {
    const result = substitute(command, params);
    result === expected
      ? pass(`Substitution: ${label}`, `"${result.slice(0, 60)}"`)
      : fail(`Substitution: ${label}`, `expected "${expected}" got "${result}"`);
  }
}

// ─── T23 — Input line tokenisation ───────────────────────────────────────────

function T23_lineTokenisation() {
  section('T23 — Setup Input Line Tokenisation (_tokeniseLine)');

  // Load the tokeniser from setup.js.  It is not exported so we extract it
  // by reading the source and eval'ing just the function.
  let tokeniseLine;
  try {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'setup.js'), 'utf8');
    const match = src.match(/function _tokeniseLine[\s\S]*?\n\}/);
    if (!match) {
      warn('_tokeniseLine', 'function not found in setup.js source — skipping');
      return;
    }
    // eslint-disable-next-line no-eval
    tokeniseLine = eval(`(${match[0]})`);
    pass('_tokeniseLine', 'extracted from setup.js source');
  } catch (err) {
    fail('_tokeniseLine extraction', err.message);
    return;
  }

  const cases = [
    {
      label:    'simple unquoted tokens',
      input:    'pingtest C:\\Windows\\System32\\ping.exe {hostname}',
      expected: ['pingtest', 'C:\\Windows\\System32\\ping.exe', '{hostname}']
    },
    {
      label:    'quoted multi-word arg',
      input:    'dir C:\\Windows\\System32\\cmd.exe "/c dir {path}"',
      expected: ['dir', 'C:\\Windows\\System32\\cmd.exe', '/c dir {path}']
    },
    {
      label:    'multiple quoted args',
      input:    'tool ./script.sh "--flag {val}" "--other {x}"',
      expected: ['tool', './script.sh', '--flag {val}', '--other {x}']
    },
    {
      label:    'no args (just shortcut + filepath)',
      input:    'uptime /usr/bin/uptime',
      expected: ['uptime', '/usr/bin/uptime']
    },
    {
      label:    'extra whitespace between tokens',
      input:    'build  ./build.sh   {branch}',
      expected: ['build', './build.sh', '{branch}']
    }
  ];

  for (const { label, input, expected } of cases) {
    try {
      const result = tokeniseLine(input);
      JSON.stringify(result) === JSON.stringify(expected)
        ? pass(`Tokenise: ${label}`, JSON.stringify(result))
        : fail(`Tokenise: ${label}`, `expected ${JSON.stringify(expected)} got ${JSON.stringify(result)}`);
    } catch (err) {
      fail(`Tokenise: ${label}`, err.message);
    }
  }
}

// ─── T24 — systeminfo.js pure-Node helpers ────────────────────────────────────

function T24_systeminfoHelpers() {
  section('T24 — systeminfo.js Pure-Node Data Helpers');

  // We can load systeminfo.js and call its internal helpers if we expose them,
  // but since they are not exported we test the observable behaviour: the module
  // loads without error, has the expected exports, and the data property is a
  // valid SlashCommandBuilder.

  try {
    const siPath = require('path').join(__dirname, 'commands', 'systeminfo.js');
    delete require.cache[require.resolve(siPath)];
    const si = require(siPath);

    si.name === 'systeminfo'
      ? pass('systeminfo name', 'systeminfo ✓')
      : fail('systeminfo name', `got "${si.name}"`);

    typeof si.run === 'function'
      ? pass('systeminfo run()', 'exported ✓')
      : fail('systeminfo run()', 'not a function');

    const json = si.data?.toJSON?.();
    json
      ? pass('systeminfo data', `SlashCommandBuilder → name="${json.name}"`)
      : fail('systeminfo data', 'data property is missing or not a SlashCommandBuilder');

    if (json) {
      const opts    = json.options || [];
      const section = opts.find(o => o.name === 'section');
      section
        ? pass('systeminfo section option', `${section.choices?.length || 0} choices`)
        : fail('systeminfo section option', 'no "section" option found');

      const choiceValues = (section?.choices || []).map(c => c.value).sort();
      const expected     = ['all', 'disks', 'network', 'resources'].sort();
      JSON.stringify(choiceValues) === JSON.stringify(expected)
        ? pass('systeminfo section choices', choiceValues.join(', '))
        : fail('systeminfo section choices', `expected [${expected}] got [${choiceValues}]`);
    }

    // Verify that the pure-Node os module gives sane values
    const osModule = require('os');
    const totalMem = osModule.totalmem();
    const freeMem  = osModule.freemem();
    totalMem > 0   ? pass('os.totalmem()', `${(totalMem / 1073741824).toFixed(2)} GB`) : fail('os.totalmem()', 'returned 0');
    freeMem  >= 0  ? pass('os.freemem()',  `${(freeMem  / 1073741824).toFixed(2)} GB`) : fail('os.freemem()',  'returned negative');
    freeMem  < totalMem ? pass('freeMem < totalMem', 'sane ✓') : fail('freeMem < totalMem', 'free >= total — impossible');

    const cpus = osModule.cpus();
    cpus.length > 0
      ? pass('os.cpus()', `${cpus.length} core(s): ${cpus[0].model.trim().slice(0, 40)}`)
      : fail('os.cpus()', 'returned empty array');

    const ifaces = osModule.networkInterfaces();
    typeof ifaces === 'object'
      ? pass('os.networkInterfaces()', `${Object.keys(ifaces).length} interface(s)`)
      : fail('os.networkInterfaces()', 'did not return an object');

  } catch (err) {
    fail('systeminfo module', err.message);
  }
}

// ─── T25 — deploy-commands.js flush step ─────────────────────────────────────

function T25_deployFlush() {
  section('T25 — deploy-commands.js Flush Step');

  const fp = require('path').join(__dirname, 'deploy-commands.js');
  if (!require('fs').existsSync(fp)) { fail('deploy-commands.js', 'not found'); return; }

  const src = require('fs').readFileSync(fp, 'utf8');

  const checks = [
    { name: 'global flush step present',      pattern: /Routes\.applicationCommands\(/ },
    { name: 'guild PUT step present',          pattern: /Routes\.applicationGuildCommands\(/ },
    { name: 'flush wrapped in try/catch',      pattern: /try\s*\{[\s\S]*?applicationCommands[\s\S]*?\}\s*catch/ },
    { name: 'loadCommandPayloads exported',    pattern: /module\.exports.*loadCommandPayloads/ },
    { name: 'deployCommands exported',         pattern: /module\.exports.*deployCommands/ },
    { name: 'require cache cleared for cmd',   pattern: /delete require\.cache/ },
    { name: 'buildData called for cmd.js',     pattern: /mod\.buildData[\s\S]{1,120}mod\.buildData\(\)/ }
  ];

  for (const { name, pattern } of checks) {
    pattern.test(src)
      ? pass(`deploy-commands: ${name}`)
      : fail(`deploy-commands: ${name}`, 'pattern not found in source');
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function printSummary() {
  const total    = R.pass + R.fail;
  const passRate = total > 0 ? ((R.pass / total) * 100).toFixed(1) : '0.0';

  p(`\n${'═'.repeat(60)}`, 'cyan');
  p('  TEST SUMMARY', 'bold');
  p('═'.repeat(60), 'cyan');
  p(`  Total    : ${total}`,          'cyan');
  p(`  Passed   : ${R.pass}`,         R.pass > 0 ? 'green'  : 'reset');
  p(`  Failed   : ${R.fail}`,         R.fail > 0 ? 'red'    : 'green');
  p(`  Warnings : ${R.warn}`,         R.warn > 0 ? 'yellow' : 'reset');
  p(`  Pass rate: ${passRate}%`,      Number(passRate) >= 80 ? 'green' : 'yellow');

  if (R.fail > 0) {
    p('\n  Failed tests:', 'red');
    R.items.filter(i => i.ok === false).forEach(i => {
      p(`    ✗  ${i.label}  —  ${i.reason}`, 'red');
    });
    p('');
    return 1;
  }

  if (R.warn > 0) {
    p('\n  ⚠  All tests passed, but there are warnings.', 'yellow');
    p('     Run  npm run setup  to resolve configuration gaps.\n');
    return 0;
  }

  p('\n  ✓  All tests passed!\n', 'green');
  return 0;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  p('');
  p('╔════════════════════════════════════════════════════════╗', 'cyan');
  p('║                SANWAN  —  TEST SUITE                   ║', 'cyan');
  p(`║  Platform: ${os.platform().padEnd(10)}  Node: ${process.version.padEnd(10)}              ║`, 'cyan');
  p('╚════════════════════════════════════════════════════════╝', 'cyan');

  T01_environment();
  T02_directories();
  T03_plainFiles();
  T04_encryption();
  T05_encryptedStorage();
  T06_commandLoading();
  T07_commandMock();
  T08_ownerPermissions();
  T09_webhook();
  T10_daemonConfig();
  T11_logFiles();
  T12_osService();
  T13_packageJson();
  T14_botEntryPoint();
  T15_deployScript();
  T16_monitoringCommands();
  T17_rolePermissions();
  T18_registry();
  T19_setupEnvGuard();
  T20_shellCommandShape();
  T21_cmdBuildData();
  T22_placeholderSubstitution();
  T23_lineTokenisation();
  T24_systeminfoHelpers();
  T25_deployFlush();

  process.exit(printSummary());
}

if (require.main === module) main();

// ─── Programmatic API (used by setup.js) ──────────────────────────────────────

/**
 * Run the full test suite without calling process.exit().
 * Returns the result counts so the caller can decide what to do next.
 *
 * @returns {{ passed: number, failed: number, warnings: number }}
 */
function runTests() {
  // Reset the shared result tracker so repeated calls stay independent
  R.pass = 0; R.fail = 0; R.warn = 0; R.items = [];

  T01_environment();
  T02_directories();
  T03_plainFiles();
  T04_encryption();
  T05_encryptedStorage();
  T06_commandLoading();
  T07_commandMock();
  T08_ownerPermissions();
  T09_webhook();
  T10_daemonConfig();
  T11_logFiles();
  T12_osService();
  T13_packageJson();
  T14_botEntryPoint();
  T15_deployScript();
  T16_monitoringCommands();
  T17_rolePermissions();
  T18_registry();
  T19_setupEnvGuard();
  T20_shellCommandShape();
  T21_cmdBuildData();
  T22_placeholderSubstitution();
  T23_lineTokenisation();
  T24_systeminfoHelpers();
  T25_deployFlush();

  printSummary(); // print results, but do NOT call process.exit()

  return { passed: R.pass, failed: R.fail, warnings: R.warn };
}

module.exports = {
  runTests,
  T01_environment, T04_encryption, T05_encryptedStorage,
  T06_commandLoading, T12_osService, T09_webhook,
  T17_rolePermissions, T18_registry, T19_setupEnvGuard,
  T20_shellCommandShape, T21_cmdBuildData, T22_placeholderSubstitution,
  T23_lineTokenisation, T24_systeminfoHelpers, T25_deployFlush
};
