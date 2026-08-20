# Sanwan Discord ChatOps Bot - Project Overview

## 📖 Introduction

Sanwan is a Discord ChatOps bot designed for task management, scheduling, and DevOps automation. It uses **file-based JSON storage** instead of a database, making it lightweight, portable, and easy to deploy without infrastructure dependencies.

## 🎯 Design Philosophy

### No Database Required
- All data stored in JSON files under `data/` directory
- Easy to backup, migrate, and version control
- No database server setup or maintenance
- Portable across systems

### Modular Command Architecture
- Commands are self-contained modules in `commands/` directory
- Automatic command discovery and loading
- Easy to add, remove, or modify commands
- Each command handles its own data validation and error handling

### File-Based Logging
- All logs written to files in `data/logs/`
- Discord error notifications for critical issues
- Complete audit trail of all operations
- Log rotation and management built-in

### Daemon Service Support
- Background service for scheduled tasks
- Cron-based job scheduling
- Task deadline reminders
- Execution history tracking

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Discord API                        │
└───────────────────┬─────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────┐
│              sanwan.js (Main Bot)                    │
│  - Client initialization                             │
│  - Command loading & routing                         │
│  - Event handling                                    │
└───────────────────┬─────────────────────────────────┘
                    │
        ┌───────────┼───────────┐
        │           │           │
┌───────▼──────┐ ┌──▼────────┐ ┌▼───────────┐
│  Commands/   │ │  Utils/   │ │   Data/    │
│              │ │           │ │            │
│ - help.js    │ │ logger.js │ │ tasks/     │
│ - task.js    │ │ storage.js│ │ schedules/ │
│ - schedule.js│ │           │ │ notes/     │
│ - note.js    │ └───────────┘ │ logs/      │
│ - logs.js    │               │ settings/  │
│ - status.js  │               └────────────┘
│ - ...        │
└──────────────┘

