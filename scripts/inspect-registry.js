#!/usr/bin/env node
/**
 * scripts/inspect-registry.js
 *
 * Diagnostic tool — prints the full decrypted contents of registry.enc
 * and shows exactly what /cmd buildData() would send to Discord.
 *
 * Usage:
 *   node scripts/inspect-registry.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const registry = require('../utils/registry');
const { buildData } = require('../commands/cmd');

// ─── Registry contents ────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════');
console.log('  REGISTRY CONTENTS (decrypted from registry.enc)');
console.log('═══════════════════════════════════════════════════\n');

const data = registry.loadRegistry();

// ── AllowedCommands ─────────────────────────────────────────────────────────
console.log(`AllowedCommands (${data.allowedCommands.length} entries):`);
if (data.allowedCommands.length === 0) {
  console.log('  (empty)');
} else {
  data.allowedCommands.forEach((r, i) => {
    const flag = r.enabled !== false ? '✓' : '✗';
    const type = r.type ? `[${r.type}]` : '[no type]';
    console.log(`  ${i + 1}. ${flag} ${type} id="${r.id}" name="${r.name}"`);
    if (r.filepath) console.log(`       filepath: ${r.filepath}`);
    if (r.params)   console.log(`       params:   ${r.params}`);
    if (r.command)  console.log(`       command:  ${r.command}`);
  });
}

// ── LogSources ──────────────────────────────────────────────────────────────
console.log(`\nLogSources (${data.logSources.length} entries):`);
if (data.logSources.length === 0) {
  console.log('  (empty)');
} else {
  data.logSources.forEach((s, i) => {
    console.log(`  ${i + 1}. id="${s.id}" path="${s.path}"`);
  });
}

// ── DeployServices ───────────────────────────────────────────────────────────
console.log(`\nDeployServices (${data.deployServices.length} entries):`);
if (data.deployServices.length === 0) {
  console.log('  (empty)');
} else {
  data.deployServices.forEach((s, i) => {
    console.log(`  ${i + 1}. id="${s.id}" start="${s.startCmd}"`);
  });
}

// ─── What buildData() would produce ──────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════');
console.log('  /cmd  SLASH COMMAND DEFINITION (buildData output)');
console.log('═══════════════════════════════════════════════════\n');

const cmdData = buildData();
const json    = cmdData.toJSON();

console.log(`Name:        ${json.name}`);
console.log(`Description: ${json.description}`);
console.log(`Options (${json.options?.length ?? 0}):`);

(json.options || []).forEach(opt => {
  console.log(`  - name="${opt.name}" required=${opt.required}`);
  if (opt.choices?.length) {
    console.log(`    choices: ${opt.choices.map(c => c.value).join(', ')}`);
  }
});

// ─── Shell entries specifically ───────────────────────────────────────────────

const shellEntries = data.allowedCommands.filter(r => r.type === 'shell' && r.enabled !== false);
console.log(`\nShell entries (type="shell", enabled): ${shellEntries.length}`);
if (shellEntries.length === 0) {
  console.log('  ⚠ No shell entries found — /cmd will show "(none configured)"');
  console.log('  Run npm run setup → Step 5 to add explicit commands.');
} else {
  shellEntries.forEach(r => {
    console.log(`  - shortcut="${r.id}" filepath="${r.filepath || '(missing!)'}" command="${r.command || '(missing!)'}"`);
  });
}

// ─── isCommandAllowed check ────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════');
console.log('  GATE A CHECK (isCommandAllowed)');
console.log('═══════════════════════════════════════════════════\n');

const toCheck = ['help', 'cmd', 'disks', 'resources', 'task', 'note', 'logs', 'schedule',
                 ...shellEntries.map(r => r.id)];

toCheck.forEach(name => {
  const allowed = registry.isCommandAllowed(name);
  console.log(`  ${allowed ? '✅' : '❌'} isCommandAllowed("${name}") = ${allowed}`);
});

console.log('');
