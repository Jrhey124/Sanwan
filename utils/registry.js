/**
 * utils/registry.js
 *
 * Multi-record encrypted registries for Sanwan.
 *
 * ── Three registries ─────────────────────────────────────────────────────────
 *
 *  1. allowedCommands   — which /cmd functions this device may run
 *  2. logSources        — named log files/paths the bot can read
 *  3. deployServices    — services the /deploy command can manage
 *
 * All three are stored together inside a single encrypted file:
 *   data/registry.enc   (AES-256-GCM, SETTINGS_KEY)
 *
 * ── Registry record shapes ───────────────────────────────────────────────────
 *
 *  AllowedCommand:
 *    { id: "help", name: "help", description: "Always allowed", enabled: true }
 *
 *  LogSource:
 *    { id: "web", name: "web", path: "/var/log/nginx/access.log",
 *      description: "Nginx access log", enabled: true }
 *
 *  DeployService:
 *    { id: "api", name: "api-server", startCmd: "pm2 start api",
 *      stopCmd: "pm2 stop api", restartCmd: "pm2 restart api",
 *      statusCmd: "pm2 status api", description: "REST API service",
 *      enabled: true }
 *
 * ── Exported API ─────────────────────────────────────────────────────────────
 *
 *  loadRegistry()                            → { allowedCommands, logSources, deployServices }
 *  saveRegistry(data)                        → void
 *
 *  -- AllowedCommands --
 *  listAllowedCommands()                     → AllowedCommand[]
 *  addAllowedCommand(record)                 → AllowedCommand
 *  updateAllowedCommand(id, updates)         → AllowedCommand | null
 *  removeAllowedCommand(id)                  → boolean
 *  isCommandAllowed(name)                    → boolean
 *
 *  -- LogSources --
 *  listLogSources()                          → LogSource[]
 *  addLogSource(record)                      → LogSource
 *  updateLogSource(id, updates)              → LogSource | null
 *  removeLogSource(id)                       → boolean
 *  findLogSource(nameOrId)                   → LogSource | null
 *
 *  -- DeployServices --
 *  listDeployServices()                      → DeployService[]
 *  addDeployService(record)                  → DeployService
 *  updateDeployService(id, updates)          → DeployService | null
 *  removeDeployService(id)                   → boolean
 *  findDeployService(nameOrId)               → DeployService | null
 */

'use strict';

const storage = require('./storage');

const REGISTRY_FILE = 'registry.enc';

// ─── Default empty registry ───────────────────────────────────────────────────

function _empty() {
  return {
    allowedCommands: [],
    logSources:      [],
    deployServices:  []
  };
}

// ─── Load / save ─────────────────────────────────────────────────────────────

/**
 * Load the registry from the encrypted file.
 * Returns an empty registry if the file does not exist.
 *
 * @returns {{ allowedCommands: AllowedCommand[], logSources: LogSource[], deployServices: DeployService[] }}
 */
function loadRegistry() {
  if (!process.env.SETTINGS_KEY) return _empty();

  try {
    const data = storage.encryptedRead(REGISTRY_FILE, null);
    if (!data) return _empty();

    // Defensive normalisation — each key must be an array
    return {
      allowedCommands: Array.isArray(data.allowedCommands) ? data.allowedCommands : [],
      logSources:      Array.isArray(data.logSources)      ? data.logSources      : [],
      deployServices:  Array.isArray(data.deployServices)  ? data.deployServices  : []
    };
  } catch (err) {
    console.error('[registry] Could not load registry:', err.message);
    return _empty();
  }
}

/**
 * Persist the entire registry object back to disk (encrypted).
 *
 * @param {{ allowedCommands, logSources, deployServices }} data
 */
function saveRegistry(data) {
  if (!process.env.SETTINGS_KEY) {
    throw new Error('SETTINGS_KEY is required to save the registry.');
  }
  storage.encryptedWrite(REGISTRY_FILE, data);
}

// ─── Generic CRUD helpers (internal) ─────────────────────────────────────────

function _list(key) {
  return loadRegistry()[key];
}

function _add(key, record) {
  const reg  = loadRegistry();
  const list = reg[key];

  // Duplicate ID / name guard
  if (record.id && list.some(r => r.id === record.id)) {
    throw new Error(`Registry [${key}]: entry with id "${record.id}" already exists.`);
  }

  list.push(record);
  saveRegistry(reg);
  return record;
}

function _update(key, id, updates) {
  const reg  = loadRegistry();
  const list = reg[key];
  const idx  = list.findIndex(r => r.id === id);
  if (idx === -1) return null;

  list[idx] = { ...list[idx], ...updates };
  saveRegistry(reg);
  return list[idx];
}

function _remove(key, id) {
  const reg    = loadRegistry();
  const before = reg[key].length;
  reg[key]     = reg[key].filter(r => r.id !== id);
  if (reg[key].length === before) return false;
  saveRegistry(reg);
  return true;
}

function _find(key, nameOrId) {
  const list = loadRegistry()[key];
  return list.find(r => r.id === nameOrId || r.name === nameOrId) ?? null;
}

// ─── AllowedCommands ─────────────────────────────────────────────────────────

/** List all allowed-command records. */
function listAllowedCommands() {
  return _list('allowedCommands');
}