┌─────────────────────────────────────────────────────┐
│              daemon.js (Background Service)          │
│  - Cron job execution                                │
│  - Task reminders                                    │
│  - Schedule history                                  │
└─────────────────────────────────────────────────────┘
```

## 📂 Project Structure

```
Sanwan/
├── commands/              # Discord slash commands
│   ├── help.js           # Command reference & documentation
│   ├── task.js           # Task management (add, list, update, remove)
│   ├── schedule.js       # Cron-based scheduling
│   ├── note.js           # Note taking & documentation
│   ├── logs.js           # Log file viewing
│   ├── disks.js          # Disk usage monitoring
│   └── resources.js      # CPU/memory monitoring
│
├── utils/                # Utility modules
│   ├── logger.js         # Logging system with Discord notifications
│   └── storage.js        # File-based JSON storage API
│
├── data/                 # Data storage (created by setup)
│   ├── tasks/
│   │   └── tasks.json    # Task storage
│   ├── schedules/
│   │   └── schedules.json # Schedule storage
│   ├── notes/
│   │   └── notes.json    # Note storage
│   ├── logs/
│   │   ├── bot.log       # General bot logs
│   │   ├── errors.log    # Error logs
│   │   ├── commands.log  # Command execution logs
│   │   └── daemon.log    # Daemon service logs
│   ├── backups/          # Automatic data backups
│   ├── schemas/          # Data schema documentation
│   ├── settings.json     # Global bot settings
│   └── daemon-config.json # Daemon configuration
│
├── sanwan.js             # Main bot entry point
├── setup.js              # Interactive setup wizard
├── test.js               # Comprehensive test suite
├── daemon.js             # Background daemon service
├── deploy-commands.js    # Command deployment to Discord
│
├── package.json          # Dependencies & scripts
├── .env                  # Environment variables (created by setup)
├── .gitignore           # Git ignore rules
│
├── README.md            # Basic project info
├── SETUP_GUIDE.md       # Comprehensive setup instructions
├── PROJECT_OVERVIEW.md  # This file
├── COMMAND_TEMPLATE.md  # Template for creating new commands
└── LICENSE              # License file
```

## 🔑 Key Components

### 1. Main Bot (sanwan.js)
- Initializes Discord client
- Loads commands dynamically from `commands/` directory
- Routes interactions to appropriate command handlers
- Provides command execution context

### 2. Setup Script (setup.js)
**Purpose:** Interactive wizard to configure the bot

**Features:**
- Creates/updates `.env` file with credentials
- Initializes directory structure
- Creates example data schemas
- Configures daemon service
- Sets up Discord error logging
- Validates command loading

**Usage:** `npm run setup`

### 3. Test Suite (test.js)
**Purpose:** Validate bot configuration and functionality

**Tests:**
- Environment variables
- Directory structure
- Data file integrity
- Command loading
- Command structure
- Log file accessibility
- Daemon configuration
- Dependencies
- Bot entry point

**Usage:** `npm run test`

### 4. Command System
**Design:**
- Each command is a self-contained module
- Exports `name`, `description`, `data`, and `run()` function
- Uses Discord.js SlashCommandBuilder for structure
- Handles its own validation and error handling

**Command Lifecycle:**
1. Command file created in `commands/`
2. Deployed to Discord via `deploy-commands.js`
3. Loaded into bot on startup
4. Executed when user invokes slash command
5. Response sent back to Discord

### 5. Storage System (utils/storage.js)
**Purpose:** Unified API for file-based JSON storage

**Key Methods:**
- `read()` - Read JSON file
- `write()` - Write JSON file
- `append()` - Add item to array
- `updateById()` - Update item by ID
- `removeById()` - Remove item by ID
- `findById()` - Find item by ID
- `list()` - Get all items
- `search()` - Search items by field
- `getNextId()` - Generate next ID
- `backup()` - Create backup

**Features:**
- Automatic directory creation
- Error handling and logging
- Atomic writes
- Auto-incrementing IDs
- Backup support

### 6. Logging System (utils/logger.js)
**Purpose:** Centralized logging with Discord notifications

**Log Levels:**
- `info()` - General information
- `error()` - Errors (also sent to Discord)
- `warn()` - Warnings
- `command()` - Command executions
- `daemon()` - Daemon activity

**Features:**
- File-based logging
- Discord error notifications
- Timestamped entries
- Metadata support
- Log file reading
- Log file listing

### 7. Daemon Service (daemon.js)
**Purpose:** Background service for automation

**Features:**
- Cron-based job scheduling
- Task deadline reminders
- Schedule execution tracking
- Discord notifications
- Execution history
- Error recovery

**Usage:** `npm run daemon`

## 🔄 Data Flow

### Command Execution Flow
```
1. User types /command in Discord
2. Discord sends interaction to bot
3. Bot routes to command handler
4. Command validates input
5. Command reads/writes data via storage API
6. Command logs operation via logger
7. Command sends response to Discord
8. Logger records to file and/or Discord
```

### Daemon Execution Flow
```
1. Daemon starts and loads schedules
2. Cron jobs created for each schedule
3. At scheduled time, job executes
4. Execution recorded in history
5. Result sent to Discord (if configured)
6. Errors logged and notified
```

## 📊 Data Schemas

### Task Schema
```json
{
  "tid": "T001",
  "title": "Task title",
  "assignee": "@user",
  "deadline": "2024-12-31",
  "status": "open|in_progress|completed",
  "description": "Detailed description",
  "linkedIssue": "#123",
  "created": "ISO timestamp",
  "updated": "ISO timestamp",
  "createdBy": "Discord user tag"
}
```

### Schedule Schema
```json
{
  "sid": "S001",
  "name": "schedule-name",
  "when": "0 2 * * *",
  "command": "/command",
  "enabled": true,
  "notifyChannel": "channel_id",
  "created": "ISO timestamp",
  "createdBy": "Discord user tag"
}
```

### Note Schema
```json
{
  "nid": "N001",
  "title": "Note title",
  "content": ["line1", "line2"],
  "tags": ["tag1", "tag2"],
  "created": "ISO timestamp",
  "updated": "ISO timestamp",
  "createdBy": "Discord user tag"
}
```

## 🚀 Deployment Workflow

### Initial Setup
```bash
1. npm install              # Install dependencies
2. npm run setup           # Run setup wizard
3. npm run deploy          # Deploy commands to Discord
4. npm run test            # Validate setup
5. npm start               # Start bot
```

### Adding New Command
```bash
1. Create commands/mycommand.js
2. npm run deploy          # Deploy to Discord
3. npm start               # Restart bot
```

### Daemon Setup
```bash
1. Configure in setup.js or manually
2. npm run daemon          # Start daemon
3. Use process manager (PM2, systemd) for production
```

## 🔧 Configuration

### Environment Variables (.env)
```env
# Required
DISCORD_TOKEN=...
CLIENT_ID=...
GUILD_ID=...

