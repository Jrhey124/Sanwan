#!/usr/bin/env node
/**
 * deploy-commands.js
 *
 * Registers Sanwan slash commands with Discord via the REST API.
 *
 * Usage:
 *   Standalone : node deploy-commands.js
 *   Programmatic: const { deployCommands } = require('./deploy-commands');
 *                 await deployCommands();
 */

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs   = require('fs');
const path = require('path');

// ─── Load commands from commands/ directory ───────────────────────────────────

/**
 * Scan the commands/ directory and return an array of SlashCommandBuilder
 * JSON payloads ready for the REST API.
 *
 * @returns {{ payloads: object[], names: string[] }}
 */
function loadCommandPayloads() {
  const commandsPath = path.join(__dirname, 'commands');

  if (!fs.existsSync(commandsPath)) {
    throw new Error('commands/ directory not found.');
  }

  const payloads = [];
  const names    = [];

  const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

  for (const file of files) {
    try {
      const command = require(path.join(commandsPath, file));

      if (!command.data) {
        console.warn(`  ⚠  ${file}: missing 'data' property (SlashCommandBuilder) — skipped`);
        continue;
      }
      if (!command.name) {
        console.warn(`  ⚠  ${file}: missing 'name' property — skipped`);
        continue;
      }

      payloads.push(command.data.toJSON());
      names.push(command.name);
      console.log(`  ✓  /${command.name}  ${command.description || ''}`);
    } catch (err) {
      console.error(`  ✗  ${file}: ${err.message}`);
    }
  }

  return { payloads, names };
}

// ─── Deploy ───────────────────────────────────────────────────────────────────

/**
 * Deploy all slash commands to the configured Discord guild.
 * Can be called from setup.js or any other module.
 *
 * @returns {Promise<{ deployed: number, names: string[] }>}
 * @throws  on missing env vars or Discord API errors
 */
async function deployCommands() {
  const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

  if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
    throw new Error(
      'Missing required environment variables: DISCORD_TOKEN, CLIENT_ID, GUILD_ID.\n' +
      'Run npm run setup to configure them.'
    );
  }

  console.log('\n  📦 Loading commands…\n');
  const { payloads, names } = loadCommandPayloads();

  if (payloads.length === 0) {
    console.warn('\n  ⚠  No commands to deploy.');
    return { deployed: 0, names: [] };
  }

  console.log(`\n  📊 Deploying ${payloads.length} command(s) to guild ${GUILD_ID}…`);

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

  const data = await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: payloads }
  );

  return { deployed: data.length, names };
}

// ─── Standalone entry point ───────────────────────────────────────────────────

if (require.main === module) {
  deployCommands()
    .then(({ deployed, names }) => {
      console.log(`\n  ✅ Successfully deployed ${deployed} command(s): ${names.join(', ')}`);
      console.log('  💡 Commands appear in Discord immediately.');
      console.log('     If not visible: Ctrl+R in Discord, or check bot scopes.\n');
    })
    .catch(err => {
      console.error('\n  ❌ Deployment failed!');
      if      (err.code === 50001)              console.error('  Missing access: bot may not be in the guild.');
      else if (err.code === 'ERR_REQUEST_FAILED') console.error('  Network error: check your internet connection.');
      else if (err.rawError)                    console.error('  Discord API:', err.rawError.message);
      else                                      console.error(' ', err.message);
      process.exit(1);
    });
}

module.exports = { deployCommands, loadCommandPayloads };
