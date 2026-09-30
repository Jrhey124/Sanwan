'use strict';

// SQLite-backed envelope storage. Node 22+ provides the synchronous SQLite API;
// the application encrypts payloads before they are written to this database.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { encryptObject, decryptObject } = require('./crypto');

class SqliteStore {
  constructor(filename = process.env.SQLITE_PATH || './data/sanwan.sqlite') {
    this.filename = path.resolve(filename);
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    this.db = new DatabaseSync(this.filename);
    this.db.exec(`CREATE TABLE IF NOT EXISTS encrypted_records (
      record_key TEXT PRIMARY KEY,
      envelope TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
  }

  read(key, defaultValue = null) {
    const row = this.db.prepare('SELECT envelope FROM encrypted_records WHERE record_key = ?').get(key);
    return row ? decryptObject(row.envelope) : defaultValue;
  }

  has(key) {
    return Boolean(this.db.prepare('SELECT 1 AS present FROM encrypted_records WHERE record_key = ?').get(key));
  }

  write(key, value) {
    const envelope = encryptObject(value);
    this.db.prepare(`INSERT INTO encrypted_records(record_key, envelope, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(record_key) DO UPDATE SET envelope=excluded.envelope, updated_at=excluded.updated_at`)
      .run(key, envelope);
    return true;
  }

  delete(key) {
    return this.db.prepare('DELETE FROM encrypted_records WHERE record_key = ?').run(key).changes > 0;
  }

  close() { this.db.close(); }
}

module.exports = SqliteStore;