# Optional (AI features)
AI_PROVIDER=openai
AI_TOKEN=...
AI_MODEL=gpt-4

# Storage
SETTINGS_KEY=auto-generated
SETTINGS_PATH=./data/settings.json
```

### Settings (data/settings.json)
```json
{
  "bot": {
    "name": "Sanwan",
    "version": "1.0.0",
    "errorChannel": "channel_id"
  },
  "deploy": {
    "production": "main",
    "staging": "develop"
  },
  "notifications": {
    "taskReminders": true,
    "scheduleNotifications": true
  }
}
```

## 🧪 Testing Strategy

### Automated Tests (test.js)
- Configuration validation
- File system checks
- Command loading verification
- Dependency checks

### Manual Testing
- Discord command execution
- Data persistence
- Error handling
- Log generation

### Integration Testing
- Discord API interaction
- File I/O operations
- Error notification flow

## 📈 Scalability Considerations

### Current Design (File-Based)
**Pros:**
- Simple deployment
- No database overhead
- Easy backups
- Version controllable data

**Limitations:**
- Single-server only
- No concurrent write protection
- Linear search complexity
- File size limitations

### Migration Path to Database
When scaling needs arise:
1. Create database schema matching JSON structure
2. Write migration script to import JSON data
3. Update `storage.js` to use database client
4. Keep existing API intact
5. Commands require no changes

## 🔐 Security Considerations

### Token Security
- `.env` excluded from git
- Environment variables used for secrets
- No hardcoded credentials

### Data Access
- File-based storage restricts access to bot process
- Discord permissions control command execution
- Ephemeral responses for sensitive data

### Error Handling
- Errors logged without exposing secrets
- User-friendly error messages
- Admin notifications for critical errors

## 🛠️ Maintenance

### Regular Tasks
- Monitor log files for errors
- Backup `data/` directory
- Review task deadlines
- Check daemon execution history
- Update dependencies

### Backup Strategy
```bash
# Manual backup
cp -r data/ backups/data-$(date +%Y%m%d)/

# Automated (add to cron)
0 2 * * * cd /path/to/Sanwan && tar -czf backups/data-$(date +\%Y\%m\%d).tar.gz data/
```

## 📚 Extension Points

### Adding New Commands
See `COMMAND_TEMPLATE.md` for detailed guide

### Custom Storage Backends
Implement storage interface in `utils/storage.js`:
- `read()`, `write()`, `append()`, etc.
- Keep API consistent
- Add backend-specific configuration

### Additional Integrations
- GitHub API (issue tracking)
- CI/CD webhooks
- Monitoring systems
- External APIs

## 🤝 Contributing

### Command Development
1. Use `COMMAND_TEMPLATE.md` as starting point
2. Follow existing command patterns
3. Include error handling
4. Add logging
5. Test thoroughly

### Code Style
- Use async/await for asynchronous operations
- Handle errors gracefully
- Log important operations
- Comment complex logic
- Keep functions focused and small

## 📄 License

MIT License - See LICENSE file for details

## 🆘 Support & Troubleshooting

### Common Issues
See `SETUP_GUIDE.md` "Troubleshooting" section

### Debug Mode
```javascript
// Add to sanwan.js for verbose logging
client.on('debug', console.log);
```

### Log Analysis
```bash
# View recent errors
tail -n 50 data/logs/errors.log

# Monitor bot activity
tail -f data/logs/bot.log

# Search for specific command
grep "/task add" data/logs/commands.log
```

## 🎯 Future Enhancements

### Planned Features
- Database migration option
- Web dashboard
- Multi-guild support
- Plugin system
- AI assistant integration
- Advanced scheduling
- Report generation
- Webhook integrations

### Community Requests
Submit feature requests via GitHub issues or Discord

---

**Version:** 1.0.0  
**Last Updated:** 2024  
**Maintainer:** Sanwan Team
