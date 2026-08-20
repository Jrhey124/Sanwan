/**
 * utils/crypto.js
 *
 * AES-256-GCM encryption / decryption for Sanwan.
 *
 * Every encrypted blob is stored as a JSON string with three fields:
 *   { iv: <hex>, tag: <hex>, data: <hex> }
 *
 * The key comes from SETTINGS_KEY in .env (64 hex chars = 32 bytes).
 * If the key is missing or malformed, every operation throws clearly
 * so the caller (storage, setup) can surface the problem.
 */

'use strict';

const nodeCrypto = require('crypto');

// ─── Key resolution ──────────────────────────────────────────────────────────

/**
 * Return the 32-byte Buffer key from the environment.
 * Throws a descriptive Error if the key is absent or the wrong length.
 */
function resolveKey() {
  const raw = process.env.SETTINGS_KEY;

  if (!raw || raw.trim() === '') {
    throw new Error(
      'SETTINGS_KEY is not set in .env. ' +
      'Run `npm run setup` to generate one.'
    );
  }

  const trimmed = raw.trim();

  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error(
      'SETTINGS_KEY must be exactly 64 hex characters (32 bytes). ' +
      'Re-run `npm run setup` to regenerate a valid key.'
    );
  }

  return Buffer.from(trimmed, 'hex');
}

// ─── Core operations ─────────────────────────────────────────────────────────

/**
 * Encrypt a plain-text string.
 * Returns a JSON string that can be written directly to a file.
 *
 * @param {string} plaintext
 * @returns {string}  JSON envelope: { iv, tag, data } – all hex
 */
function encrypt(plaintext) {
  if (typeof plaintext !== 'string') {
    throw new TypeError('encrypt() expects a string.');
  }

  const key = resolveKey();
  const iv  = nodeCrypto.randomBytes(12); // 96-bit IV — recommended for GCM

  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag(); // 16-byte GCM auth tag

  return JSON.stringify({
    iv:   iv.toString('hex'),
    tag:  tag.toString('hex'),
    data: encrypted.toString('hex')
  });
}

/**
 * Decrypt a JSON envelope produced by encrypt().
 * Returns the original plain-text string.
 *
 * @param {string} envelope  JSON string: { iv, tag, data }
 * @returns {string}
 */
function decrypt(envelope) {
  if (typeof envelope !== 'string') {
    throw new TypeError('decrypt() expects a string envelope.');
  }

  let parsed;
  try {
    parsed = JSON.parse(envelope);
  } catch {
    throw new Error('decrypt() received an invalid (non-JSON) envelope.');
  }

  const { iv, tag, data } = parsed;
  if (!iv || !tag || !data) {
    throw new Error(
      'decrypt() envelope is missing required fields (iv, tag, data).'
    );
  }

  const key = resolveKey();

  const decipher = nodeCrypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tag, 'hex'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(data, 'hex')),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}

// ─── Convenience: object helpers ─────────────────────────────────────────────

/**
 * Encrypt a JSON-serialisable object.
 * Internally stringifies then encrypts.
 *
 * @param {object} obj
 * @returns {string}  encrypted envelope
 */
function encryptObject(obj) {
  return encrypt(JSON.stringify(obj));
}

/**
 * Decrypt an envelope and parse the result back to an object.
 *
 * @param {string} envelope
 * @returns {object}
 */
function decryptObject(envelope) {
  return JSON.parse(decrypt(envelope));
}

// ─── Key generation helper (used by setup.js) ─────────────────────────────────

/**
 * Generate a fresh 64-hex-char (32-byte) key suitable for SETTINGS_KEY.
 *
 * @returns {string}
 */
function generateKey() {
  return nodeCrypto.randomBytes(32).toString('hex');
}

// ─── Self-test (used by test.js) ──────────────────────────────────────────────

/**
 * Quick sanity-check round-trip.
 * Returns true on success, throws on any failure.
 *
 * @returns {boolean}
 */
function selfTest() {
  const sample = 'Sanwan crypto self-test 🔐';
  const envelope = encrypt(sample);
  const recovered = decrypt(envelope);

  if (recovered !== sample) {
    throw new Error(
      `Crypto round-trip mismatch.\n` +
      `  Expected: ${sample}\n` +
      `  Got:      ${recovered}`
    );
  }

  // Verify envelope structure
  const parsed = JSON.parse(envelope);
  if (!parsed.iv || !parsed.tag || !parsed.data) {
    throw new Error('Crypto envelope missing expected fields.');
  }

  return true;
}

module.exports = {
  encrypt,
  decrypt,
  encryptObject,
  decryptObject,
  generateKey,
  selfTest
};
