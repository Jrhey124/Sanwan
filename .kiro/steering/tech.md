# Tech Stack

## Runtime & Language

- **Node.js** ≥ 18.0.0
- Plain JavaScript (`'use strict'`, CommonJS `require/module.exports`)
- No TypeScript, no transpiler, no bundler

## Key Dependencies

| Package | Purpose |
|---|---|
| `discord.js` v14 | Discord API client, slash commands, embeds |
| `dotenv` | Loads `.env` into `process.env` at startup |
| `cron` | Cron job scheduling in the daemon |

No database. All persistence is flat-file JSON or AES-256-GCM encrypted files on disk.

## Environment Variables (`.env`)

Required:
- `DISCORD_TOKEN` — bot token
- `CLIENT_ID` — Discord application ID
- `GUILD_ID` — target Discord server ID
- `SETTINGS_KEY` — 64 hex-char (32-byte) AES key for encrypted files

Optional:
- `SETTINGS_PATH` — path to settings file (default `./data/settings.enc`)
- `GITHUB_MODE` — `none` | `webhook` | `polling` | `polling_pat`
- `GITHUB_WEBHOOK_SECRET`, `GITHUB_WEBHOOK_PORT`, `GITHUB_REPO`, `GITHUB_PAT`, `GITHUB_POLL_INTERVAL`
- `AI_PROVIDER`, `AI_TOKEN`, `AI_MODEL` — for `/ask` command

## Common Commands

```bash
# First-time setup — generates .env and encrypts initial data files
npm run setup

# Register slash commands with Discord (run after adding/renaming commands)
npm run deploy

# Start the bot
npm start

# Start the daemon (cron jobs + task reminders, separate process)
npm run daemon

# Start the GitHub webhook HTTP server (if GITHUB_MODE=webhook)
npm run webhook

# Run the self-test suite
npm test
```

## Encryption

All sensitive files (settings, notes, registry) use AES-256-GCM via `utils/crypto.js`. The key comes from `SETTINGS_KEY`. Encrypted files store a JSON envelope `{ iv, tag, data }` (all hex). Never store sensitive data in plain JSON files.
