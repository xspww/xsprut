# Test-guild checklist

A one-pass manual check of everything the automated suite cannot cover. The
unit tests (`npm test`) prove the pure logic, but the Discord-facing behaviour —
gateway events, real permissions, real embeds, the captcha flow — only exists
once a live session touches a server.

Run this in a **throwaway server**, not production.

## Pre-flight

```bash
npm run build
npm run register-commands
npm start          # or restart under PM2 / start-bot.bat
```

- [ ] Startup logs show `Loaded 12 commands: …` with no errors
- [ ] Log shows `Logged into Discord bot!` and the bot appears online
- [ ] **Startup with a missing token fails fast** — temporarily clear
      `DISCORD_BOT_TOKEN` in `.env`, start, confirm the process exits with
      `Missing required environment variable(s)` and does not hang

## Slash commands

All slash commands require the **Administrator** permission.

- [ ] `/help` lists every command group
- [ ] `/ver` replies with the current Roblox version
- [ ] `/status` — add a message, confirm presence changes and the card renders
- [ ] `/config` lists the current config without erroring

## Roblox update alerts

- [ ] `/robloxalert add` in a channel → row appears in `/robloxalert list`
- [ ] `/test` posts an alert embed with the correct channel banner (LIVE/BETA)
- [ ] `/robloxalert remove` cleans up, and the row disappears from the list

## Executor tracking

- [ ] `/ex track add` for an executor → voice channel appears in the category
- [ ] `/ex track refresh` updates it without duplicate channels
- [ ] `/ex track remove` deletes the channel and its DB row

## Prefix commands (no slash)

- [ ] `?ver` answers in a normal channel
- [ ] `?ver ZBeta` answers; `?ver Nonsense` replies with the available-channel list
- [ ] Sending `?ver` twice quickly is rate-limited (cooldown)
- [ ] `?inv` creates a 1-use invite, and the reply + your message auto-delete after 30s
- [ ] `?inv` in a channel where the bot lacks *Create Instant Invite* replies with the permission error
- [ ] `?ver` inside a protected room does **not** answer (protection takes priority)

## Protected room (the risky one)

Set the action to **Timeout** first so a mistake is recoverable.

- [ ] `/protectroom setup` with action = Timeout → the notice message is posted
- [ ] Post as a **non-admin** member → the member is timed out, the notice counter increments
- [ ] The offender's recent messages in that channel are deleted
- [ ] An **Administrator** posting there is skipped (logged as `Skipped protection`)
- [ ] Switch to action = Ban only after the timeout path is confirmed

## Join verification — captcha mode

- [ ] `/verify setup` with verified/unverified roles and `mode: Captcha` → the panel is posted
- [ ] Press **Verify** → captcha image renders (not plain text)
- [ ] Enter the **correct** code → roles swap, success message shows
- [ ] Press **Verify** again and enter a **wrong** code 3 times → third attempt
      replies `Too many incorrect attempts`, and the session is gone
- [ ] Start over and wait > 3 minutes → the code is reported as expired

## Join verification — code mode

- [ ] `/verify setup` with verified/unverified roles and `mode: Code` → the panel is posted
- [ ] As a **verified** member, `?inv` → the reply contains both the invite link and a `XXXX-XXX-XXXX` code
- [ ] As an **unverified** member, `?inv` → replied `Only verified members` (no invite/code)
- [ ] Press **Enter code** → the modal opens (no captcha image)
- [ ] Enter the **correct** code → roles swap, success message shows
- [ ] Reuse the same code → replied `already been used`
- [ ] Enter a **made-up** code, or a code generated in another server → invalid
- [ ] Wait > 30 minutes, then enter the code → replied `expired` (or `Invalid or expired`)
- [ ] Switch back to Captcha mode or `/verify remove` → old codes stop working

## Join alerts and cleanup

- [ ] `/joinalert` — a new member triggers the welcome card
- [ ] `/cleanup preview` then `/cleanup run` completes without errors

## Post-run checks

- [ ] `bot.log` shows no unexpected `[ERROR]` lines
- [ ] `data.db` is the production file used (not the throwaway) if this was a
      deliberate production test
- [ ] No duplicate bot sessions — only one instance is online
- [ ] The bot survives a restart and reconnects the voice/status channels

## What this does not cover

- Multi-guild behaviour (`DISCORD_GUILD_ID` with several IDs)
- The WEAO fallback path — it only triggers when
  `clientsettings.roblox.com` is unreachable, which you cannot force from here
- Long-run memory behaviour (the discord.js sweepers run on a 10-minute timer)
