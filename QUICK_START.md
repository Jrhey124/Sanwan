# Sanwan Bot - Quick Start Guide

Get your Discord ChatOps bot running in 5 minutes!

## ⚡ Fast Setup (5 minutes)

### 1. Install Dependencies
```bash
npm install
```

### 2. Get Discord Bot Token

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" → Name it "Sanwan"
3. Go to "Bot" → Click "Add Bot"
4. Click "Reset Token" → Copy the token
5. Enable these intents:
   - ✅ Presence Intent
   - ✅ Server Members Intent
   - ✅ Message Content Intent

### 3. Get Discord IDs

**Application ID:**
- General Information → Copy "Application ID"

**Server ID:**
- In Discord, enable Developer Mode (Settings → Advanced → Developer Mode)
- Right-click your server → Copy ID

### 4. Invite Bot to Server

1. Go to OAuth2 → URL Generator
2. Select scopes: `bot`, `applications.commands`
3. Select permissions:
   - Send Messages
   - Use Slash Commands
   - Embed Links
   - Attach Files
4. Copy URL and open in browser
5. Select your server and authorize

### 5. Run Setup
```bash
npm run setup
```

Enter when prompted:
- Discord Bot Token (from step 2)
- Application Client ID (from step 3)
- Guild (Server) ID (from step 3)
- Press Enter to skip AI config (optional)

### 6. Deploy Commands
```bash
npm run deploy
```

### 7. Start Bot
```bash
npm start
```

You should see: `✅ Logged in as Sanwan#1234`

### 8. Test in Discord
Type `/help` in your server!

## 🎉 That's It!

Your bot is now running and ready to use.

## 📝 Quick Commands to Try

```
/help              - See all commands
/task add          - Create a task
/note add          - Create a note
/logs view         - View logs
```

## 🔧 Optional: Setup Daemon (Scheduling)

For scheduled tasks and reminders:

```bash
npm run daemon
```

Keep this running in a separate terminal or use a process manager like PM2.

## 🚀 Production Deployment

### Using PM2 (Recommended)

```bash
# Install PM2
npm install -g pm2

# Start bot
pm2 start sanwan.js --name sanwan-bot

# Start daemon
pm2 start daemon.js --name sanwan-daemon

# Save process list
pm2 save

# Setup auto-restart on reboot
pm2 startup
```

### Using systemd (Linux)

Create `/etc/systemd/system/sanwan.service`:

```ini
[Unit]
Description=Sanwan Discord Bot
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/path/to/Sanwan
ExecStart=/usr/bin/node sanwan.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable sanwan
sudo systemctl start sanwan
sudo systemctl status sanwan
```

## 🆘 Troubleshooting

### Bot won't start
```bash
npm run test
```
This will identify configuration issues.

### Commands not showing
1. Wait 2-3 minutes for Discord to update
2. Refresh Discord (Ctrl+R)
3. Check bot has `applications.commands` scope
4. Run `npm run deploy` again

### Permission errors
- Verify bot role is above other roles in Server Settings → Roles
- Check channel permissions allow bot to read/send messages
- Ensure required intents are enabled in Discord Developer Portal

### Data not saving
- Check `data/` directory exists and is writable
- View error logs: `cat data/logs/errors.log`
- Verify disk space: `df -h`

## 📚 Next Steps

- Read `SETUP_GUIDE.md` for detailed documentation
- See `COMMAND_TEMPLATE.md` to add custom commands
- Check `PROJECT_OVERVIEW.md` for architecture details
- Review `data/schemas/README.md` for data structure

## 🔗 Useful Links

- [Discord.js Guide](https://discordjs.guide/)
- [Discord Developer Portal](https://discord.com/developers)
- [Node.js Documentation](https://nodejs.org/docs/)
- [Cron Expression Generator](https://crontab.guru)

## 💡 Tips

- Use `/help <command>` for detailed command info
- Check logs regularly: `tail -f data/logs/bot.log`
- Backup `data/` directory before major changes
- Use ephemeral responses (visible only to you) for sensitive commands

## 🎯 Common Use Cases

### Task Management
```
/task add "Setup CI/CD" @developer 2024-12-31
/task list
/task update T001 status completed
```

### Scheduling
```
/schedule set daily-backup "0 2 * * *" "/deploy backup"
/schedule list
```

### Notes
```
/note add "Meeting Notes"
/note push "Meeting Notes" "Discussed Q1 roadmap"
/note export "Meeting Notes"
```

### Monitoring
```
/status disks
/status resources
/logs view bot.log 100
```

---

**Need help?** Check the logs in `data/logs/` or run `npm run test` to diagnose issues.
