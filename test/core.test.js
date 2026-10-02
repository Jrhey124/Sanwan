'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const EventEmitter = require('node:events');
const nodeCrypto = require('node:crypto');
const Module = require('node:module');

// Unit tests use isolated temporary file stores; the SQLite backend is covered
// explicitly below and enabled in Docker production.
process.env.SQLITE_STORAGE = '0';

const crypto = require('../utils/crypto');
const { Storage } = require('../utils/storage');
const storageSingleton = require('../utils/storage');
const registry = require('../utils/registry');
const { tokenizeArguments } = require('../utils/arguments');
const { GitHubWebhook } = require('../utils/github-webhook');
const { serviceInstall, buildWindowsTaskXml } = require('../utils/os-service');
const ChangeTracker = require('../utils/change-tracker');
const { getPollInterval } = require('../utils/polling-config');
const { resolveGitHubMode } = require('../utils/github-config');
const { Logger } = require('../utils/logger');
const { isValidDateOnly, isDueWithinDays } = require('../utils/task-dates');
const { isValidCronExpression } = require('../utils/cron-expression');
const { resolveShellCommand, runShellCommand, parseScheduleInvocation, runScheduledShortcut } = require('../utils/shell-command');
const { CronJob } = require('cron');
const SanwanDaemon = require('../daemon');
const SqliteStore = require('../utils/sqlite-store');

test('SQLite store persists encrypted records without plaintext on disk', () => {
  const previousKey = process.env.SETTINGS_KEY;
  process.env.SETTINGS_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanwan-sqlite-'));
  const file = path.join(dir, 'records.sqlite');
  const store = new SqliteStore(file);
  store.write('notes/notes.json', { notes: [{ nid: 'N1', content: ['secret'] }] });
  assert.deepEqual(store.read('notes/notes.json').notes[0].content, ['secret']);
  store.close();
  assert.equal(fs.readFileSync(file, 'utf8').includes('secret'), false);
  fs.rmSync(dir, { recursive: true, force: true });
  if (previousKey === undefined) delete process.env.SETTINGS_KEY;
  else process.env.SETTINGS_KEY = previousKey;
});

test('AES-GCM round trips text and objects, and detects tampering', () => {
  const previousKey = process.env.SETTINGS_KEY;
  process.env.SETTINGS_KEY = crypto.generateKey();
  try {
    const message = 'Sanwan 🔐';
    const envelope = crypto.encrypt(message);
    assert.equal(crypto.decrypt(envelope), message);
    const object = { task: 'ship', count: 2 };
    assert.deepEqual(crypto.decryptObject(crypto.encryptObject(object)), object);

    const parsed = JSON.parse(envelope);
    parsed.data = (parsed.data[0] === '0' ? '1' : '0') + parsed.data.slice(1);
    assert.throws(() => crypto.decrypt(JSON.stringify(parsed)));
  } finally {
    if (previousKey === undefined) delete process.env.SETTINGS_KEY;
    else process.env.SETTINGS_KEY = previousKey;
  }
});

test('crypto rejects absent and malformed keys and malformed envelopes', () => {
  const previousKey = process.env.SETTINGS_KEY;
  try {
    delete process.env.SETTINGS_KEY;
    assert.throws(() => crypto.encrypt('secret'), /SETTINGS_KEY is not set/);
    process.env.SETTINGS_KEY = 'short';
    assert.throws(() => crypto.encrypt('secret'), /64 hex characters/);
    process.env.SETTINGS_KEY = crypto.generateKey();
    assert.throws(() => crypto.decrypt('{bad json'), /invalid .* envelope/);
    assert.throws(() => crypto.decrypt('{}'), /missing required fields/);
  } finally {
    if (previousKey === undefined) delete process.env.SETTINGS_KEY;
    else process.env.SETTINGS_KEY = previousKey;
  }
});

