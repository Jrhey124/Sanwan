# Sanwan Data Schemas

This directory contains example JSON schemas for the Sanwan bot's file-based storage system.

## Schema Files

### tasks.json
Stores all tasks with tracking information.

```json
{
  "tasks": [
    {
      "tid": "T001",
      "title": "Setup CI/CD pipeline",
      "assignee": "@developer",
      "deadline": "2024-12-31",
      "status": "open",
      "description": "Configure GitHub Actions for automated testing and deployment",
      "linkedIssue": "#123",
      "created": "2024-01-15T10:30:00.000Z",
      "updated": "2024-01-15T10:30:00.000Z",
      "createdBy": "Admin#1234"
    }
  ],
  "nextId": 2
}
```

**Fields:**
- `tid`: Unique task identifier (auto-generated)
- `title`: Task title/summary
- `assignee`: Person responsible for the task
- `deadline`: Due date (YYYY-MM-DD format)
- `status`: One of: `open`, `in_progress`, `completed`, `blocked`
- `description`: Detailed task description
- `linkedIssue`: GitHub/GitLab issue reference
- `created`: ISO timestamp of creation
- `updated`: ISO timestamp of last update
- `createdBy`: Discord user who created the task

### schedules.json
Manages scheduled jobs and cron tasks.

```json
{
  "schedules": [
    {
      "sid": "S001",
      "name": "daily-backup",
      "when": "0 2 * * *",
      "command": "/cmd backup",
      "enabled": true,
      "notifyChannel": "123456789012345678",
      "created": "2024-01-15T10:30:00.000Z",
      "createdBy": "Admin#1234"
    }
  ],
  "nextId": 2,
  "history": [
    {
      "sid": "S001",
      "status": "completed",
      "result": "Backup completed successfully",
      "timestamp": "2024-01-16T02:00:00.000Z"
    }
  ]
}
```

**Schedule Fields:**
- `sid`: Unique schedule identifier
- `name`: Schedule name/label
- `when`: Cron expression (see https://crontab.guru)
- `command`: Command to execute
- `enabled`: Whether schedule is active
- `notifyChannel`: Discord channel ID for notifications
- `created`: Creation timestamp
- `createdBy`: User who created the schedule

**History Fields:**
- `sid`: Associated schedule ID
- `status`: Execution status (`started`, `completed`, `failed`)
- `result`: Execution result or error message
- `timestamp`: Execution time

**Cron Expression Examples:**
- `0 2 * * *` - Daily at 2:00 AM
- `*/15 * * * *` - Every 15 minutes
- `0 9 * * 1` - Every Monday at 9:00 AM
- `0 0 1 * *` - First day of every month at midnight

Use a registered shell shortcut for the command field, for example `/cmd backup` or `/cmd deploy {"branch":"main"}`. Arguments must be a JSON object containing strings, numbers, or booleans.

### notes.json
Stores notes and documentation.

```json
{
  "notes": [
    {
      "nid": "N001",
      "title": "Meeting Notes 2024-01-15",
      "content": [
        "Discussed Q1 roadmap",
        "Action items:",
        "- Update documentation",
        "- Review PRs"
      ],
      "tags": ["meeting", "roadmap"],
      "created": "2024-01-15T10:30:00.000Z",
      "updated": "2024-01-15T14:20:00.000Z",
      "createdBy": "Admin#1234"
    }
  ],
  "nextId": 2
}
```

**Fields:**
- `nid`: Unique note identifier
- `title`: Note title
- `content`: Array of lines (supports push/pop operations)
- `tags`: Array of tags for categorization
- `created`: Creation timestamp
- `updated`: Last update timestamp
- `createdBy`: User who created the note

### settings.enc
Encrypted global bot configuration. The JSON below is the decrypted payload stored inside the encrypted envelope; edit these settings through `npm run setup`.

```json
{
  "bot": {
    "name": "Sanwan",
    "version": "1.0.0",
    "errorChannel": "123456789012345678",
    "prefix": "/"
  },
  "deploy": {
    "production": "main",
    "staging": "develop",
    "allowedUsers": ["Admin#1234"]
  },
  "notifications": {
    "taskReminders": true,
    "scheduleNotifications": true,
    "errorAlerts": true
  },
  "ai": {
    "provider": "openai",
    "model": "gpt-4",
    "maxTokens": 2000,
    "temperature": 0.7
  }
}
```

**Sections:**
- `bot`: Core bot configuration
- `deploy`: Deployment settings and branch mappings
- `notifications`: Notification preferences
- `ai`: AI provider configuration

### daemon-config.json
Daemon service configuration.

```json
{
  "enabled": true,
  "schedules": [],
  "reminders": {
    "tasks": true,
    "checkInterval": "0 * * * *"
  },
  "timezone": "UTC"
}
```

## Data Location

All data files are stored in:
```
data/
├── tasks/
│   └── tasks.json
├── schedules/
│   └── schedules.json
├── notes/
│   └── notes.json
├── logs/
│   ├── bot.log
│   ├── errors.log
│   ├── commands.log
│   └── daemon.log
├── backups/
│   └── (automatic backups)
├── settings.enc
└── daemon-config.json
```

## Storage API

Use the storage utility module (`utils/storage.js`) to interact with data files:

```javascript
const storage = require('./utils/storage');

// Read data
const tasks = storage.list('tasks/tasks.json', 'tasks');

// Add item
storage.append('tasks/tasks.json', newTask, 'tasks');

// Update by ID
storage.updateById('tasks/tasks.json', 'T001', { status: 'completed' }, 'tasks', 'tid');

// Remove by ID
storage.removeById('tasks/tasks.json', 'T001', 'tasks', 'tid');

// Find by ID
const task = storage.findById('tasks/tasks.json', 'T001', 'tasks', 'tid');

// Get next ID
const nextId = storage.getNextId('tasks/tasks.json', 'T');

// Backup
storage.backup('tasks/tasks.json');
```

## Best Practices

1. **Always initialize files before use** with `storage.initializeIfMissing()`
2. **Backup before major operations** using `storage.backup()`
3. **Use atomic writes** - the storage module handles this automatically
4. **Keep IDs unique** - use `getNextId()` for auto-incrementing IDs
5. **Timestamp everything** - include `created` and `updated` fields
6. **Validate data** - check for required fields before saving
7. **Log all operations** - use the logger for traceability

## Migration

To migrate from file storage to a database in the future:

1. Read all data from JSON files
2. Transform to match database schema
3. Insert into database
4. Keep JSON files as backup
5. Update storage module to use database client instead of fs operations
