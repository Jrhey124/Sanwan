/**
 * utils/permissions.js
 *
 * Role-based permission system for Sanwan.
 *
 * ── Concepts ────────────────────────────────────────────────────────────────
 *
 *  roleMap  (encrypted at rest, stored inside settings.enc)
 *  ────────
 *  A plain object keyed by Discord command name.
 *  Each entry describes who may run that command:
 *
 *    {
 *      "deploy": {
 *        "requiredRoles": ["1234567890", "9876543210"],  // Discord role IDs
 *        "requireAll":    false,   // false = any one role suffices
 *        "description":   "Deployment commands — admins only",
 *        "enabled":       true
 *      },
 *      "note": {
 *        "requiredRoles": [],      // empty = everyone
 *        "requireAll":    false,
 *        "description":   "Note management — all members",
 *        "enabled":       true
 *      }
 *    }
 *
 *  Rules (applied in order):
 *    1. /help is ALWAYS allowed — no map lookup performed.
 *    2. If the command has no entry in the roleMap → allowed (open by default).
 *    3. If entry.enabled === false → denied.
 *    4. If entry.requiredRoles is empty → allowed.
 *    5. If requireAll === true → member must have ALL listed roles.
 *       If requireAll === false (default) → member needs ANY one listed role.
 *
 * ── Storage ──────────────────────────────────────────────────────────────────
 *
 *  The roleMap is nested inside the main encrypted settings file:
 *    settings.permissions.roleMap  →  { [commandName]: RoleEntry }
 *
 *  Callers receive/supply the plain roleMap object.
 *  All disk I/O goes through storage.encryptedRead / encryptedWrite so the
 *  actual file on disk is always the opaque AES-256-GCM envelope.
 *
 * ── Exported API ─────────────────────────────────────────────────────────────
 *
 *  loadRoleMap()                         → RoleMap object
 *  saveRoleMap(roleMap)                  → void
 *  checkPermission(commandName, memberRoleIds)  → { allowed, reason }
 *  setCommandRoles(commandName, opts)    → void  (add/update entry)
 *  removeCommandEntry(commandName)       → void
 *  listRoleMap()                         → Array<{ command, ...entry }>
 */

'use strict';

const storage = require('./storage');

// Path within data/ where the encrypted settings live.
// Strips all leading path components that storage already provides
// (storage resolves filenames against its own ./data/ directory).
//
//   ./data/settings.enc  →  settings.enc
//   data/settings.enc    →  settings.enc
//   ./settings.enc       →  settings.enc
const SETTINGS_FILE = () => {
  const raw = process.env.SETTINGS_PATH || './data/settings.enc';
  return raw
    .replace(/^\.\/data\//, '')
    .replace(/^data\//, '')
    .replace(/^\.\//, '');
};

// ─── Load / save ─────────────────────────────────────────────────────────────

/**
 * Load the full settings object (decrypted) and return the permissions.roleMap.
 * If no map exists yet an empty object is returned without creating a file.
 *
 * @returns {Record<string, RoleEntry>}
 */
function loadRoleMap() {
  if (!process.env.SETTINGS_KEY) return {};

  try {
    const settings = storage.encryptedRead(SETTINGS_FILE(), {});
    return settings?.permissions?.roleMap ?? {};
  } catch (err) {
    console.error('[permissions] Could not load roleMap:', err.message);
    return {};
  }
}

/**
 * Merge an updated roleMap back into the settings file and re-encrypt.
 *
 * @param {Record<string, RoleEntry>} roleMap
 */
function saveRoleMap(roleMap) {
  if (!process.env.SETTINGS_KEY) {
    throw new Error('SETTINGS_KEY is required to save role permissions.');
  }

  const settings = storage.encryptedRead(SETTINGS_FILE(), {});

  if (!settings.permissions) settings.permissions = {};
  settings.permissions.roleMap = roleMap;

  storage.encryptedWrite(SETTINGS_FILE(), settings);
}

// ─── Permission check ─────────────────────────────────────────────────────────

/**
 * Determine whether a Discord member may run a given command.
 *
 * @param {string}   commandName    The slash-command name (e.g. "deploy")
 * @param {string[]} memberRoleIds  Array of Discord role ID strings the member holds
 *
 * @returns {{ allowed: boolean, reason: string }}
 */
function checkPermission(commandName, memberRoleIds = []) {
  // Rule 1 — /help is unconditionally allowed
  if (commandName === 'help') {
    return { allowed: true, reason: '/help is always permitted' };
  }

  const roleMap = loadRoleMap();
  const entry   = roleMap[commandName];

  // Rule 2 — not in map → open
  if (!entry) {
    return { allowed: true, reason: 'no restrictions configured for this command' };
  }

  // Rule 3 — disabled
  if (entry.enabled === false) {
    return {
      allowed: false,
      reason:  `/${commandName} is disabled by the owner`
    };
  }

  // Rule 4 — empty required roles → everyone
  const required = Array.isArray(entry.requiredRoles) ? entry.requiredRoles : [];
  if (required.length === 0) {
    return { allowed: true, reason: 'no role restrictions set' };
  }

  // Rule 5 — role check
  const memberSet  = new Set(memberRoleIds);
  const requireAll = entry.requireAll === true;

  const matched = requireAll
    ? required.every(r => memberSet.has(r))
    : required.some(r => memberSet.has(r));

  if (matched) {
    return { allowed: true, reason: 'member holds a required role' };
  }

  return {
    allowed: false,
    reason:  `/${commandName} requires ${requireAll ? 'all of' : 'one of'}: ${required.join(', ')}`
  };
}

// ─── Management helpers ───────────────────────────────────────────────────────

/**
 * Add or update a single command's role entry.
 *
 * @param {string} commandName
 * @param {{
 *   requiredRoles?: string[],
 *   requireAll?:    boolean,
 *   description?:   string,
 *   enabled?:       boolean
 * }} opts
 */
function setCommandRoles(commandName, opts = {}) {
  const roleMap = loadRoleMap();

  roleMap[commandName] = {
    requiredRoles: opts.requiredRoles ?? roleMap[commandName]?.requiredRoles ?? [],
    requireAll:    opts.requireAll    ?? roleMap[commandName]?.requireAll    ?? false,
    description:   opts.description   ?? roleMap[commandName]?.description   ?? '',
    enabled:       opts.enabled       ?? roleMap[commandName]?.enabled       ?? true
  };

  saveRoleMap(roleMap);
}

/**
 * Remove an entry from the roleMap entirely (reverts to open-access default).
 *
 * @param {string} commandName
 */
function removeCommandEntry(commandName) {
  const roleMap = loadRoleMap();
  delete roleMap[commandName];
  saveRoleMap(roleMap);
}

/**
 * Return the roleMap as a flat array for display.
 *
 * @returns {Array<{ command: string, requiredRoles: string[], requireAll: boolean, description: string, enabled: boolean }>}
 */
function listRoleMap() {
  const roleMap = loadRoleMap();
  return Object.entries(roleMap).map(([command, entry]) => ({
    command,
    requiredRoles: entry.requiredRoles ?? [],
    requireAll:    entry.requireAll    ?? false,
    description:   entry.description   ?? '',
    enabled:       entry.enabled       ?? true
  }));
}

module.exports = {
  loadRoleMap,
  saveRoleMap,
  checkPermission,
  setCommandRoles,
  removeCommandEntry,
  listRoleMap
};
