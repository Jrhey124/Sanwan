const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const commands = [
  new SlashCommandBuilder()
    .setName('cmd')
    .setDescription('Run Raspberry Pi commands')
    .addSubcommand(sub => sub.setName('disk').setDescription('Show disk usage'))
    .addSubcommand(sub => sub.setName('resources').setDescription('Show CPU and memory usage'))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering commands...');
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,   // your Application ID
        process.env.GUILD_ID     // your server’s ID
      ),
      { body: commands },
    );
    console.log('✅ Guild commands registered');
  } catch (err) {
    console.error(err);
  }
})();
