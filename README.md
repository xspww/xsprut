<p align="center">
  <img src="img/White.png" width="120" alt="xsprut Project logo">
</p>

<h1 align="center">xsprut Project</h1>

<p align="center">Roblox and Executor Update Tracker.</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-20%2B-green" alt="node">
  <img src="https://img.shields.io/badge/platform-Windows-blue" alt="platform">
</p>

https://github.com/user-attachments/assets/7a14de45-8027-463f-bef6-8e32f8b06c3c

---

This file shows how to run the bot on your computer. Follow the sections in order. This file covers install, configuration, and start only.

## What you need

A terminal is an app that runs text commands. Prepare these items before you start:

1. Install Node.js 20 or newer from https://nodejs.org.
2. Download this project to your computer.
3. Open the project folder in a terminal.
4. Create a Discord account with access to a Discord server.

Run `node -v` in the project folder to make sure that Node.js works.

## Install and set the `.env` file

The `.env` file holds the bot configuration. A bot token is a secret login key. An Application ID is a Discord app number. A Server ID is a Discord server number. Do the steps in order:

1. Run `npm install` in the project folder.
2. If the computer runs Windows, run `copy .env.example .env` in the project folder.
3. If the computer runs Mac or Linux, run `cp .env.example .env` in the project folder.
4. Open the `.env` file in a text editor.
5. Set `DISCORD_BOT_TOKEN` to your bot token.
6. Set `DISCORD_CLIENT_ID` to your Application ID.
7. Set `DISCORD_GUILD_ID` to your Server ID.
8. Save the `.env` file.
9. Leave the other lines in the `.env` file unchanged.
10. Do not share the `.env` file. The file holds a secret key.

## Register the commands

A slash command starts with `/` in Discord. If the `.env` file has no Server ID, commands need up to one hour to appear. Do the steps in order:

1. Run `npm run register-commands` in the project folder.
2. Wait for the success message in the terminal.
3. If the command fails, read the error text.
4. Correct the `.env` file.
5. Run the command again.

## Start the bot

Do the steps in order:

1. Run `npm run build` in the project folder.
2. Run `npm run start` in the project folder.
3. Wait for the login message in the terminal.

The terminal shows `Connecting to Discord` after a successful start. The terminal shows the bot name after a successful login. On Windows, double-click `start-bot.bat` instead of the two commands. Type `/ver` in Discord to test the bot. The bot replies with the Roblox version.
