# Command Template

Use this template to create new commands for Sanwan bot.

## Basic Command Structure

```javascript
const { SlashCommandBuilder } = require('discord.js');
const storage = require('../utils/storage');
const logger = require('../utils/logger');

module.exports = {
  // Command name (must match filename without .js)
  name: 'commandname',
  
  // Short description
  description: 'Brief description of what this command does',
  
  // Discord.js slash command builder
  data: new SlashCommandBuilder()
    .setName('commandname')
    .setDescription('Brief description of what this command does')
    // Add options here
    .addStringOption(option =>
      option.setName('param')
        .setDescription('Parameter description')
        .setRequired(true)
    ),
  
  // Main execution function
  async run(interaction) {
    try {
      // Get parameters
      const param = interaction.options.getString('param');
      
      // Your command logic here
      
      // Reply to user
      await interaction.reply({
        content: 'Response message',
        ephemeral: false // true = only visible to user
      });
      
      // Log success
      logger.command('commandname', interaction.user.tag, true, { param });
      
    } catch (error) {
      // Log error
      logger.error('Command error', {
        command: 'commandname',
        error: error.message
      });
      
      // Reply with error
      await interaction.reply({
        content: `❌ Error: ${error.message}`,
        ephemeral: true
      });
    }
  }
};
```

## Command with Subcommands

```javascript
const { SlashCommandBuilder } = require('discord.js');
const storage = require('../utils/storage');
const logger = require('../utils/logger');

module.exports = {
  name: 'mycommand',
  description: 'Command with subcommands',
  data: new SlashCommandBuilder()
    .setName('mycommand')
    .setDescription('Command with multiple subcommands')
    .addSubcommand(subcommand =>
      subcommand
        .setName('action1')
        .setDescription('First action')
        .addStringOption(option =>
          option.setName('param')
            .setDescription('Parameter')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('action2')
        .setDescription('Second action')
    ),

  async run(interaction) {
    const subcommand = interaction.options.getSubcommand();

    try {
      switch (subcommand) {
        case 'action1':
          await this.handleAction1(interaction);
          break;
        case 'action2':
          await this.handleAction2(interaction);
          break;
        default:
          await interaction.reply({
            content: '❌ Unknown subcommand',
            ephemeral: true
          });
      }
    } catch (error) {
      logger.error('Command error', { subcommand, error: error.message });
      await interaction.reply({
        content: `❌ Error: ${error.message}`,
        ephemeral: true
      });
    }
  },

  async handleAction1(interaction) {
    const param = interaction.options.getString('param');
    
    // Action logic here
    
    await interaction.reply({ content: `Action 1: ${param}` });
  },

  async handleAction2(interaction) {
    // Action logic here
    
    await interaction.reply({ content: 'Action 2 executed' });
  }
};
```

## Option Types

```javascript
// String option
.addStringOption(option =>
  option.setName('text')
    .setDescription('Text input')
    .setRequired(true)
    .addChoices(
      { name: 'Option 1', value: 'opt1' },
      { name: 'Option 2', value: 'opt2' }
    )
)

// Integer option
.addIntegerOption(option =>
  option.setName('number')
    .setDescription('Number input')
    .setRequired(false)
    .setMinValue(1)
    .setMaxValue(100)
)

// Boolean option
.addBooleanOption(option =>
  option.setName('flag')
    .setDescription('Yes/No option')
    .setRequired(false)
)

// User option
.addUserOption(option =>
  option.setName('user')
    .setDescription('Select a user')
    .setRequired(true)
)

// Channel option
.addChannelOption(option =>
  option.setName('channel')
    .setDescription('Select a channel')
    .setRequired(false)
)

// Role option
.addRoleOption(option =>
  option.setName('role')
    .setDescription('Select a role')
    .setRequired(false)
)
```

## Getting Option Values

```javascript
// In run() function
const stringValue = interaction.options.getString('text');
const intValue = interaction.options.getInteger('number');
const boolValue = interaction.options.getBoolean('flag');
const user = interaction.options.getUser('user');
const channel = interaction.options.getChannel('channel');
const role = interaction.options.getRole('role');
```

## Working with Storage

```javascript
// Initialize data file
storage.initializeIfMissing('mydata/data.json', {
  items: [],
  nextId: 1
});

// Add item
const id = storage.getNextId('mydata/data.json', 'ID');
const newItem = {
  id,
  name: 'Item name',
  created: new Date().toISOString()
};
storage.append('mydata/data.json', newItem, 'items');

// List all items
const items = storage.list('mydata/data.json', 'items');

// Find by ID
const item = storage.findById('mydata/data.json', 'ID001', 'items', 'id');

// Update item
storage.updateById('mydata/data.json', 'ID001', {
  name: 'Updated name',
  updated: new Date().toISOString()
}, 'items', 'id');

// Remove item
storage.removeById('mydata/data.json', 'ID001', 'items', 'id');

// Search items
const results = storage.search('mydata/data.json', 'name', 'search term', 'items');

// Backup data
storage.backup('mydata/data.json');
```

