# Sanwan Setup Guide

Sanwan is a Discord ChatOps bot for task tracking, encrypted notes, cron scheduling of registered shell shortcuts, log viewing, system information, and optional GitHub notifications.

## Requirements

- Node.js 18.17 or newer
- A Discord application with a bot token
- A Discord server where you can install the bot

## Install and configure

```bash
npm ci
npm run setup
```

The setup wizard collects credentials, initializes data files, configures shortcut and role registries, and can create OS service artifacts. It can also deploy the slash commands if Discord credentials are present. You can copy `.env.example` to `.env` and configure it manually.

Required for live Discord operation:

```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
GUILD_ID=your_server_id
SETTINGS_KEY=64_hex_characters
```

Use a randomly generated 32-byte key encoded as 64 hexadecimal characters. Keep it backed up and private; encrypted settings and notes cannot be recovered without it. The bot uses the Discord `Guilds` intent and does not require privileged gateway intents.

Invite the bot with the `bot` and `applications.commands` OAuth scopes. It needs permission to view channels, send messages, embed links, attach files, and use application commands in the channels where it operates.

## Run

```bash
npm test
npm run deploy
npm start
```

Run `npm run daemon` in a separate process to activate schedules and deadline reminders. Structured state is stored in `data/sanwan.sqlite`; logs and backups remain filesystem-based. Run `npm run webhook` only when operating the GitHub webhook listener as a separate process.

## Slash commands

- `/help` — list commands or show command help.
- `/ping` — inspect Discord round-trip and websocket latency.
- `/task` — add, list, update, describe, remove, link, and view tasks due within a date range. `/task sync` is currently a placeholder and does not sync with an issue tracker.
- `/note` — insert, append, read, update, list, search, remove, push/pop content, and export notes.
- `/schedule` — create, list, view history, toggle, and remove schedules.
- `/cmd` — execute a registered shell shortcut.
- `/logs` — list and view the bot's log files.
- `/systeminfo` — show disk, CPU/memory, and network information.

Use `/help <command>` in Discord for the live option names and descriptions.

## Registered shell shortcuts and schedules

Shortcuts are configured through the setup wizard and saved in the encrypted command registry. A shortcut has an ID, executable, fixed arguments, and optional named placeholders. `/cmd` and scheduled jobs execute these entries with argument-based process spawning, without an implicit shell. Only enabled registered shell entries can run. Register commands that are trusted by the bot owner.

Create a schedule with a five-field cron expression. The command field contains the shortcut ID and, optionally, a JSON object of placeholder values. For example:

```text
shortcut ID: backup
placeholder: target
schedule command: /cmd backup {"target":"daily"}
cron: 0 2 * * *
```

The daemon must be running, and it must be restarted after schedule changes.

## Optional GitHub integration

Set `GITHUB_MODE` to one of `none`, `polling`, `polling_pat`, or `webhook`.

- `polling` watches a public repository. Set `GITHUB_REPO=owner/repo`. Polling has a 120-second minimum interval for unauthenticated requests.
- `polling_pat` can access private repositories. Set `GITHUB_PAT` and `GITHUB_REPO`.
- `webhook` starts a signed webhook receiver. Set `GITHUB_WEBHOOK_SECRET`; the server refuses to start without it. Configure the same secret in the GitHub repository webhook settings.

Polling starts with the bot. In webhook mode, `npm start` starts the receiver in the bot process; `npm run webhook` runs a separate receiver that logs incoming events.

## Data and logs

- Plain task and schedule records are in `data/tasks/` and `data/schedules/`.
- Settings, notes, permissions, and shortcut registries are encrypted under `data/`.
- Logs are stored in `data/logs/`.
- Backups are stored in `data/backups/`.

The data directory is local to the installation. Back it up regularly and preserve the encryption key. Do not commit `.env`, operational records, or encrypted runtime files to a shared repository.

## Tests and diagnostics

```bash
npm test
npm run test:diagnostics
```

`npm test` runs the automated logic suite without connecting to Discord or GitHub. `npm run test:diagnostics` checks configuration, runtime files, command modules, and setup wiring; it may warn about missing credentials before configuration. The setup wizard runs both after initialization.

Live login, command deployment, role permissions, GitHub delivery, and notification channels still require valid credentials and should be checked in a test Discord server.

## Troubleshooting

- Run `npm test` to check core behavior.
- Run `npm run test:diagnostics` after setup to inspect local configuration.
- If slash commands are missing, verify the application and guild IDs, then run `npm run deploy` again.
- If encrypted files cannot be read, restore the original `SETTINGS_KEY`.
- Review `data/logs/errors.log` for runtime errors.
# Docker is the supported production deployment

The self-hosted deployment uses Node 22 inside Docker. Run the bot and its
scheduler as separate Compose services so restarts and dependency versions are
repeatable. Runtime data is stored in the persistent `sanwan-data` volume and
encrypted before it is written to SQLite.
# Required credentials

Create a local `.env` file from `.env.example` and fill in the following values.
Never commit `.env` or paste these secrets into source files.

## Discord credentials

1. Open the [Discord Developer Portal](https://discord.com/developers/applications)
   and select **New Application** (or open an existing application).
2. On **General Information**, copy **Application ID** into `CLIENT_ID`.
3. Open **Bot**, click **Add Bot** if needed, then use **Reset Token** and copy
   the token into `DISCORD_TOKEN`. Discord only shows the full token when it is
   generated, so store it in `.env` immediately.
4. Invite the bot to your test server using the OAuth2 URL generator with the
   `bot` and `applications.commands` scopes. Enable only the permissions the
   bot needs.
5. In Discord, enable **Developer Mode** under **User Settings → Advanced**.
   Right-click your test server and choose **Copy Server ID**. Put that value in
   `GUILD_ID`.

Example:

```env
DISCORD_TOKEN=replace-with-your-bot-token
CLIENT_ID=replace-with-your-application-id
GUILD_ID=replace-with-your-test-server-id
```

## GitHub credentials (optional)

For polling, create a fine-grained GitHub token with read access to the target
repository, then set `GITHUB_MODE=polling_pat`, `GITHUB_PAT`, and `GITHUB_REPO`.
For webhooks, create a random shared secret, set `GITHUB_MODE=webhook` and
`GITHUB_WEBHOOK_SECRET`, then configure the same secret in the GitHub repository
under **Settings → Webhooks**.

## Validate the configuration

Run the focused logic tests first:

```powershell
npm.cmd test
```

Then run the environment and integration diagnostics:

```powershell
npm.cmd run test:diagnostics
```

Missing `DISCORD_TOKEN`, `CLIENT_ID`, or `GUILD_ID` will appear as diagnostic
failures until the values are configured.