/**
 * Add a new allowed-command record.
 * All fields from the caller's record are preserved so that shell-type
 * entries retain their filepath, params, command, and type values after
 * the encrypted round-trip through storage.
 *
 * @param {{
 *   id:           string,
 *   name:         string,
 *   description?: string,
 *   enabled?:     boolean,
 *   type?:        'bot' | 'shell',
 *   filepath?:    string,
 *   params?:      string,
 *   command?:     string
 * }} record
 */
function addAllowedCommand(record) {
  const full = {
    // Spread all caller-supplied fields first so nothing is dropped
    ...record,
    // Then normalise the required fields with safe defaults
    id:          record.id          || record.name,
    name:        record.name,
    description: record.description ?? '',
    enabled:     record.enabled     ?? true
  };
  return _add('allowedCommands', full);
}

/**
 * Update an existing allowed-command record by id.
 *
 * @param {string} id
 * @param {{ description?: string, enabled?: boolean }} updates
 */
function updateAllowedCommand(id, updates) {
  return _update('allowedCommands', id, updates);
}

/** Remove an allowed-command record by id. Returns true if removed. */
function removeAllowedCommand(id) {
  return _remove('allowedCommands', id);
}

/**
 * Quick check: is a given command name enabled in the registry?
 *
 * The registry is an EXPLICIT DENY list, not an allowlist.
 * A command with no entry passes through. Only enabled:false explicitly blocks.
 *
 * Rules (applied in order):
 *   1. /help — always allowed, no registry check.
 *   2. /cmd  — allowed whenever at least one enabled shell entry exists,
 *              OR when the registry has no bot-type restrictions at all.
 *   3. Registry is empty — no restrictions configured, everything allowed.
 *   4. Entry exists with enabled === false — explicitly blocked.
 *   5. Entry exists with enabled !== false — allowed.
 *   6. Entry is MISSING — allowed. A missing entry means the owner hasn't
 *      explicitly denied this command, so it passes through.
 *
 * @param {string} name
 * @returns {boolean}
 */
function isCommandAllowed(name) {
  // Rule 1 — /help is unconditionally on
  if (name === 'help') return true;

  const list = listAllowedCommands();

  // Rule 3 — empty registry means no restrictions at all
  if (list.length === 0) return true;

  // Rule 2 — /cmd passes whenever any enabled shell entry exists
  if (name === 'cmd') {
    return list.some(r => r.type === 'shell' && r.enabled !== false);
  }

  // Rules 4, 5, 6 — explicit deny wins; missing entry = allowed
  const entry = list.find(r => r.name === name || r.id === name);
  if (!entry) return true;          // Rule 6: not in list → allowed (explicit deny list)
  return entry.enabled !== false;   // Rule 4/5: respect explicit enabled flag
}

// ─── LogSources ──────────────────────────────────────────────────────────────

/** List all registered log sources. */
function listLogSources() {
  return _list('logSources');
}

/**
 * Register a new log source.
 *
 * @param {{ id: string, name: string, path: string, description?: string, enabled?: boolean }} record
 */
function addLogSource(record) {
  const full = {
    id:          record.id   || record.name,
    name:        record.name,
    path:        record.path,
    description: record.description ?? '',
    enabled:     record.enabled     ?? true
  };
  return _add('logSources', full);
}

/**
 * Update a log source by id.
 *
 * @param {string} id
 * @param {{ path?: string, description?: string, enabled?: boolean }} updates
 */
function updateLogSource(id, updates) {
  return _update('logSources', id, updates);
}

/** Remove a log source by id. */
function removeLogSource(id) {
  return _remove('logSources', id);
}

/** Find a log source by name or id. */
function findLogSource(nameOrId) {
  return _find('logSources', nameOrId);
}

// ─── DeployServices ──────────────────────────────────────────────────────────

/** List all registered deploy services. */
function listDeployServices() {
  return _list('deployServices');
}

/**
 * Register a new deploy service.
 *
 * @param {{
 *   id:           string,
 *   name:         string,
 *   startCmd:     string,
 *   stopCmd:      string,
 *   restartCmd:   string,
 *   statusCmd:    string,
 *   description?: string,
 *   enabled?:     boolean
 * }} record
 */
function addDeployService(record) {
  const full = {
    id:          record.id   || record.name,
    name:        record.name,
    startCmd:    record.startCmd   ?? '',
    stopCmd:     record.stopCmd    ?? '',
    restartCmd:  record.restartCmd ?? '',
    statusCmd:   record.statusCmd  ?? '',
    description: record.description ?? '',
    enabled:     record.enabled     ?? true
  };
  return _add('deployServices', full);
}

/**
 * Update a deploy service by id.
 *
 * @param {string} id
 * @param {Partial<DeployService>} updates
 */
function updateDeployService(id, updates) {
  return _update('deployServices', id, updates);
}

/** Remove a deploy service by id. */
function removeDeployService(id) {
  return _remove('deployServices', id);
}

/** Find a deploy service by name or id. */
function findDeployService(nameOrId) {
  return _find('deployServices', nameOrId);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  // Core
  loadRegistry,
  saveRegistry,

  // AllowedCommands
  listAllowedCommands,
  addAllowedCommand,
  updateAllowedCommand,
  removeAllowedCommand,
  isCommandAllowed,

  // LogSources
  listLogSources,
  addLogSource,
  updateLogSource,
  removeLogSource,
  findLogSource,

  // DeployServices
  listDeployServices,
  addDeployService,
  updateDeployService,
  removeDeployService,
  findDeployService
};
