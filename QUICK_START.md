# Sanwan Bot — Quick Start

## Requirements

- Node.js 18.17 or newer
- A Discord application and bot token
- A Discord server where you can install the bot

## Install and configure

```bash
npm ci
npm run setup
```

The setup wizard collects Discord credentials and the encryption key, initializes data files, and can deploy the slash commands. You can also copy `.env.example` to `.env` and fill the values manually. Keep `.env` and `SETTINGS_KEY` private; losing the key makes encrypted notes and settings unreadable.

## Run

```bash
npm test
npm run deploy
npm start
```

Run the scheduler in another process if you use scheduled commands or reminders:

```bash
npm run daemon
```

For GitHub webhooks, configure `GITHUB_MODE=webhook` and a webhook secret, expose the configured port, then run `npm run webhook`. Polling modes start with the bot process.

## Commands

Use `/help` in Discord for the live command list. Current commands include `/task`, `/note`, `/schedule`, `/cmd`, `/logs`, `/systeminfo`, and `/ping`.

To schedule a registered shortcut, use `/schedule set` with a five-field cron expression and a command in this form:

```text
/cmd <shortcut-id> {"placeholder":"value"}
```

For example, register a shell shortcut with ID `backup` and a `{target}` placeholder, then set its schedule command to `/cmd backup {"target":"daily"}`. Only registered enabled shortcuts can be scheduled. Changes take effect after restarting the daemon.

## Tests

- `npm test` runs logic tests without requiring Discord credentials.
- `npm run test:diagnostics` checks project configuration and runtime files; it may report missing credentials when the bot has not been configured yet.

Live Discord login, slash-command deployment, and GitHub delivery require valid credentials and should be checked in a test server.
# Container deployment

Install Docker Engine and Compose on the self-hosted machine, copy `.env.example`
to `.env`, set the Discord/GitHub credentials and a stable `SETTINGS_KEY`, then:

```bash
docker compose build
docker compose up -d bot daemon
docker compose ps
```

The database is persistent in the `sanwan-data` volume. Keep `.env` outside git
and back up the volume. CI should build and publish the image, then the host
pulls it and runs `docker compose up -d`.
# Getting Discord credentials

Before starting Sanwan, copy `.env.example` to `.env` and configure:

```env
DISCORD_TOKEN=...
CLIENT_ID=...
GUILD_ID=...
```

Get `CLIENT_ID` from the Discord Developer Portal application's **General
Information** page. Get `DISCORD_TOKEN` from the application's **Bot** page;
use **Reset Token** if no token is currently visible. Enable Discord Developer
Mode, then right-click your test server and choose **Copy Server ID** for
`GUILD_ID`. Keep the token private and never commit `.env`.
