const { execSync } = require('child_process');

module.exports = {
  name: 'resources',
  description: 'Show CPU and memory usage',
  run: async (interaction) => {
    const cpu = execSync("top -bn1 | grep 'Cpu(s)'").toString();
    const mem = execSync("free -h").toString();
    await interaction.reply(`⚙️ Resources:\nCPU:\n\`\`\`${cpu}\`\`\`\nMemory:\n\`\`\`${mem}\`\`\``);
  }
};
