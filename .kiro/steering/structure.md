# Project Structure

## Top-Level Files

| File | Purpose |
|---|---|
| `sanwan.js` | Main entry point — boots the bot, loads commands, routes interactions |
| `daemon.js` | Standalone daemon — cron scheduling and task deadline reminders |
| `deploy-commands.js` | One-shot script to register slash commands with Discord |
| `webhook-server.js` | Standalone HTTP server for GitHub webhook events |
| `setup.js` | Interactive setup — generates `.env` and initialises encrypted data files |
| `test.js` | Self-test suite (crypto round-trip, storage, etc.) |

## Directories

```
commands/     One file per slash command. Each file exports { name, description, data, run() }.
utils/        Shared singletons and helpers — imported by commands and core files.
data/         All runtime data (JSON and encrypted files). Never committed with real secrets.
  backups/    Timestamped copies created by storage.backup().
  logs/       bot.log, errors.log, commands.log, daemon.log
  notes/      notes.json (plain) — notes content
  schedules/  schedules.json — cron schedule definitions + execution history
  tasks/      tasks.json — task records
  schemas/    JSON schemas for allowedCommands, logSources, deployServices, roleMap
  settings.enc          Encrypted: bot settings + Discord role-permission map
  registry.enc          Encrypted: allowedCommands, logSources, deployServices
.env          Secrets and config (never commit)
```

## Utils (`utils/`)

| File | Role |
|---|---|
| `storage.js` | Singleton data layer — plain JSON CRUD + encrypted read/write |
| `crypto.js` | AES-256-GCM encrypt/decrypt; `encryptObject` / `decryptObject` |
| `logger.js` | Singleton logger — writes to log files and optionally posts errors to Discord |
| `queue.js` | Per-user FIFO command queue; runs Gate A + Gate B before every command |
| `registry.js` | Encrypted registry for allowedCommands, logSources, and deployServices |
| `permissions.js` | Discord role-based permission map stored inside `settings.enc` |
| `os-service.js` | OS detection (`detectPlatform`) for cross-platform service management |
| `github-webhook.js` | GitHub webhook HTTP server factory |
| `github-poller.js` | GitHub polling EventEmitter (commits, issues) |

## Command Architecture

Every file in `commands/` must export:

```js
module.exports = {
  name: 'commandname',        // matches filename (without .js)
  description: '...',
  data: new SlashCommandBuilder()...,  // slash command definition
  async run(interaction) { ... }       // main handler
};
```

Commands are auto-discovered at startup. See `COMMAND_TEMPLATE.md` for full patterns.

## Two-Gate Permission System

Every command passes through `queue.enqueue()`, which enforces:

1. **Gate A** (`registry.isCommandAllowed`) — device-level on/off switch per command, stored in `registry.enc`
2. **Gate B** (`permissions.checkPermission`) — Discord role requirements, stored in `settings.enc`

Implement no permission logic inside `run()` — the queue handles it.

## Data Schemas

- **Task** — `{ tid: "T001", title, assignee, deadline (YYYY-MM-DD), status (open|in_progress|completed), description, linkedIssue, created, updated, createdBy }`
- **Note** — `{ nid: "N001", title, content: string[], tags: string[], created, updated, createdBy }`
- **Schedule** — `{ sid: "S001", name, when (cron expression), command, enabled, notifyChannel }`

IDs are auto-generated via `storage.getNextId(file, prefix)` — e.g. `T001`, `N001`, `S001`.

## Conventions

- Always call `storage.initializeIfMissing()` at the top of `run()` for commands that own a data file.
- Log command success with `logger.command(name, user.tag, true, metadata)`.
- Reply with `ephemeral: true` for errors and sensitive output; `ephemeral: false` for shared results.
- Use `interaction.deferReply()` before any async work that might exceed Discord's 3-second reply window.
- Errors in `run()` must be caught and replied to the user with `❌ Error: <message>` (ephemeral).
- Use `storage.encryptedRead` / `encryptedWrite` for any file that contains sensitive data.
