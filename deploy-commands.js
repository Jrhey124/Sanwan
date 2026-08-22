#!/usr/bin/env node
/**
 * deploy-commands.js
 *
 * Registers Sanwan slash commands with Discord via the REST API.
 *
 * What it does
 * ────────────
 *  1. Scans commands/ for every file that exports { data, name, run }.
 *  2. For cmd.js specifically, calls buildData() so the choice list
 *     reflects the current registry (after dotenv is loaded).
 *  3. Sends all payloads to Discord via PUT applicationGuildCommands.
 *  4. Cross-checks: every allowed command in the registry should have a
 *     deployed slash command.  Logs a warning for any gap.
 *
 * Usage
 * ─────
 *   Standalone   :  node deploy-commands.js
 *   Programmatic :  const { deployCommands } = require('./deploy-commands');
 *                   await deployCommands();
 */

'use strict';

require('dotenv').config();

const { REST, Routes } = require('discord.js');
const fs   = require('fs');
const path = require('path');

// ─── Load commands from commands/ directory ───────────────────────────────────

/**
 * Scan commands/ and return the REST-ready JSON payloads plus a name list.
 *
 * Special case: cmd.js exports buildData() so its slash-command definition
 * can be rebuilt here, after dotenv is loaded, to pick up the current
 * registry state (shell command shortcuts become Discord choices).
 *
 * @returns {{ payloads: object[], names: string[] }}
 */
function loadCommandPayloads() {
  const commandsDir = path.join(__dirname, 'commands');

  if (!fs.existsSync(commandsDir)) {
    throw new Error('commands/ directory not found.');
  }

  const payloads = [];
  const names    = [];

  const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));

  for (const file of files) {
    try {
      const fullPath = path.join(commandsDir, file);

      // Clear the require cache for every command file so this script always
      // reads the current state on disk — critical for cmd.js which builds
      // its slash command choices from the encrypted registry at load time.
      delete require.cache[require.resolve(fullPath)];

      const mod = require(fullPath);

      if (!mod.name) {
        console.warn(`  ⚠  ${file}: missing 'name' — skipped`);
        continue;
      }

      // cmd.js: rebuild data() now that dotenv is loaded so shell-command
      // choices from the encrypted registry are included.
      const builder = (mod.buildData && typeof mod.buildData === 'function')
        ? mod.buildData()
        : mod.data;

      if (!builder) {
        console.warn(`  ⚠  ${file}: missing 'data' property (SlashCommandBuilder) — skipped`);
        continue;
      }

      payloads.push(builder.toJSON());
      names.push(mod.name);
      console.log(`  ✓  /${mod.name.padEnd(14)} ${mod.description || ''}`);

    } catch (err) {
      console.error(`  ✗  ${file}: ${err.message}`);
    }
  }

  return { payloads, names };
}

// ─── Cross-check registry vs deployed names ───────────────────────────────────

/**
 * Compare the registry's allowed-commands list against the names that were
 * loaded.  Log a warning for every entry that has no corresponding command
 * file so the operator knows something is out of sync.
 *
 * Shell-type entries are expected to be handled by cmd.js, so we check
 * that 'cmd' was deployed whenever any shell entries exist.
 *
 * @param {string[]} deployedNames
 */
function crossCheckRegistry(deployedNames) {
  // registry.js may throw if SETTINGS_KEY is unset — wrap defensively
  let allowed = [];
  try {
    const registry = require('./utils/registry');
    allowed = registry.listAllowedCommands();
  } catch {
    // No registry or no key — nothing to check
    return;
  }

  if (allowed.length === 0) return;

  const deployedSet = new Set(deployedNames);
  const shellCount  = allowed.filter(r => r.type === 'shell' && r.enabled !== false).length;

  for (const entry of allowed) {
    if (entry.type === 'shell') {
      // Shell shortcuts live inside /cmd — warn once if cmd itself is missing
      if (shellCount > 0 && !deployedSet.has('cmd')) {
        console.warn(
          `  ⚠  registry has ${shellCount} shell command(s) but /cmd was not deployed.` +
          `  Check commands/cmd.js exports a valid 'data' property.`
        );
      }
      continue;
    }

    // Bot-type entry — should have its own command file
    if (!deployedSet.has(entry.name)) {
      console.warn(
        `  ⚠  registry allows '${entry.name}' but no matching command was deployed.` +
        `  Create commands/${entry.name}.js or remove it from the registry.`
      );
    }
  }
}

// ─── Deploy ───────────────────────────────────────────────────────────────────

/**
 * Build payloads, run the cross-check, then PUT to Discord.
 *
 * @returns {Promise<{ deployed: number, names: string[] }>}
 */
async function deployCommands() {
  const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

  if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
    throw new Error(
      'Missing: DISCORD_TOKEN, CLIENT_ID, GUILD_ID.\n' +
      'Run  npm run setup  to configure them.'
    );
  }

  console.log('\n  📦 Loading commands…\n');
  const { payloads, names } = loadCommandPayloads();

  // Cross-check after loading so we have the full deployed name list
  crossCheckRegistry(names);

  if (payloads.length === 0) {
    console.warn('\n  ⚠  No commands to deploy.');
    return { deployed: 0, names: [] };
  }

  console.log(`\n  📡 Deploying ${payloads.length} command(s) to Discord guild ${GUILD_ID}…`);

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

  // ── Step 1: flush any global (non-guild) application commands ───────────
  // Global commands persist independently of guild commands and can cause
  // duplicate entries in the command list.  Clear them first.
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    console.log('  🧹 Global commands cleared.');
  } catch {
    // Non-fatal — may not have global commands, or may lack permission
  }

  // ── Step 2: replace guild commands atomically ────────────────────────────
  // PUT with a full body replaces ALL guild commands in one request.
  // This is already an atomic flush — no separate DELETE step needed.
  const data = await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: payloads }
  );

  console.log(`  ✅ Guild commands replaced: ${data.map(c => '/' + c.name).join(', ')}`);

  return { deployed: data.length, names };
}

// ─── Standalone entry point ───────────────────────────────────────────────────

if (require.main === module) {
  deployCommands()
    .then(({ deployed, names }) => {
      console.log(`\n  ✅ Deployed ${deployed} command(s): ${names.join(', ')}`);
      console.log('  💡 Commands appear in Discord immediately (Ctrl+R if not visible).\n');
    })
    .catch(err => {
      console.error('\n  ❌ Deployment failed.');
      if      (err.code === 50001)               console.error('     Missing access — bot may not be in this guild.');
      else if (err.code === 'ERR_REQUEST_FAILED') console.error('     Network error — check your connection.');
      else if (err.rawError)                     console.error('     Discord API:', err.rawError.message);
      else                                       console.error('    ', err.message);
      process.exit(1);
    });
}

module.exports = { deployCommands, loadCommandPayloads };
