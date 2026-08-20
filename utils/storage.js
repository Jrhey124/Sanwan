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

class Storage {
  constructor(dataDir = './data') {
    this.dataDir = path.resolve(dataDir);

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  // ─── Internal helpers ────────────────────────────────────────────────────

  /** Resolve a relative filename against the data directory. */
  getPath(filename) {
    return path.join(this.dataDir, filename);
  }

  /** Ensure the directory tree for a file path exists. */
  _ensureDir(filepath) {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // ─── Plain JSON read / write ──────────────────────────────────────────────

  /**
   * Read and parse a plain JSON file.
   * Returns defaultValue if the file does not exist.
   */
  read(filename, defaultValue = null) {
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
    const filepath = this.getPath(filename);
    this._ensureDir(filepath);

    try {
      fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
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
    const filepath = this.getPath(filename);
    this._ensureDir(filepath);

    try {
      const envelope = encryptObject(data);
      fs.writeFileSync(filepath, envelope, 'utf8');
      return true;
    } catch (err) {
      logger.error(`storage.encryptedWrite failed for "${filename}"`, { error: err.message });
      return false;
    }
  }

  // ─── Initialisation helpers ───────────────────────────────────────────────

  /**
   * Write defaultData to a plain file only if it does not already exist.
   */
  initializeIfMissing(filename, defaultData) {
    if (!fs.existsSync(this.getPath(filename))) {
      this.write(filename, defaultData);
      logger.info(`Initialized "${filename}" with default data`);
    }
  }

  /**
   * Write defaultData to an encrypted file only if it does not already exist.
   */
  initializeEncryptedIfMissing(filename, defaultData) {
    if (!fs.existsSync(this.getPath(filename))) {
      this.encryptedWrite(filename, defaultData);
      logger.info(`Initialized encrypted "${filename}" with default data`);
    }
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
    this.write(filename, data);
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
