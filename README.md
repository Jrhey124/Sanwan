# Sanwan
Sanwan is a lightweight CI/CD and team collaboration bot built with Discord.js and deployed on a Raspberry Pi. It bridges software deployment workflows with real‑time team communication, making DevOps tasks accessible directly from Discord.

📌 Project Description: Sanwan
Sanwan is a lightweight CI/CD and team collaboration bot built with Discord.js and deployed on a Raspberry Pi. It bridges software deployment workflows with real‑time team communication, making DevOps tasks accessible directly from Discord.

🔧 Key Features
Continuous Deployment  
Trigger deployments with simple slash commands (/deploy latest, /rollback) that pull code from GitHub and restart services on the Pi.

Monitoring & Logs  
Check system health (/status) and stream logs (/logs <service>) directly into Discord for quick debugging.

Service Management  
Restart or manage services (/restart <service>) without SSH access.

Team Collaboration  
Role‑based access ensures only authorized team members can deploy or manage services.
Deployment results and alerts are posted in Discord channels for full transparency.

Integration with GitHub Actions  
