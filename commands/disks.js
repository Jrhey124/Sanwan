const { execSync } = require('child_process');

module.exports = {
  name: 'disk',
  description: 'Show disk usage',
  run: async (interaction) => {
    const output = execSync('df -h /').toString();
    await interaction.reply(`📀 Disk usage:\n\`\`\`${output}\`\`\``);
  }
};