test('storage reads defaults, writes nested JSON, and implements array operations', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanwan-storage-'));
  try {
    const storage = new Storage(dir);
    assert.deepEqual(storage.read('nested/items.json', { items: [] }), { items: [] });
    assert.throws(() => storage.getPath('../outside.json'), /escapes the data directory/);
    assert.throws(() => storage.getPath(path.resolve(dir, '..', 'outside.json')), /escapes the data directory/);
    assert.equal(storage.append('nested/items.json', { id: 1, title: 'Alpha' }), true);
    assert.equal(storage.append('nested/items.json', { id: 2, title: 'Beta' }), true);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'nested')), ['items.json']);
    assert.equal(storage.updateById('nested/items.json', 1, { status: 'done' }), true);
    assert.deepEqual(storage.findById('nested/items.json', 1), { id: 1, title: 'Alpha', status: 'done' });
    assert.deepEqual(storage.search('nested/items.json', 'title', 'ET'), [{ id: 2, title: 'Beta' }]);
    assert.equal(storage.removeById('nested/items.json', 2), true);
    assert.equal(storage.removeById('nested/items.json', 2), false);
    assert.equal(storage.getNextId('ids.json', 'T'), 'T001');
    assert.equal(storage.getNextId('ids.json', 'T'), 'T002');
    assert.equal(storage.backup('nested/items.json'), true);
    assert.equal(storage.initializeIfMissing('new/defaults.json', { ready: true }), true);
    assert.equal(storage.initializeIfMissing('new/defaults.json', { ready: false }), true);
    assert.deepEqual(storage.read('new/defaults.json'), { ready: true });
    fs.mkdirSync(path.join(dir, 'blocked.json'));
    assert.equal(storage.write('blocked.json', { value: true }), false);
    assert.throws(() => storage.getNextId('blocked.json'), /Could not persist the next ID/);
    const originalWrite = storage.write;
    storage.write = () => false;
    assert.throws(() => storage.initializeIfMissing('blocked-init.json', {}), /Could not initialize/);
    storage.write = originalWrite;
    storage.encryptedWrite = () => false;
    assert.throws(() => storage.initializeEncryptedIfMissing('private/failed.enc', {}), /Could not initialize encrypted/);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'blocked.json')), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('registry encrypts CRUD updates, enforces command gates, and reports failed writes', () => {
  const previousKey = process.env.SETTINGS_KEY;
  const previousDataDir = storageSingleton.dataDir;
  const originalEncryptedWrite = storageSingleton.encryptedWrite;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanwan-registry-'));
  try {
    process.env.SETTINGS_KEY = crypto.generateKey();
    storageSingleton.dataDir = dir;

    assert.equal(registry.isCommandAllowed('help'), true);
    assert.equal(registry.isCommandAllowed('task'), true);
    assert.equal(registry.isCommandAllowed('cmd'), true);
    registry.addAllowedCommand({ id: 'task', name: 'task', type: 'bot', enabled: false });
    assert.equal(registry.isCommandAllowed('task'), false);
    assert.equal(registry.isCommandAllowed('cmd'), false);

    registry.addAllowedCommand({
      id: 'backup', name: 'backup', type: 'shell', enabled: true,
      filepath: 'node', command: 'node {target}', params: '{target}'
    });
    assert.equal(registry.isCommandAllowed('cmd'), true);
    assert.equal(registry.updateAllowedCommand('backup', { enabled: false }).enabled, false);
    assert.equal(registry.isCommandAllowed('cmd'), false);
    const raw = fs.readFileSync(path.join(dir, 'registry.enc'), 'utf8');
    assert.equal(raw.includes('node {target}'), false);

    registry.addLogSource({ id: 'app', name: 'application', path: 'app.log' });
    assert.equal(registry.findLogSource('application').path, 'app.log');
    registry.addDeployService({ id: 'api', name: 'api', startCmd: 'start', stopCmd: 'stop' });
    assert.equal(registry.listDeployServices()[0].name, 'api');

    storageSingleton.encryptedWrite = () => false;
    assert.throws(() => registry.addAllowedCommand({ id: 'new', name: 'new', type: 'bot' }), /Could not persist the command registry/);

    const validKey = process.env.SETTINGS_KEY;
    process.env.SETTINGS_KEY = crypto.generateKey();
    assert.throws(() => registry.isCommandAllowed('task'), /command access is blocked/);
    delete process.env.SETTINGS_KEY;
    assert.throws(() => registry.isCommandAllowed('task'), /SETTINGS_KEY is required/);
    process.env.SETTINGS_KEY = validKey;
  } finally {
    storageSingleton.encryptedWrite = originalEncryptedWrite;
    storageSingleton.dataDir = previousDataDir;
    if (previousKey === undefined) delete process.env.SETTINGS_KEY;
    else process.env.SETTINGS_KEY = previousKey;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('daemon execution history keeps the newest 100 entries and reports persistence status', () => {
  const previousDataDir = storageSingleton.dataDir;
  const originalWrite = storageSingleton.write;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanwan-daemon-history-'));
  try {
    storageSingleton.dataDir = dir;
    const daemon = new SanwanDaemon();
    assert.equal(storageSingleton.write('schedules/schedules.json', { schedules: [], history: [] }), true);

    for (let index = 0; index < 101; index++) {
      assert.equal(daemon.recordExecution('S001', 'completed', `run-${index}`), true);
    }
    const history = storageSingleton.read('schedules/schedules.json').history;
    assert.equal(history.length, 100);
    assert.equal(history[0].result, 'run-1');
    assert.equal(history.at(-1).result, 'run-100');
    assert.ok(Number.isFinite(Date.parse(history.at(-1).timestamp)));

    storageSingleton.write = () => false;
    assert.equal(daemon.recordExecution('S001', 'failed', 'no disk space'), false);
  } finally {
    storageSingleton.write = originalWrite;
    storageSingleton.dataDir = previousDataDir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('daemon reminders skip completed and overdue tasks, deduplicate sends, and retry failures', async () => {
  const previousDataDir = storageSingleton.dataDir;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanwan-task-reminders-'));
  try {
    storageSingleton.dataDir = dir;
    const today = new Date();
    const asDateOnly = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    storageSingleton.write('tasks/tasks.json', { tasks: [
      { tid: 'T1', deadline: asDateOnly(today), status: 'open' },
      { tid: 'T2', deadline: asDateOnly(tomorrow), status: 'in_progress' },
      { tid: 'T3', deadline: asDateOnly(yesterday), status: 'open' },
      { tid: 'T4', deadline: asDateOnly(tomorrow), status: 'completed' },
      { tid: 'T5', deadline: 'not-a-date', status: 'open' }
    ] });

    const daemon = new SanwanDaemon();
    const sends = [];
    let failedOnce = true;
    daemon.sendTaskReminder = async task => {
      sends.push(task.tid);
      if (task.tid === 'T2' && failedOnce) { failedOnce = false; return false; }
      return true;
    };

    await daemon.checkTaskReminders();
    await daemon.checkTaskReminders();
    assert.deepEqual(sends, ['T1', 'T2', 'T2']);
    assert.equal(daemon.remindedTasks.has(`T1:${asDateOnly(today)}`), true);
    assert.equal(daemon.remindedTasks.has(`T2:${asDateOnly(tomorrow)}`), true);
  } finally {
    storageSingleton.dataDir = previousDataDir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('storage encrypted read/write keeps plaintext off disk and reports wrong keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanwan-encrypted-'));
  const previousKey = process.env.SETTINGS_KEY;
  const previousPath = process.env.SETTINGS_PATH;
  try {
    process.env.SETTINGS_KEY = crypto.generateKey();
    const storage = new Storage(dir);
    assert.equal(storage.encryptedWrite('private/settings.enc', { token: 'not-on-disk' }), true);
    const disk = fs.readFileSync(path.join(dir, 'private/settings.enc'), 'utf8');
    assert.equal(disk.includes('not-on-disk'), false);
    assert.deepEqual(storage.encryptedRead('private/settings.enc'), { token: 'not-on-disk' });
    process.env.SETTINGS_KEY = crypto.generateKey();
    assert.throws(() => storage.encryptedRead('private/settings.enc'), { code: 'ERR_KEY_MISMATCH' });
  } finally {
    if (previousKey === undefined) delete process.env.SETTINGS_KEY;
    else process.env.SETTINGS_KEY = previousKey;
    if (previousPath === undefined) delete process.env.SETTINGS_PATH;
    else process.env.SETTINGS_PATH = previousPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('permission checks preserve help bypass and enforce any/all, disabled, and open rules', () => {
  const previousKey = process.env.SETTINGS_KEY;
  const previousPath = process.env.SETTINGS_PATH;
  const previousCwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanwan-permissions-'));
  try {
    process.chdir(dir);
    delete require.cache[require.resolve('../utils/storage')];
    delete require.cache[require.resolve('../utils/permissions')];
    const permissions = require('../utils/permissions');
    delete process.env.SETTINGS_KEY;
    assert.equal(permissions.checkPermission('help', []).allowed, true);
    assert.equal(permissions.checkPermission('task', []).allowed, true);
    process.env.SETTINGS_KEY = crypto.generateKey();
    process.env.SETTINGS_PATH = './data/settings.enc';
    permissions.setCommandRoles('deploy', { requiredRoles: ['ops', 'admin'] });
    assert.equal(permissions.checkPermission('deploy', ['ops']).allowed, true);
    permissions.setCommandRoles('deploy', { requireAll: true });
    assert.equal(permissions.checkPermission('deploy', ['ops']).allowed, false);
    assert.equal(permissions.checkPermission('deploy', ['ops', 'admin']).allowed, true);
    permissions.setCommandRoles('deploy', { enabled: false });
    assert.equal(permissions.checkPermission('deploy', ['ops', 'admin']).allowed, false);
    permissions.removeCommandEntry('deploy');
    assert.equal(permissions.checkPermission('deploy', []).allowed, true);

    const permissionStorage = require('../utils/storage');
    const encryptedWrite = permissionStorage.encryptedWrite;
    try {
      permissionStorage.encryptedWrite = () => false;
      assert.throws(() => permissions.setCommandRoles('readonly', {}), /Could not persist role permissions/);
    } finally {
      permissionStorage.encryptedWrite = encryptedWrite;
    }
    const validKey = process.env.SETTINGS_KEY;
    process.env.SETTINGS_KEY = crypto.generateKey();
    assert.throws(() => permissions.checkPermission('task', []), /command access is blocked/);
    delete process.env.SETTINGS_KEY;
    assert.throws(() => permissions.checkPermission('task', []), /SETTINGS_KEY is required/);
    process.env.SETTINGS_KEY = validKey;
  } finally {
    process.chdir(previousCwd);
    if (previousKey === undefined) delete process.env.SETTINGS_KEY;
    else process.env.SETTINGS_KEY = previousKey;
    if (previousPath === undefined) delete process.env.SETTINGS_PATH;
    else process.env.SETTINGS_PATH = previousPath;
    fs.rmSync(dir, { recursive: true, force: true });
    delete require.cache[require.resolve('../utils/permissions')];
    delete require.cache[require.resolve('../utils/storage')];
  }
});

test('shell argument tokenizer preserves quoted args and placeholder values as one argument', () => {
  const values = tokenizeArguments('--name "{name}" --path \'{path}\' plain');
  assert.deepEqual(values, ['--name', '{name}', '--path', '{path}', 'plain']);
  const injected = 'hello; echo compromised';
  assert.deepEqual(tokenizeArguments(`"${injected}"`), [injected]);
});

test('webhook rejects invalid signatures and emits verified events', async () => {
  const secret = 'test-webhook-secret';
  const webhook = new GitHubWebhook({ secret, path: '/hooks/github' });
  const payload = JSON.stringify({ ref: 'refs/heads/main', commits: [{ id: 'abc' }] });
  const deliver = (signature) => new Promise(resolve => {
    const request = new EventEmitter();
    request.method = 'POST';
    request.url = '/hooks/github';
    request.headers = {
      'x-hub-signature-256': signature,
      'x-github-event': 'push',
      'x-github-delivery': 'delivery-1'
    };
    const response = {
      status: 0,
      writeHead(status) { this.status = status; },
      end(body) { this.body = body; resolve({ status: this.status, body: this.body }); }
    };
    webhook._handleRequest(request, response);
    request.emit('data', Buffer.from(payload));
    request.emit('end');
  });

  let emitted = 0;
  webhook.on('push', ({ payload: received }) => {
    emitted++;
    assert.equal(received.ref, 'refs/heads/main');
  });
  const rejected = await deliver('sha256=invalid');
  assert.equal(rejected.status, 401);
  assert.equal(emitted, 0);

  const signature = 'sha256=' + nodeCrypto.createHmac('sha256', secret).update(payload).digest('hex');
  const accepted = await deliver(signature);
  assert.equal(accepted.status, 200);
  assert.equal(JSON.parse(accepted.body).event, 'push');
  assert.equal(emitted, 1);

  const unconfigured = new GitHubWebhook({ path: '/hooks/github' });
  await assert.rejects(unconfigured.start(), /GITHUB_WEBHOOK_SECRET is required/);
  const unsignedRequest = new EventEmitter();
  unsignedRequest.method = 'POST';
  unsignedRequest.url = '/hooks/github';
  unsignedRequest.headers = {};
  const unsignedResponse = {
    status: 0,
    writeHead(status) { this.status = status; },
    end(body) { this.body = body; }
  };
  unconfigured._handleRequest(unsignedRequest, unsignedResponse);
  assert.equal(unsignedResponse.status, 503);

  const limited = new GitHubWebhook({ secret, path: '/hooks/github', maxBodyBytes: 4 });
  const largeRequest = new EventEmitter();
  largeRequest.method = 'POST';
  largeRequest.url = '/hooks/github';
  largeRequest.headers = {};
  const largeResponse = {
    status: 0,
    writeHead(status) { this.status = status; },
    end(body) { this.body = body; this.writableEnded = true; }
  };
  limited._handleRequest(largeRequest, largeResponse);
  largeRequest.emit('data', Buffer.from('12345'));
  assert.equal(largeResponse.status, 413);
});

test('task date logic rejects impossible dates and includes whole due dates', () => {
  assert.equal(isValidDateOnly('2024-02-29'), true);
  assert.equal(isValidDateOnly('2023-02-29'), false);
  assert.equal(isValidDateOnly('2024-13-01'), false);
  assert.equal(isValidDateOnly('2024-2-01'), false);

  const now = new Date(2026, 8, 30, 18, 30);
  assert.equal(isDueWithinDays('2026-09-30', 0, now), true);
  assert.equal(isDueWithinDays('2026-10-01', 1, now), true);
  assert.equal(isDueWithinDays('2026-10-02', 1, now), false);
  assert.equal(isDueWithinDays('not-a-date', 3, now), false);
  assert.equal(isDueWithinDays('2026-09-30', -1, now), false);
});

test('change tracker seeds existing items but emits the first later item even from an empty seed', () => {
  const tracker = new ChangeTracker();
  assert.deepEqual(tracker.newItems([], item => item.id), []);
  assert.deepEqual(tracker.newItems([{ id: 'first' }], item => item.id), [{ id: 'first' }]);
  assert.deepEqual(tracker.newItems([{ id: 'first' }, { id: 'second' }], item => item.id), [{ id: 'second' }]);

  tracker.reset();
  assert.deepEqual(tracker.newItems([{ id: 'existing' }], item => item.id), []);
  assert.deepEqual(tracker.newItems([{ id: 'existing' }], item => item.id), []);
});

test('polling interval clamps requests to stay within the public GitHub API rate limit', () => {
  assert.equal(getPollInterval(undefined, false), 120_000);
  assert.equal(getPollInterval(60_000, false), 120_000);
  assert.equal(getPollInterval(0, false), 120_000);
  assert.equal(getPollInterval('invalid', false), 120_000);
  assert.equal(getPollInterval(1_000, true), 5_000);
  assert.equal(getPollInterval(60_000, true), 60_000);
});

test('setup preserves the selected GitHub integration mode when the user presses Enter', () => {
  assert.equal(resolveGitHubMode('', 'webhook'), 'webhook');
  assert.equal(resolveGitHubMode('', 'polling_pat'), 'polling_pat');
  assert.equal(resolveGitHubMode('', 'polling'), 'polling');
  assert.equal(resolveGitHubMode('1', 'webhook'), 'polling');
  assert.equal(resolveGitHubMode('2', 'polling_pat'), 'webhook');
  assert.equal(resolveGitHubMode('', 'none'), 'polling');
});

test('cron validation accepts standard fields and rejects out-of-range values', () => {
  for (const expression of ['0 2 * * *', '*/15 9-17 * JAN,MAR MON-FRI', '0 0 1 * 0,7', '*/60 * * * *']) {
    assert.equal(isValidCronExpression(expression), true, expression);
  }
  for (const expression of ['0 2 * *', '99 2 * * *', '0 24 * * *', '0 0 32 * *', '0 0 * 13 *', '0 0 * * 8', '*/0 * * * *', '1,,2 * * * *']) {
    assert.equal(isValidCronExpression(expression), false, expression);
  }
});

test('valid cron expressions are accepted by the daemon scheduler parser', () => {
  for (const expression of ['0 2 * * *', '*/5 9-17 * JAN MON-FRI', '0 0 1,15 * *']) {
    assert.equal(isValidCronExpression(expression), true, expression);
    assert.doesNotThrow(() => new CronJob(expression, () => {}, null, false, 'UTC'), expression);
  }
  for (const expression of ['61 * * * *', '0 25 * * *', '0 0 * FOO *']) {
    assert.equal(isValidCronExpression(expression), false, expression);
  }
});

test('every command exports a valid Discord slash-command definition', () => {
  const commandsDir = path.join(__dirname, '..', 'commands');
  for (const filename of fs.readdirSync(commandsDir).filter(name => name.endsWith('.js'))) {
    const command = require(path.join(commandsDir, filename));
    assert.equal(typeof command.name, 'string', filename);
    assert.equal(typeof command.run, 'function', filename);
    const definition = command.data.toJSON();
    assert.equal(definition.name, command.name, filename);
    assert.ok(definition.description, filename);
  }
});

test('Windows scheduled task artifact matches its UTF-16 XML declaration and escapes content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanwan-windows-task-'));
  try {
    const result = serviceInstall({
      name: 'sanwan-test', description: 'Bot & <worker>', workingDir: dir,
      nodeExec: 'C:\\Program Files\\node.exe', script: 'sanwan.js'
    }, 'win32');
    const bytes = fs.readFileSync(result.filePath);
    assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe]);
    const xml = bytes.subarray(2).toString('utf16le');
    assert.match(xml, /encoding="UTF-16"/);
    assert.match(xml, /Bot &amp; &lt;worker&gt;/);
    assert.ok(xml.includes('C:\\Program Files\\node.exe'));
    assert.match(xml, /<Arguments>.*sanwan\.js<\/Arguments>/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const escaped = buildWindowsTaskXml({ description: 'A & B', workingDir: 'D:\\Data & Logs', nodeExec: 'node.exe', script: 'run.js' });
  assert.ok(escaped.includes('D:\\Data &amp; Logs'));
});

test('logger reads only safe log filenames and bounds the requested tail size', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanwan-logger-'));
  try {
    const logger = new Logger(dir);
    logger.writeToFile('bot.log', 'one\ntwo\nthree\n');
    assert.equal(logger.readLog('bot.log', 2), 'two\nthree');
    assert.equal(logger.readLog('../secret.log', 10), null);
    assert.equal(logger.readLog('..\\secret.log', 10), null);
    assert.equal(logger.readLog('bot.log', 0), null);
    assert.equal(logger.readLog('bot.log', 1001), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('registered command runner preserves dynamic arguments and enforces shortcut boundaries', async () => {
  const entry = {
    id: 'echo', type: 'shell', enabled: true,
    filepath: process.execPath,
    command: `${process.execPath} -e "process.stdout.write(process.argv[1])" {value}`
  };
  const supplied = 'literal; do not execute';
  const command = resolveShellCommand(entry, name => name === 'value' ? supplied : undefined);
  assert.equal(command.args.at(-1), supplied);
  assert.equal(await runShellCommand(command), supplied);
  assert.throws(() => resolveShellCommand({ ...entry, filepath: 'C:\\Windows\\System32\\cmd.exe', command: 'C:\\Windows\\System32\\cmd.exe /c echo {value}' }, () => 'unsafe'), /Placeholders are not allowed/);
  for (const shell of ['sh', 'bash', 'dash', 'zsh', 'fish', 'ksh', 'csh', 'tcsh', 'ash', 'nu', 'powershell', 'pwsh']) {
    const filepath = `C:\\Shells\\${shell}.exe`;
    assert.throws(() => resolveShellCommand({
      ...entry, filepath, command: `${filepath} -c {value}`
    }, () => 'unsafe'), /Placeholders are not allowed/, shell);
  }
  assert.throws(() => resolveShellCommand(entry, () => undefined), /Missing value/);
  await assert.rejects(runShellCommand({ executable: process.execPath, args: ['-e', 'process.exit(3)'] }), /status 3/);
});

test('scheduled command syntax accepts only a shortcut ID and scalar JSON arguments', () => {
  assert.deepEqual(parseScheduleInvocation('/cmd build {"branch":"release"}'), {
    shortcutId: 'build', values: { branch: 'release' }
  });
  assert.deepEqual(parseScheduleInvocation('/cmd backup'), { shortcutId: 'backup', values: {} });
  assert.throws(() => parseScheduleInvocation('/deploy backup'), /Use `\/cmd/);
  assert.throws(() => parseScheduleInvocation('/cmd build []'), /JSON object/);
  assert.throws(() => parseScheduleInvocation('/cmd build {"arg":null}'), /only strings/);
});

test('scheduled shortcut runs only enabled registry entries and rejects missing placeholders', async () => {
  const entry = {
    id: 'echo', type: 'shell', enabled: true, filepath: process.execPath,
    command: `${process.execPath} -e "process.stdout.write(process.argv[1])" {branch}`
  };
  assert.equal(await runScheduledShortcut('/cmd echo {"Branch":"release"}', [entry]), 'release');
  await assert.rejects(runScheduledShortcut('/cmd echo', [entry]), /Missing value/);
  await assert.rejects(runScheduledShortcut('/cmd disabled', [{ ...entry, enabled: false }]), /No enabled shell shortcut/);
  await assert.rejects(runScheduledShortcut('/task list', [entry]), /Use `\/cmd/);
});

test('task command creates, validates, updates, and filters task records', async () => {
  const previousCwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanwan-task-command-'));
  const originalLoad = Module._load;
  const modulePaths = ['../commands/task', '../utils/storage', '../utils/logger'];
  try {
    process.chdir(dir);
    for (const name of modulePaths) delete require.cache[require.resolve(name)];
    const chain = () => new Proxy({}, {
      get(_target, property) {
        if (property === 'then') return undefined;
        return (...args) => {
          for (const arg of args) if (typeof arg === 'function') arg(chain());
          return chain();
        };
      }
    });
    Module._load = function (request, parent, isMain) {
      if (request === 'discord.js') return { SlashCommandBuilder: class { constructor() { return chain(); } } };
      return originalLoad.call(this, request, parent, isMain);
    };
    const task = require('../commands/task');
    const replies = [];
    const invoke = async (subcommand, values) => task.run({
      user: { tag: 'Tester' },
      options: {
        getSubcommand: () => subcommand,
        getString: name => values[name] ?? null,
        getInteger: name => values[name] ?? null
      },
      reply: async message => replies.push(message)
    });

    await invoke('add', { title: 'Ship it', deadline: '2026-09-30' });
    const storage = require('../utils/storage');
    let tasks = storage.list('tasks/tasks.json', 'tasks');
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].tid, 'T0');
    assert.equal(tasks[0].status, 'open');

    await invoke('add', { title: 'Invalid', deadline: '2026-02-30' });
    assert.match(replies.at(-1).content, /real calendar date/);
    assert.equal(storage.list('tasks/tasks.json', 'tasks').length, 1);

    await invoke('update', { tid: 't0', field: 'status', value: 'completed' });
    tasks = storage.list('tasks/tasks.json', 'tasks');
    assert.equal(tasks[0].status, 'completed');

    await invoke('due', { days: 2 });
    assert.match(replies.at(-1).content, /No tasks due/);
    await invoke('remove', { tid: 'T0' });
    assert.equal(storage.list('tasks/tasks.json', 'tasks').length, 0);
  } finally {
    Module._load = originalLoad;
    process.chdir(previousCwd);
    for (const name of modulePaths) delete require.cache[require.resolve(name)];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('schedule command rejects invalid cron and supports create, toggle, and remove', async () => {
  const previousCwd = process.cwd();
  const previousKey = process.env.SETTINGS_KEY;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanwan-schedule-command-'));
  const originalLoad = Module._load;
  const modulePaths = ['../commands/schedule', '../utils/registry', '../utils/storage', '../utils/logger'];
  try {
    process.chdir(dir);
    process.env.SETTINGS_KEY = crypto.generateKey();
    for (const name of modulePaths) delete require.cache[require.resolve(name)];
    const chain = () => new Proxy({}, {
      get(_target, property) {
        if (property === 'then') return undefined;
        return (...args) => {
          for (const arg of args) if (typeof arg === 'function') arg(chain());
          return chain();
        };
      }
    });
    Module._load = function (request, parent, isMain) {
      if (request === 'discord.js') return { SlashCommandBuilder: class { constructor() { return chain(); } } };
      return originalLoad.call(this, request, parent, isMain);
    };
    const schedule = require('../commands/schedule');
    const registry = require('../utils/registry');
    const storage = require('../utils/storage');
    registry.addAllowedCommand({ id: 'backup', name: 'backup', type: 'shell', enabled: true, filepath: process.execPath, command: `${process.execPath} -e "process.exit(0)"` });
    const replies = [];
    const invoke = async (subcommand, values) => schedule.run({
      user: { tag: 'Tester' }, channelId: 'channel-1',
      options: {
        getSubcommand: () => subcommand,
        getString: name => values[name] ?? null
      },
      reply: async message => replies.push(message)
    });

    await invoke('set', { name: 'bad', cron: '99 2 * * *', command: '/cmd backup' });
    assert.match(replies.at(-1).content, /Invalid cron expression/);
    assert.equal(storage.list('schedules/schedules.json', 'schedules').length, 0);

    await invoke('set', { name: 'unknown', cron: '0 2 * * *', command: '/cmd missing' });
    assert.match(replies.at(-1).content, /No enabled shell shortcut/);
    assert.equal(storage.list('schedules/schedules.json', 'schedules').length, 0);

    await invoke('set', { name: 'nightly', cron: '0 2 * * *', command: '/cmd backup' });
    let records = storage.list('schedules/schedules.json', 'schedules');
    assert.equal(records.length, 1);
    assert.equal(records[0].sid, 'S001');
    assert.equal(records[0].command, '/cmd backup');
    await invoke('set', { name: 'NIGHTLY', cron: '0 3 * * *', command: '/cmd backup' });
    assert.match(replies.at(-1).content, /already exists/);
    assert.equal(storage.list('schedules/schedules.json', 'schedules').length, 1);
    await invoke('toggle', { name: 'nightly' });
    records = storage.list('schedules/schedules.json', 'schedules');
    assert.equal(records[0].enabled, false);
    await invoke('remove', { name: 'nightly' });
    assert.equal(storage.list('schedules/schedules.json', 'schedules').length, 0);
  } finally {
    Module._load = originalLoad;
    process.chdir(previousCwd);
    if (previousKey === undefined) delete process.env.SETTINGS_KEY;
    else process.env.SETTINGS_KEY = previousKey;
    for (const name of modulePaths) delete require.cache[require.resolve(name)];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('note command preserves IDs, supports title lookups, and reports failed writes', async () => {
  const previousCwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanwan-note-command-'));
  const originalLoad = Module._load;
  const modulePaths = ['../commands/note', '../utils/storage', '../utils/logger'];
  try {
    process.chdir(dir);
    for (const name of modulePaths) delete require.cache[require.resolve(name)];
    const chain = () => new Proxy({}, {
      get(_target, property) {
        if (property === 'then') return undefined;
        return (...args) => {
          for (const arg of args) if (typeof arg === 'function') arg(chain());
          return chain();
        };
      }
    });
    Module._load = function (request, parent, isMain) {
      if (request === 'discord.js') return {
        SlashCommandBuilder: class { constructor() { return chain(); } },
        EmbedBuilder: class { constructor() { return chain(); } },
        AttachmentBuilder: class { constructor(data, options) { this.data = data; this.options = options; } }
      };
      return originalLoad.call(this, request, parent, isMain);
    };
    const note = require('../commands/note');
    const storage = require('../utils/storage');
    const replies = [];
    const invoke = async (subcommand, values) => note.run({
      user: { tag: 'Tester' },
      options: {
        getSubcommand: () => subcommand,
        getString: name => values[name] ?? null
      },
      reply: async message => replies.push(message)
    });

    await invoke('insert', { title: 'Meeting', content: 'first\\nsecond' });
    let notes = storage.list('notes/notes.json', 'notes');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].nid, 'N1');
    assert.deepEqual(notes[0].content, ['first', 'second']);
    const created = notes[0].created;

    await invoke('insert', { title: 'MEETING', content: 'replacement' });
    notes = storage.list('notes/notes.json', 'notes');
    assert.equal(notes[0].nid, 'N1');
    assert.equal(notes[0].created, created);
    assert.deepEqual(notes[0].content, ['replacement']);

    await invoke('append', { title: 'meeting', content: 'line 2\\nline 3' });
    notes = storage.list('notes/notes.json', 'notes');
    assert.deepEqual(notes[0].content, ['replacement', 'line 2', 'line 3']);

    await invoke('update', { ref: 'n1', title: 'Planning', content: 'agenda' });
    notes = storage.list('notes/notes.json', 'notes');
    assert.equal(notes[0].title, 'Planning');
    assert.deepEqual(notes[0].content, ['agenda']);

    const originalAppend = storage.append;
    storage.append = () => false;
    await invoke('push', { content: 'not saved' });
    storage.append = originalAppend;
    assert.match(replies.at(-1).content, /Could not save the note/);
    assert.equal(storage.list('notes/notes.json', 'notes').length, 1);

    await invoke('remove', { ref: 'planning' });
    assert.equal(storage.list('notes/notes.json', 'notes').length, 0);
  } finally {
    Module._load = originalLoad;
    process.chdir(previousCwd);
    for (const name of modulePaths) delete require.cache[require.resolve(name)];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('per-user queue keeps FIFO order and continues after a command failure', async () => {
  const previousCwd = process.cwd();
  const previousKey = process.env.SETTINGS_KEY;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanwan-queue-'));
  const originalLoad = Module._load;
  const modulePaths = ['../utils/queue', '../utils/registry', '../utils/permissions', '../utils/storage', '../utils/logger'];
  try {
    process.chdir(dir);
    delete process.env.SETTINGS_KEY;
    for (const name of modulePaths) delete require.cache[require.resolve(name)];
    const queue = require('../utils/queue');
    const executed = [];
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });
    const makeInteraction = (id, name) => ({
      commandName: name,
      user: { id, tag: `user-${id}` },
      member: { roles: { cache: new Map() } },
      replies: [],
      replied: false,
      reply: async function (message) { this.replied = true; this.replies.push(message); },
      editReply: async function (message) { this.replies.push({ ...message, edited: true }); }
    });
    const first = makeInteraction('u1', 'task');
    const second = makeInteraction('u1', 'note');
    await queue.enqueue(first, async () => { executed.push('first-start'); await firstGate; executed.push('first-end'); });
    await queue.enqueue(second, async interaction => { executed.push('second'); await interaction.reply({ content: 'final response' }); });
    assert.match(second.replies[0].content, /is queued/);
    assert.deepEqual(executed, ['first-start']);
    releaseFirst();
    for (let i = 0; i < 50 && queue.stats().running; i++) await new Promise(resolve => setTimeout(resolve, 2));
    assert.deepEqual(executed, ['first-start', 'first-end', 'second']);
    assert.equal(second.replies.filter(reply => reply.edited).length, 1);
    assert.equal(second.replies.filter(reply => /already acknowledged|Unknown interaction/.test(reply.content || '')).length, 0);
    assert.deepEqual(queue.stats(), { queued: 0, running: 0, users: [] });

    const failed = makeInteraction('u2', 'task');
    const next = makeInteraction('u2', 'note');
    await queue.enqueue(failed, async () => { throw new Error('expected test failure'); });
    await queue.enqueue(next, async interaction => { executed.push('after-failure'); await interaction.reply({ content: 'after failure' }); });
    for (let i = 0; i < 50 && queue.stats().running; i++) await new Promise(resolve => setTimeout(resolve, 2));
    assert.ok(failed.replies.some(reply => /Something went wrong/.test(reply.content)));
    assert.equal(executed.at(-1), 'after-failure');
    assert.equal(queue.stats().running, 0);

    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'data', 'registry.enc'), 'corrupt registry');
    const blocked = makeInteraction('u3', 'task');
    let blockedCommandRan = false;
    await queue.enqueue(blocked, async () => { blockedCommandRan = true; });
    assert.equal(blockedCommandRan, false);
    assert.match(blocked.replies[0].content, /Security settings could not be read/);

    fs.rmSync(path.join(dir, 'data', 'registry.enc'));
    process.env.SETTINGS_KEY = crypto.generateKey();
    fs.writeFileSync(path.join(dir, 'data', 'settings.enc'), 'corrupt settings');
    const blockedByRoles = makeInteraction('u4', 'task');
    let roleBlockedCommandRan = false;
    await queue.enqueue(blockedByRoles, async () => { roleBlockedCommandRan = true; });
    assert.equal(roleBlockedCommandRan, false);
    assert.match(blockedByRoles.replies[0].content, /Security settings could not be read/);
  } finally {
    Module._load = originalLoad;
    process.chdir(previousCwd);
    if (previousKey === undefined) delete process.env.SETTINGS_KEY;
    else process.env.SETTINGS_KEY = previousKey;
    for (const name of modulePaths) delete require.cache[require.resolve(name)];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('/cmd executes the registered shortcut and returns literal argument output', async () => {
  const previousCwd = process.cwd();
  const previousKey = process.env.SETTINGS_KEY;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanwan-cmd-command-'));
  const originalLoad = Module._load;
  const modulePaths = ['../commands/cmd', '../utils/registry', '../utils/permissions', '../utils/storage', '../utils/logger'];
  try {
    process.chdir(dir);
    process.env.SETTINGS_KEY = crypto.generateKey();
    for (const name of modulePaths) delete require.cache[require.resolve(name)];
    const chain = () => new Proxy({}, {
      get(_target, property) {
        if (property === 'then') return undefined;
        return (...args) => {
          for (const arg of args) if (typeof arg === 'function') arg(chain());
          return chain();
        };
      }
    });
    Module._load = function (request, parent, isMain) {
      if (request === 'discord.js') return { SlashCommandBuilder: class { constructor() { return chain(); } } };
      return originalLoad.call(this, request, parent, isMain);
    };
    const registry = require('../utils/registry');
    const cmd = require('../commands/cmd');
    registry.addAllowedCommand({
      id: 'echo', name: 'echo', type: 'shell', enabled: true,
      filepath: process.execPath,
      command: `${process.execPath} -e "process.stdout.write(process.argv[1])" {value}`
    });
    const response = { deferred: false, replied: false, content: null };
    const interaction = {
      user: { tag: 'Tester' },
      options: { getString: name => ({ shortcut: 'echo', value: 'literal; harmless' })[name] ?? null },
      deferReply: async () => { response.deferred = true; },
      editReply: async message => { response.content = message; }
    };
    await cmd.run(interaction);
    assert.match(response.content, /literal; harmless/);
    registry.updateAllowedCommand('echo', { enabled: false });
    await cmd.run(interaction);
    assert.match(response.content, /not registered or has been disabled/);
  } finally {
    Module._load = originalLoad;
    process.chdir(previousCwd);
    if (previousKey === undefined) delete process.env.SETTINGS_KEY;
    else process.env.SETTINGS_KEY = previousKey;
    for (const name of modulePaths) delete require.cache[require.resolve(name)];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
