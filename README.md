<p align="center">
  <img src="img/White.png" width="110" alt="xsprut Project logo">
</p>

<h1 align="center">xsprut Project</h1>

<p align="center">Discord bot that tracks Roblox client updates and executor releases.</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-20%2B-green" alt="node">
  <img src="https://img.shields.io/badge/discord.js-14-blue" alt="discord.js">
  <img src="https://img.shields.io/badge/platform-Windows-lightgrey" alt="platform">
</p>

https://github.com/user-attachments/assets/7a14de45-8027-463f-bef6-8e32f8b06c3c

---

## Features

- **Update alerts** — posts to a channel when Roblox ships a new client version.
- **Executor tracking** — monitors executor updates, plus voice and chat activity cards.
- **Server security** — room protection, user whitelist, and join verification.
- **Status cards** — live embed with Streaming/Online presence and auto-refresh.
- **Access control** — command whitelist, per-user cooldowns, error webhook reporting.
- **Self-hosting friendly** — SQLite storage, optional PM2 process, file logging.

## Requirements

- Node.js 20 or newer
- A Discord bot with a token, application ID, and server ID
- Windows, macOS, or Linux

## Setup

```bash
git clone https://github.com/xsprut/robloxupdatetracker.git
cd robloxupdatetracker
npm install
```

Copy the environment template and fill in your credentials:

```bash
# Windows
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

| Variable | Required | Description |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | Yes | Bot login token |
| `DISCORD_CLIENT_ID` | Yes | Application ID from the Discord Developer Portal |
| `DISCORD_GUILD_ID` | Yes | Target server ID. Use a comma-separated list for multiple servers |
| `ALLOWED_USER_IDS` | No | Restrict commands to these user IDs. Empty allows everyone with Administrator |
| `ERROR_WEBHOOK_URL` | No | Webhook that receives crash notifications |
| `COMMAND_COOLDOWN_MS` | No | Per-user command cooldown in ms. `0` disables |

Full list with defaults is in [`.env.example`](.env.example). Never commit your `.env` file.

Register the slash commands, then start the bot:

```bash
npm run register-commands
npm run build
npm start
```

On Windows, `register-commands.bat` and `start-bot.bat` do the same without typing commands.

> Without `DISCORD_GUILD_ID` set, Discord can take up to an hour to publish the commands.

Type `/help` in Discord to see every command. `/help` and `/ver` are the quickest way to verify the setup.

## Commands

| Group | Commands |
| --- | --- |
| Roblox updates | `/robloxalert add\|remove\|list`, `/ver` |
| Executors | `/ex track\|voice\|chat` — `add`, `edit`, `remove`, `list`, `refresh` |
| Security | `/protectroom setup\|remove\|view`, `/whitelist add\|remove\|list`, `/verify setup\|remove` |
| Other | `/status`, `/joinalert`, `/cleanup run\|preview`, `/config`, `/test`, `/help` |

All commands require the **Administrator** permission. Run `/help` in Discord for full usage details.

## Scripts

| Command | Action |
| --- | --- |
| `npm run dev` | Watch mode for local development |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled bot |
| `npm run register-commands` | Register slash commands with Discord |
| `npm test` | Run the test suite |
| `npm run pm2:start` | Run under PM2 for always-on hosting |
