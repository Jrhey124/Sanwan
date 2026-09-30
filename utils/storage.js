/**
 * utils/storage.js
 *
 * File-based JSON storage for Sanwan.
 *
 * Plain files  → read() / write()
 * Encrypted files → encryptedRead() / encryptedWrite()
 *   Encrypted files are stored as opaque AES-256-GCM envelopes on disk.
 *   Callers receive/supply plain JavaScript objects — encryption is transparent.
 *
 * All other helpers (append, updateById, etc.) work on plain files.
 * Pass the file through encryptedRead/encryptedWrite directly when you need
 * encryption on structured data (notes, settings).
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const logger = require('./logger');
const { encryptObject, decryptObject } = require('./crypto');
const SqliteStore = require('./sqlite-store');

class Storage {
  constructor(dataDir = './data') {
    this.dataDir = path.resolve(dataDir);
    // SQLite is the production default. Tests may explicitly set SQLITE_STORAGE=0.
    this.sqlite = process.env.SQLITE_STORAGE !== '0'
      ? new SqliteStore(process.env.SQLITE_PATH || path.join(this.dataDir, 'sanwan.sqlite'))
      : null;

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (this.sqlite) this._migrateLegacyRecords();
  }

  _migrateLegacyRecords() {
    const records = [
      ['notes/notes.json', false],
      ['tasks/tasks.json', false],
      ['schedules/schedules.json', false],
      ['registry.enc', true],
      ['settings.enc', true],
      ['permissions.enc', true]
    ];
    for (const [filename, encrypted] of records) {
      if (this.sqlite.has(filename)) continue;
      const filepath = this.getPath(filename);
      if (!fs.existsSync(filepath)) continue;
      try {
        const value = encrypted
          ? decryptObject(fs.readFileSync(filepath, 'utf8'))
          : JSON.parse(fs.readFileSync(filepath, 'utf8'));
        this.sqlite.write(filename, value);
        logger.info(`Migrated legacy storage record "${filename}" to SQLite`);
      } catch (err) {
        logger.error(`Could not migrate legacy record "${filename}"`, { error: err.message });
        throw err;
      }
    }
  }

  // ─── Internal helpers ────────────────────────────────────────────────────

  /** Resolve a relative filename against the data directory. */
  getPath(filename) {
    const filepath = path.resolve(this.dataDir, filename);
    const relative = path.relative(this.dataDir, filepath);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Storage path escapes the data directory: "${filename}".`);
    }
    return filepath;
  }

  /** Ensure the directory tree for a file path exists. */
  _ensureDir(filepath) {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /** Replace a file atomically so a crash cannot leave truncated JSON data. */
  _atomicWrite(filepath, contents) {
    this._ensureDir(filepath);
    const temporary = `${filepath}.${process.pid}.${require('crypto').randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temporary, contents, { encoding: 'utf8', flag: 'wx' });
      fs.renameSync(temporary, filepath);
    } catch (err) {
      try { fs.unlinkSync(temporary); } catch { /* no temporary file to clean up */ }
      throw err;
    }
  }

  // ─── Plain JSON read / write ──────────────────────────────────────────────

  /**
   * Read and parse a plain JSON file.
   * Returns defaultValue if the file does not exist.
   */
  read(filename, defaultValue = null) {
    if (this.sqlite && this._isStructuredRecord(filename)) return this.sqlite.read(filename, defaultValue);
    const filepath = this.getPath(filename);

    if (!fs.existsSync(filepath)) return defaultValue;

    try {
      return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    } catch (err) {
      logger.error(`storage.read failed for "${filename}"`, { error: err.message });
      return defaultValue;
    }
  }

  /**
   * Serialise data and write it to a plain JSON file.
   * Returns true on success, false on failure.
   */
  write(filename, data) {
    if (this.sqlite && this._isStructuredRecord(filename)) return this.sqlite.write(filename, data);
    const filepath = this.getPath(filename);
    try {
      this._atomicWrite(filepath, JSON.stringify(data, null, 2));
      return true;
    } catch (err) {
      logger.error(`storage.write failed for "${filename}"`, { error: err.message });
      return false;
    }
  }

  // ─── Encrypted JSON read / write ─────────────────────────────────────────

  /**
   * Read an encrypted file and return the decrypted object.
   * Returns defaultValue when the file does not exist.
   * Throws if decryption fails (bad key, tampered data).
   *
   * Use this for notes, settings, and any file that must be encrypted at rest.
   */
  encryptedRead(filename, defaultValue = null) {
    if (this.sqlite && this._isEncryptedRecord(filename)) {
      return this.sqlite.read(filename, defaultValue);
    }
    const filepath = this.getPath(filename);

    // File simply doesn't exist yet — return default silently, no error logged.
    if (!fs.existsSync(filepath)) return defaultValue;

    try {
      const envelope = fs.readFileSync(filepath, 'utf8');
      return decryptObject(envelope);
    } catch (err) {
      // Classify the error so callers and the log give actionable information.
      const isAuthFailure =
        err.message.includes('Unsupported state or unable to authenticate data') ||
        err.message.includes('bad decrypt') ||
        err.message.includes('wrong final block length');

      if (isAuthFailure) {
        const hint =
          `"${filename}" was encrypted with a different SETTINGS_KEY.\n` +
          `  Fix: delete data/${filename} and re-run setup, OR restore the ` +
          `original SETTINGS_KEY in .env.`;
        logger.error(`storage.encryptedRead: key mismatch for "${filename}"`, { hint });
        const keyErr = new Error(
          `Key mismatch — "${filename}" cannot be decrypted with the current SETTINGS_KEY. ` +
          `Delete data/${filename} and re-run setup to reset it.`
        );
        keyErr.code = 'ERR_KEY_MISMATCH';
        throw keyErr;
      }

      // Any other error (corrupted file, wrong format, etc.)
      logger.error(`storage.encryptedRead failed for "${filename}"`, { error: err.message });
      throw err;
    }
  }

  /**
   * Encrypt data and write it to a file.
   * The file on disk contains only the opaque AES-256-GCM envelope.
   * Returns true on success, false on failure.
   */
  encryptedWrite(filename, data) {
    if (this.sqlite && this._isEncryptedRecord(filename)) {
      return this.sqlite.write(filename, data);
    }
    const filepath = this.getPath(filename);
    try {
      const envelope = encryptObject(data);
      this._atomicWrite(filepath, envelope);
      return true;
    } catch (err) {
      logger.error(`storage.encryptedWrite failed for "${filename}"`, { error: err.message });
      return false;
    }
  }

  _isStructuredRecord(filename) {
    return ['notes/notes.json', 'tasks/tasks.json', 'schedules/schedules.json', 'daemon/history.json'].includes(filename);
  }

  _isEncryptedRecord(filename) {
    return ['registry.enc', 'settings.enc', 'permissions.enc'].includes(filename);
  }

  // ─── Initialisation helpers ───────────────────────────────────────────────

  /**
   * Write defaultData to a plain file only if it does not already exist.
   */
  initializeIfMissing(filename, defaultData) {
    if (this.sqlite && this._isStructuredRecord(filename)) {
      if (!this.sqlite.has(filename)) this.sqlite.write(filename, defaultData);
      return true;
    }
    if (!fs.existsSync(this.getPath(filename))) {
      if (!this.write(filename, defaultData)) {
        throw new Error(`Could not initialize "${filename}".`);
      }
      logger.info(`Initialized "${filename}" with default data`);
    }
    return true;
  }

  /**
   * Write defaultData to an encrypted file only if it does not already exist.
   */
  initializeEncryptedIfMissing(filename, defaultData) {
    if (this.sqlite && this._isEncryptedRecord(filename)) {
      if (!this.sqlite.has(filename)) this.sqlite.write(filename, defaultData);
      return true;
    }
    if (!fs.existsSync(this.getPath(filename))) {
      if (!this.encryptedWrite(filename, defaultData)) {
        throw new Error(`Could not initialize encrypted file "${filename}".`);
      }
      logger.info(`Initialized encrypted "${filename}" with default data`);
    }
    return true;
  }

  // ─── Array helpers (plain files only) ─────────────────────────────────────

  /** Append item to an array key inside a JSON file. */
  append(filename, item, arrayKey = 'items') {
    const data = this.read(filename, { [arrayKey]: [] });
    if (!Array.isArray(data[arrayKey])) data[arrayKey] = [];
    data[arrayKey].push(item);
    return this.write(filename, data);
  }

  /** Update a single item in an array by its ID field. */
  updateById(filename, id, updates, arrayKey = 'items', idKey = 'id') {
    const data = this.read(filename, { [arrayKey]: [] });
    if (!Array.isArray(data[arrayKey])) return false;

    const idx = data[arrayKey].findIndex(item => item[idKey] === id);
    if (idx === -1) return false;

    data[arrayKey][idx] = { ...data[arrayKey][idx], ...updates };
    return this.write(filename, data);
  }

  /** Remove a single item from an array by its ID field. */
  removeById(filename, id, arrayKey = 'items', idKey = 'id') {
    const data = this.read(filename, { [arrayKey]: [] });
    if (!Array.isArray(data[arrayKey])) return false;

    const before = data[arrayKey].length;
    data[arrayKey] = data[arrayKey].filter(item => item[idKey] !== id);
    if (data[arrayKey].length === before) return false; // nothing removed

    return this.write(filename, data);
  }

  /** Return the item matching id, or null. */
  findById(filename, id, arrayKey = 'items', idKey = 'id') {
    const data = this.read(filename, { [arrayKey]: [] });
    if (!Array.isArray(data[arrayKey])) return null;
    return data[arrayKey].find(item => item[idKey] === id) ?? null;
  }

  /** Return all items from an array key. */
  list(filename, arrayKey = 'items') {
    const data = this.read(filename, { [arrayKey]: [] });
    return Array.isArray(data[arrayKey]) ? data[arrayKey] : [];
  }

  /** Return items where item[field] contains value (case-insensitive). */
  search(filename, field, value, arrayKey = 'items') {
    return this.list(filename, arrayKey).filter(item => {
      const v = item[field];
      return typeof v === 'string'
        ? v.toLowerCase().includes(value.toLowerCase())
        : v === value;
    });
  }

  /**
   * Auto-increment an integer counter inside a file, return the next ID.
   * If prefix is provided returns e.g. "T001"; otherwise returns the raw integer.
   */
  getNextId(filename, prefix = '') {
    const data = this.read(filename, { nextId: 1 });
    const next = data.nextId || 1;
    data.nextId = next + 1;
    if (!this.write(filename, data)) {
      throw new Error(`Could not persist the next ID for "${filename}".`);
    }
    return prefix ? `${prefix}${String(next).padStart(3, '0')}` : next;
  }

  // ─── Backup ────────────────────────────────────────────────────────────────

  /**
   * Copy a file into data/backups/ with a timestamp suffix.
   * Works for both plain and encrypted files (copies bytes as-is).
   */
  backup(filename) {
    const src = this.getPath(filename);
    if (!fs.existsSync(src)) return false;

    try {
      const backupDir = path.join(this.dataDir, 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const dest  = path.join(backupDir, `${path.basename(filename, '.json')}_${stamp}.json`);
      fs.copyFileSync(src, dest);
      logger.info(`Backed up "${filename}" → "${path.basename(dest)}"`);
      return true;
    } catch (err) {
      logger.error(`storage.backup failed for "${filename}"`, { error: err.message });
      return false;
    }
  }
}

// Singleton — the whole bot shares one storage instance
const storage = new Storage();

module.exports = storage;
module.exports.Storage = Storage;
