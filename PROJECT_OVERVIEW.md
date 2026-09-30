# Sanwan Discord ChatOps Bot

Sanwan is a Discord bot for team task tracking, shared notes, log viewing, system information, registered command shortcuts, and scheduled shortcut execution. It is built with Node.js, Discord.js, local JSON files, and an optional daemon process.

## Current commands

- `/help` — show command help and configured permissions.
- `/ping` — check Discord gateway latency.
- `/task` — add, list, update, describe, link, find due, sync, and remove tasks.
- `/note` — create, append, read, update, list, search, remove, push/pop, and export notes.
- `/schedule` — create, list, inspect history, toggle, and remove daemon schedules.
- `/cmd` — run an owner-registered shell shortcut with validated placeholders.
- `/logs` — list and view configured bot log files.
- `/systeminfo` — inspect disk, CPU/memory, and network information.

Commands are discovered from `commands/` when the bot starts. Slash command definitions are deployed with `npm run deploy`.

## Architecture

- `sanwan.js` initializes the Discord client, loads commands, routes interactions through a per-user FIFO queue, applies registry and role permission checks, and starts the configured GitHub integration.
- `commands/` contains the slash command modules.
- `utils/` contains storage, encryption, permissions, command registry, shell execution, date/cron validation, GitHub integration, logging, and OS service helpers.
- `daemon.js` runs enabled cron schedules and task reminders. Schedules invoke registered shell shortcuts; they do not execute arbitrary Discord slash commands.
- `webhook-server.js` runs the optional signed GitHub webhook receiver.
- `data/` contains JSON operational data and AES-256-GCM encrypted settings, notes, and shortcut registries.

## Setup and use

```bash
npm ci
npm run setup
npm test
npm run deploy
npm start
```

`npm run setup` collects configuration, creates required data files, runs diagnostics and the logic test suite, and can optionally deploy commands. Run `npm run daemon` separately to activate schedules and reminders. Use `npm run webhook` only when `GITHUB_MODE=webhook` is configured.

Copy `.env.example` to `.env` or use the setup wizard. Discord token, application ID, and guild ID are needed for live Discord operation. Set `SETTINGS_KEY` to a 64-character hexadecimal key to enable encrypted storage. GitHub integration is optional; supported modes are `none`, `polling`, `polling_pat`, and `webhook`. Webhook mode requires `GITHUB_WEBHOOK_SECRET`.

## Data and security

Plain task and schedule records are stored under `data/tasks/` and `data/schedules/`. Notes and configuration are encrypted at rest. The key must be backed up securely: encrypted files cannot be recovered if the key is lost. Operational files and secrets are excluded from version control.

`/cmd` and scheduled shortcuts run only registered, enabled shell entries. They use argument-based process spawning without an implicit shell, and reject shell-interpreter commands. Register only commands trusted by the bot owner.

## Tests

- `npm test` runs focused automated logic tests with Node's built-in test runner.
- `npm run test:diagnostics` checks environment configuration, files, command modules, and setup wiring. It may create and remove a temporary encrypted data file when `SETTINGS_KEY` is configured.

The automated tests do not connect to Discord or GitHub. Verify live login, command deployment, role permissions, webhook delivery, and notification channels with valid service credentials in a test server.

## Important files

- `SETUP_GUIDE.md` — detailed configuration instructions.
- `QUICK_START.md` — short install and launch guide.
- `data/schemas/README.md` — operational data formats.
- `COMMAND_TEMPLATE.md` — guide for adding a command.
# Deployment architecture

Production is containerized with Docker Compose. `bot` handles Discord events
and `daemon` handles delegated schedules/reminders. Both use the same persistent
SQLite database through `/app/data`; SQLite stores encrypted structured
application state, while logs, exports, and credentials stay outside the
database.
