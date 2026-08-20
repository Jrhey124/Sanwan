# Sanwan Bot - Setup & Deployment Guide

A Discord ChatOps bot for task management, scheduling, and DevOps automation with file-based storage.

## 🚀 Quick Start

### Prerequisites

- Node.js 16.x or higher
- Discord Bot Token ([Get one here](https://discord.com/developers/applications))
- npm or yarn package manager

### Installation

1. **Clone or navigate to the repository**
   ```bash
   cd Sanwan
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run setup wizard**
   ```bash
   npm run setup
   ```
   
   The setup wizard will:
   - Create/update `.env` file with required credentials
   - Initialize data directories and schemas
   - Configure daemon service (optional)
   - Setup error logging to Discord channel
   - Discover and validate available commands

4. **Deploy slash commands to Discord**
   ```bash
   npm run deploy
   ```

5. **Test the setup**
   ```bash
   npm run test
   ```

6. **Start the bot**
   ```bash
   npm start
   ```

## 📋 Configuration

### Environment Variables (.env)

```env
# Discord Configuration (Required)
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_id
GUILD_ID=your_server_id

# AI Configuration (Optional)
AI_PROVIDER=openai
AI_TOKEN=your_ai_api_key
AI_MODEL=gpt-4

# Storage Configuration
SETTINGS_KEY=auto_generated_encryption_key
SETTINGS_PATH=./data/settings.json
```

### Getting Discord Credentials

1. **Create Discord Application**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Click "New Application"
   - Give it a name (e.g., "Sanwan Bot")

2. **Get Client ID**
   - Go to "General Information"
   - Copy "Application ID" → This is your `CLIENT_ID`

3. **Create Bot & Get Token**
   - Go to "Bot" section
   - Click "Add Bot"
   - Under "Token", click "Reset Token" and copy it → This is your `DISCORD_TOKEN`
   - Enable these Privileged Gateway Intents:
     - ✅ Presence Intent
     - ✅ Server Members Intent
     - ✅ Message Content Intent

4. **Get Guild ID (Server ID)**
   - In Discord, enable Developer Mode (Settings → Advanced → Developer Mode)
   - Right-click your server → Copy ID → This is your `GUILD_ID`

5. **Invite Bot to Server**
   - Go to "OAuth2" → "URL Generator"
   - Select scopes: `bot`, `applications.commands`
   - Select bot permissions:
     - Read Messages/View Channels
     - Send Messages
     - Send Messages in Threads
     - Embed Links
     - Attach Files
     - Read Message History
     - Use Slash Commands
   - Copy generated URL and open in browser to invite bot

## 🤖 Running the Bot

### Standard Mode
```bash
npm start
```

### Daemon Mode (Background Service)
```bash
npm run daemon
```

The daemon runs scheduled tasks and reminders in the background.

### Development Mode
```bash
node sanwan.js
```

## 🧪 Testing

Run the comprehensive test suite:
```bash
npm run test
```

Tests validate:
- ✅ Environment configuration
- ✅ Directory structure
- ✅ Data file integrity
- ✅ Command loading
- ✅ Log file accessibility
- ✅ Daemon configuration
- ✅ Dependencies

## 📁 Project Structure

```
Sanwan/
├── commands/           # Discord slash commands
│   ├── help.js         # Command reference
│   ├── task.js         # Task management
│   ├── logs.js         # Log viewing
│   ├── disks.js        # Disk status
│   └── resources.js    # Resource monitoring
├── utils/              # Utility modules
│   ├── logger.js       # Logging system
│   └── storage.js      # File-based storage
├── data/               # Data storage (created on setup)
│   ├── tasks/          # Task storage
│   ├── schedules/      # Schedule storage
│   ├── notes/          # Note storage
│   ├── logs/           # Log files
│   └── schemas/        # Data schema documentation
├── sanwan.js           # Main bot entry point
├── setup.js            # Setup wizard
├── test.js             # Test suite
├── daemon.js           # Background daemon service
├── deploy-commands.js  # Command deployment script
├── package.json        # Dependencies
└── .env                # Configuration (created by setup)
```

## 📝 Available Commands

### Task Management (`/task`)
```
/task add <title> [assignee] [deadline]  - Create new task
/task list [filter]                      - List all tasks
/task update <tid> <field> <value>       - Update task
/task describe <tid> <description>       - Add description
/task remove <tid>                       - Delete task
/task due <days>                         - Show tasks due in N days
/task link <tid> <issue#>                - Link to GitHub issue
/task sync                               - Sync with issue tracker
```

### Scheduling (`/schedule`)
```
/schedule set <name> <cron>              - Create scheduled job
/schedule list                           - List all schedules
/schedule history                        - View execution history
```

### Notes (`/note`)
```
/note add <title>                        - Create new note
/note list                               - List all notes
/note search <keyword>                   - Search notes
/note remove <title>                     - Delete note
/note push <sentence>                    - Add line to note
/note pop                                - Remove last line
/note export <title>                     - Export note
```

### AI Assistant (`/ask`)
```
/ask <question>                          - Ask AI a question
/ask model list                          - List AI models
/ask config                              - Show AI config
/ask switch <model>                      - Switch AI model
```

### Deployment (`/deploy`)
```
/deploy start <service>                  - Start service
/deploy stop <service>                   - Stop service
/deploy restart <service>                - Restart service
/deploy status <service>                 - Check status
/deploy rollback <commit>                - Rollback deployment
/deploy simulate                         - Simulate deployment
```

### System Status (`/status`)
```
/status disks                            - Show disk usage
/status resources                        - Show CPU/memory
/status network                          - Show network info
```

### Logs (`/logs`)
```
/logs view <file> [lines]                - View log file
/logs list                               - List log files
```

### Help (`/help`)
```
/help                                    - Show all commands
/help <command>                          - Get command help
```

## 🔧 Adding New Commands

1. **Create command file** in `commands/` directory:

```javascript
// commands/mycommand.js
const { SlashCommandBuilder } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  name: 'mycommand',
  description: 'Description of my command',
  data: new SlashCommandBuilder()
    .setName('mycommand')
    .setDescription('Description of my command')
    .addStringOption(option =>
      option.setName('param')
        .setDescription('Parameter description')
        .setRequired(true)
    ),

  async run(interaction) {
    try {
      const param = interaction.options.getString('param');
      
      // Your command logic here
      
      await interaction.reply(`Result: ${param}`);
      logger.command('mycommand', interaction.user.tag, true);
    } catch (error) {
      logger.error('Command error', { command: 'mycommand', error: error.message });
      await interaction.reply({ content: '❌ Error occurred', ephemeral: true });
    }
  }
};
```

2. **Deploy the new command**:
```bash
npm run deploy
```

3. **Restart the bot**:
```bash
npm start
```

## 🔄 Daemon Service

The daemon service runs scheduled tasks and checks for task reminders.

### Starting the Daemon

```bash
npm run daemon
```

### Daemon Features

- **Scheduled Jobs**: Executes commands based on cron expressions
- **Task Reminders**: Notifies about upcoming task deadlines
- **Discord Notifications**: Sends execution status to configured channels
- **Execution History**: Tracks all scheduled task runs

### Cron Expression Examples

```
0 2 * * *      → Daily at 2:00 AM
*/15 * * * *   → Every 15 minutes
0 9 * * 1      → Every Monday at 9:00 AM
0 0 1 * *      → First day of month at midnight
0 */6 * * *    → Every 6 hours
```

Use [crontab.guru](https://crontab.guru) to create cron expressions.

## 📊 Logging

All operations are logged to files in `data/logs/`:

- `bot.log` - General bot activity
- `errors.log` - Error tracking
- `commands.log` - Command execution history
- `daemon.log` - Daemon service activity

### Viewing Logs

**Via Discord:**
```
/logs view bot.log 100
```

**Via Terminal:**
```bash
tail -f data/logs/bot.log
```

## 🗄️ Data Storage

Sanwan uses **file-based JSON storage** for simplicity and portability.

### Storage Locations

- `data/tasks/tasks.json` - Task storage
- `data/schedules/schedules.json` - Schedule storage
- `data/notes/notes.json` - Note storage
- `data/settings.json` - Global settings

### Backup

Backups are automatically created in `data/backups/` when using storage operations.

**Manual backup:**
```bash
cp -r data/ data-backup-$(date +%Y%m%d)/
```

## 🚨 Error Handling

Errors are automatically:
1. Logged to `data/logs/errors.log`
2. Sent to configured Discord error channel
3. Returned to user if command-related

Configure error channel in setup or manually:
```json
// data/settings.json
{
  "bot": {
    "errorChannel": "YOUR_CHANNEL_ID"
  }
}
```

## 🔒 Security Best Practices

1. **Never commit `.env` file** - It contains sensitive tokens
2. **Restrict bot permissions** - Only enable required permissions
3. **Use environment variables** - Don't hardcode credentials
4. **Regular backups** - Backup `data/` directory regularly
5. **Monitor logs** - Check error logs frequently
6. **Rotate tokens** - Regenerate tokens if compromised

## 🐛 Troubleshooting

### Bot won't start
- Check `.env` file exists and has valid tokens
- Verify Discord token is not expired
- Run `npm run test` to diagnose issues

### Commands not showing in Discord
- Run `npm run deploy` to register commands
- Wait a few minutes for Discord to propagate
- Check bot has `applications.commands` scope

### Permission errors
- Verify bot role is above other roles (Discord settings)
- Check bot has required channel permissions
- Ensure Privileged Gateway Intents are enabled

### Data not persisting
- Check `data/` directory permissions
- Verify disk space is available
- Review `errors.log` for storage errors

## 📚 Additional Resources

- [Discord.js Documentation](https://discord.js.org/)
- [Discord Developer Portal](https://discord.com/developers/docs)
- [Cron Expression Guide](https://crontab.guru/)
- [Node.js Documentation](https://nodejs.org/docs/)

## 🤝 Support

For issues and questions:
1. Check logs in `data/logs/`
2. Run `npm run test` to diagnose
3. Review error messages in Discord (if error channel configured)

## 📄 License

MIT License - See LICENSE file for details
