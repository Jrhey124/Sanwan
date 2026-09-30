# Sanwan Project Status

This file records the current implementation state. It replaces the original scaffold checklist, which described several commands and integrations that were never implemented.

## Implemented

- Discord bot startup, dynamic slash-command discovery, command deployment, per-user FIFO dispatch, registry gates, and role-based permissions.
- `/help`, `/ping`, `/task`, `/note`, `/schedule`, `/cmd`, `/logs`, and `/systeminfo` commands.
- JSON storage for task and schedule records; AES-256-GCM encrypted settings, notes, and command registries.
- Registered shell shortcuts executed as child processes without an implicit shell. Scheduled actions can invoke enabled registered shortcuts.
- Cron schedules, execution history, and task reminders through `daemon.js`.
- GitHub polling and signed webhook event handling.
- File logging and OS-specific service artifact generation.

## Not implemented

- `/ask` AI assistant and AI provider integration.
- `/deploy` command. Deployment service records collected by setup are stored metadata only; they are not executed.
- `/task sync` issue-tracker integration. The command currently returns a placeholder response.
- Automatic service installation or operation. Setup can create service artifacts and show platform commands; an operator must follow the instructions.

## Verification

- `npm test` runs focused logic tests using Node's built-in test runner.
- `npm run test:diagnostics` checks local configuration and command wiring without making Discord or GitHub connections.
- Live Discord login, slash-command deployment, notifications, and GitHub delivery need valid service credentials and a configured test environment.
