# Sanwan

A Discord ChatOps bot for task tracking, shared notes, scheduled registered shortcuts, logs, system information, and optional GitHub notifications.

See [QUICK_START.md](QUICK_START.md) to install and start the bot, or [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) for the current architecture and commands.
# Docker deployment

Production runs as two Compose services: `bot` and `daemon`. Both share the
`sanwan-data` volume. Structured application state
(notes, services, tasks, schedules, permissions, and history) is stored as
encrypted envelopes in
`/app/data/sanwan.sqlite`; the `SETTINGS_KEY` remains only in `.env`.

```bash
docker compose build
docker compose up -d bot daemon
docker compose logs -f bot
```

The optional webhook is started with `docker compose --profile webhook up -d`.
Do not run both the inline bot webhook and the standalone webhook for the same
port. Back up the named volume before upgrades.
# Credentials

Sanwan needs a Discord bot token (`DISCORD_TOKEN`), application ID
(`CLIENT_ID`), and test server ID (`GUILD_ID`). Create an application in the
[Discord Developer Portal](https://discord.com/developers/applications), copy
the application ID from **General Information**, generate the bot token from
**Bot**, and copy the server ID from Discord with **Developer Mode** enabled.
Store them only in `.env`; `.env` is ignored by git.