## Response Types

```javascript
// Simple text response
await interaction.reply('Simple message');

// Formatted response
await interaction.reply({
  content: 'Message text',
  ephemeral: true // Only visible to user
});

// With embed
const { EmbedBuilder } = require('discord.js');
const embed = new EmbedBuilder()
  .setColor(0x0099ff)
  .setTitle('Title')
  .setDescription('Description')
  .addFields(
    { name: 'Field 1', value: 'Value 1', inline: true },
    { name: 'Field 2', value: 'Value 2', inline: true }
  )
  .setTimestamp();

await interaction.reply({ embeds: [embed] });

// With file attachment
const { AttachmentBuilder } = require('discord.js');
const attachment = new AttachmentBuilder(Buffer.from('file content'), {
  name: 'filename.txt'
});

await interaction.reply({
  content: 'Here is the file:',
  files: [attachment]
});

// Deferred reply (for long operations)
await interaction.deferReply(); // Show "Bot is thinking..."
// ... do work ...
await interaction.editReply('Work completed!');
```

## Logging

```javascript
// Info log
logger.info('Something happened', { key: 'value' });

// Error log
logger.error('Error occurred', { error: error.message });

// Command log
logger.command('commandname', interaction.user.tag, true, { param: 'value' });

// Daemon log
logger.daemon('Daemon activity', { status: 'running' });

// Warning
logger.warn('Warning message', { context: 'info' });
```

## Error Handling

```javascript
async run(interaction) {
  try {
    // Command logic
    
    // Validation
    if (!someCondition) {
      await interaction.reply({
        content: '❌ Validation failed',
        ephemeral: true
      });
      return;
    }
    
    // Success
    await interaction.reply({ content: '✅ Success!' });
    logger.command('mycommand', interaction.user.tag, true);
    
  } catch (error) {
    // Log error with context
    logger.error('Command failed', {
      command: 'mycommand',
      user: interaction.user.tag,
      error: error.message,
      stack: error.stack
    });
    
    // User-friendly error message
    await interaction.reply({
      content: `❌ An error occurred: ${error.message}`,
      ephemeral: true
    });
  }
}
```

## Best Practices

1. **Always validate inputs** before processing
2. **Use ephemeral responses** for errors and sensitive data
3. **Log all operations** for debugging and audit trails
4. **Handle errors gracefully** with user-friendly messages
5. **Use deferred replies** for operations taking >3 seconds
6. **Keep responses under 2000 characters** (Discord limit)
7. **Initialize data files** before accessing them
8. **Backup data** before destructive operations
9. **Use consistent naming** (lowercase, no spaces)
10. **Document your command** with clear descriptions

## Testing Your Command

1. Create the command file in `commands/` directory
2. Deploy commands: `npm run deploy`
3. Test in Discord
4. Check logs: `data/logs/commands.log`
5. Debug errors: `data/logs/errors.log`

## Command Deployment

After creating a new command:

```bash
# Deploy to Discord
npm run deploy

# Restart bot
npm start

# Check if command loaded
# Look for "✓ Loaded: /commandname" in console
```

## Example: Simple Counter Command

```javascript
const { SlashCommandBuilder } = require('discord.js');
const storage = require('../utils/storage');
const logger = require('../utils/logger');

module.exports = {
  name: 'counter',
  description: 'Simple counter example',
  data: new SlashCommandBuilder()
    .setName('counter')
    .setDescription('Increment or view counter')
    .addSubcommand(sub => sub.setName('increment').setDescription('Add 1'))
    .addSubcommand(sub => sub.setName('view').setDescription('Show count'))
    .addSubcommand(sub => sub.setName('reset').setDescription('Reset to 0')),

  async run(interaction) {
    storage.initializeIfMissing('counter/data.json', { count: 0 });
    const subcommand = interaction.options.getSubcommand();

    try {
      let data = storage.read('counter/data.json', { count: 0 });

      switch (subcommand) {
        case 'increment':
          data.count++;
          storage.write('counter/data.json', data);
          await interaction.reply(`🔢 Count: ${data.count}`);
          break;
        
        case 'view':
          await interaction.reply(`🔢 Current count: ${data.count}`);
          break;
        
        case 'reset':
          data.count = 0;
          storage.write('counter/data.json', data);
          await interaction.reply('🔢 Counter reset to 0');
          break;
      }

      logger.command('counter', interaction.user.tag, true, { subcommand });
    } catch (error) {
      logger.error('Counter error', { error: error.message });
      await interaction.reply({ content: '❌ Error', ephemeral: true });
    }
  }
};
```
