# Refactor regression checklist

What the automated suite cannot prove: the refactor moved every command and
event handler into new modules and changed the routing of the panel buttons.
The unit tests cover pure logic only — the slash-command payload is proved
byte-identical, but every Discord-facing path still has to be pressed by hand.

This checklist is the counterpart to `docs/test-guild-checklist.md`. That one
covers the features; this one covers **what this refactor touched**.

Run it in a **throwaway server**.

## Pre-flight

```bash
npm ci
npm run build
npm run register-commands
npm start
```

- [ ] Startup log shows `Loaded 13 commands: …` with no errors
- [ ] `Logged into Discord bot!` and the bot is online
- [ ] The DB migrations run once — no `DB migration failed:` lines in the log
- [ ] The bot is in the voice/status channels it was in before the refactor

---

## P0 — the bug that was fixed

The protected-room "disable" button did nothing. `panel:protect:disable:` is a
prefix of `panel:protect:disable:confirm:`, so the confirm button was matched
by the shorter prefix: clicking "ยืนยันปิด" re-showed the confirmation card
and the room was never turned off. The routing is now a pure function with a
unit test, but the flow still has to be pressed.

Set the action to **Timeout** first so a mistake is recoverable.

- [ ] `/protectroom setup` (action = Timeout) → the notice message is posted
- [ ] `/protectroom view` → the room is listed
- [ ] Panel → Protected Room → press **⛔ Disable** → the confirmation card appears
      (`# ⛔ ยืนยันการปิด Protected Room`)
- [ ] Press **✅ ยืนยันปิด** → the room is actually turned off:
  - [ ] the notice message in the channel is gone
  - [ ] the panel returns to the Protected Room view and the room is no longer listed
  - [ ] `/protectroom view` → the room is no longer there
  - [ ] the banner image is deleted (no leftover file in `data/panel-images/`)
- [ ] Press **❌ ยกเลิก** on the confirmation card instead → you land back on the
      Protected Room panel and the room is **still on** (the cancel path must not
      disable anything)
- [ ] The protect panel still lists the room after a cancel, and the notice
      message is still there

---

## P1 — smoke test (5 minutes)

The fastest pass that touches every module that moved.

- [ ] `/help` → every command group is listed, descriptions are not empty
- [ ] `/ver` → replies with the current Roblox version
- [ ] `/config` → renders the overview embed without an error
- [ ] `/panel` → the panel menu appears
- [ ] `?ver` in a normal channel → answers
- [ ] `?inv` in a normal channel → an invite link is returned
- [ ] `/status list` → renders (empty is fine)
- [ ] `/ex track list` → renders (empty is fine)
- [ ] No `[ERROR]` line appeared in `bot.log` during the pass

---

## P2 — every moved command

Each of these was split into one handler per subcommand. Run them all.

### `/ex` — the whole command was rebuilt

- [ ] `/ex track add` (voice) → a voice channel is created in the category
- [ ] `/ex track add` (chat) → a text channel is created
- [ ] `/ex track add` (embed) → the embed status message is posted
- [ ] `/ex track add` (alert) → the alert channel is stored
- [ ] `/ex track list` → all four kinds are listed, grouped
- [ ] `/ex track edit` (content) → the stored content changes
- [ ] `/ex track edit` (interval) → `30s` / `1m` / `5m` are accepted
- [ ] `/ex track edit` (interval) → `9s` is rejected with the minimum message,
      `2h` with the maximum message, `abc` with the format message
- [ ] `/ex track remove` → the channel/embed is deleted and the row disappears
- [ ] `/ex track refresh` → the statuses update, no duplicate channels
- [ ] `/ex voice add` (mode = Custom) → the bot voice channel is renamed
- [ ] `/ex voice add` (mode = Roblox Version) → the channel shows the version
- [ ] `/ex voice list` → renders the mode and the channel
- [ ] `/ex voice remove` → the bot voice channel is deleted
- [ ] `/ex voice refresh` → the name is refreshed
- [ ] `/ex chat add` / `list` / `remove` / `refresh` → same four steps as voice

### The other split commands

- [ ] `/status add` → the bot presence changes to the new message
- [ ] `/status add` with an empty text → rejected
- [ ] `/status list` → the messages are listed with their rotation interval
- [ ] `/status remove` → the presence is cleared
- [ ] `/status refresh` → the presence is re-applied
- [ ] `/whitelist add` → the bot is listed
- [ ] `/whitelist add` with a non-ID → rejected with the ID message
- [ ] `/whitelist add` a non-bot user → warned "is not a bot"
- [ ] `/whitelist list` → renders
- [ ] `/whitelist remove` → the bot disappears from the list
- [ ] `/joinalert add` → a new member triggers the welcome card
- [ ] `/joinalert list` → shows the channel
- [ ] `/joinalert remove` → the greeting stops
- [ ] `/robloxalert add` → the row appears in `/robloxalert list`
- [ ] `/robloxalert remove` → the row disappears
- [ ] `/robloxalert add` into a channel the bot cannot post in → the permission
      message appears
- [ ] `/test roblox-live` → a Roblox update card is posted
- [ ] `/test roblox-zbeta` → a ZBeta card is posted
- [ ] `/test executor-alert` → an executor card is posted
- [ ] `/test joinalert` → a welcome card is posted
- [ ] `/cleanup preview` → lists what it would delete, deletes nothing
- [ ] `/cleanup run` → completes without an error
- [ ] `/verify setup` → the public panel is posted
- [ ] `/verify remove` → the verification is off and the panel is gone
- [ ] `/protectroom setup` → the notice is posted
- [ ] `/protectroom edit` (new banner) → the banner changes
- [ ] `/protectroom edit` (`clear`) → the banner is removed
- [ ] `/protectroom remove` → the room is off
- [ ] `/protectroom view` → shows the status

---

## P3 — the panel (every button and modal)

The panel was split into `builders.ts` / `button.ts` / `select.ts` / `modal.ts`,
and the button routing was rewritten. Press **everything**.

- [ ] **Server Panel** → the menu renders
- [ ] **🔐 Verification** → the verify panel renders
- [ ] **✏️ Edit** → the verification modal opens with the current values
      (title, description, success message, banner, unverified role)
- [ ] Edit the modal and submit → the values are saved and the panel re-renders
- [ ] **🔄 Re-post** → the public panel message is deleted and re-posted
- [ ] **⛔ Disable** → the verification confirmation card appears
- [ ] **✅ ยืนยันปิด** → verification is off and the panel message is deleted
- [ ] The **mode select** (Captcha / Code) → switching works and the panel re-renders
- [ ] The **verified role select** → picking a role saves it
- [ ] The **channel select** → picking a channel moves the panel
- [ ] **🔒 Protected Room** → the protect panel renders
- [ ] The **protected-room channel dropdown** → picking a channel shows its details
- [ ] **✏️ Edit Banner** → the banner modal opens, saving changes the banner
- [ ] **Switch to …** → the action flips between ban and timeout, and the notice
      is re-posted with the new action
- [ ] **⏱️ Timeout** → the timeout modal opens; `10` saves 10 minutes; `0` and
      `99999` are rejected
- [ ] **🔄 Re-post** (protected room) → the notice is re-posted
- [ ] **📊 Status** → the status panel renders
- [ ] **📡 Roblox Alerts / 🤖 Executor Status / 👋 Join Alert / ⚙️ General Config /
      🧹 Cleanup** → the "coming soon" card renders with its hint
- [ ] **🔄 Refresh** on every panel → the panel re-renders without an error
- [ ] **⬅️ Back** → returns to the main menu
- [ ] `/panel` (the slash command) → the same menu appears

---

## P4 — the events that were split

### `messageCreate` — split into `state.ts` / `prefix.ts` / `protect.ts`

- [ ] `?ver` answers in a normal channel
- [ ] `?ver ZBeta` answers; `?ver Nonsense` replies with the channel list
- [ ] `?ver` twice quickly → the second one is silently ignored (cooldown)
- [ ] `?inv` → a 1-use invite; the reply **and** your message disappear after 30s
- [ ] `?inv` in a channel without *Create Instant Invite* → the permission message
- [ ] `?inv` in **Code** mode as a verified member → the reply carries the link
      **and** a `XXXX-XXX-XXXX` code
- [ ] `?inv` in **Code** mode as an unverified member → "Only verified members…",
      no invite and no code
- [ ] `?inv` in **Captcha** mode → the link only, no code
- [ ] `?ver` inside a protected room → does **not** answer (protection wins)
- [ ] A normal message in a normal channel → nothing happens, and the
      `messageLog` row is written (the next punish finds it)

### Protected room punishment

- [ ] Post as a **non-admin** in a protected room → timeout applied, notice
      counter incremented
- [ ] The offender's messages from the last minute are deleted **across all
      channels of that guild**
- [ ] An **Administrator** posting there → skipped, logged as `Skipped protection`
- [ ] The **guild owner** posting there → skipped
- [ ] Two messages from the same offender at once → the counter increments **once**
      (no double punish)
- [ ] The notice counter in the channel matches `/protectroom view`

### `interactionCreate` — split into `command.ts` / `panel.ts` / `verify.ts`

- [ ] Any slash command runs (the dispatcher)
- [ ] Autocomplete on `/ex track add` → the executor list appears
- [ ] The Verify button → the captcha card renders
- [ ] The correct captcha code → the roles swap and the success message shows
- [ ] A wrong captcha code 3 times → "Too many incorrect attempts"
- [ ] A captcha code older than 3 minutes → "The code has expired"
- [ ] The **Enter code** button → the modal opens
- [ ] The correct invite code → the roles swap
- [ ] The same invite code twice → "already been used"
- [ ] A made-up invite code → "Invalid or expired code"

### `guildMemberAdd` — split into the allowlist guard and the join alert

- [ ] A normal member joins → the welcome card is posted
- [ ] A **bot** that is not on the allowlist joins → it is kicked
- [ ] A **bot** that is on the allowlist joins → it stays and gets no welcome card
- [ ] A bot joins and the bot lacks *Kick Members* → it is left alone and the
      log says `missing Kick Members permission`

---

## P5 — behaviour that was changed on purpose

- [ ] `updateExecutorStatusChannels` no longer builds a status map it never read.
      Confirm an executor update still **alerts**: the `/ex track add` (alert)
      channel receives a message when WEAO reports a new version
- [ ] `/verify setup` without the `mode` option keeps the mode that was already
      configured (a Code server must not silently drop back to Captcha)
- [ ] The invite code is minted from the same verification-config read as the
      permission check, so an invite can never be created in one mode and the
      code in another

---

## P6 — infrastructure

- [ ] Both CI jobs pass on the pushed commit (`build` on Node 20 and 22,
      `slop-gate`)
- [ ] The `ai-slop-report` artifact is attached to the `slop-gate` run and says
      `69 clean, 0 with issues`
- [ ] The bot survives a restart and reconnects the voice and status channels
- [ ] Only one bot session is online (no duplicate instance left from a
      previous run)
- [ ] `bot.log` has no unexpected `[ERROR]` lines after the whole pass

---

## After the pass

- [ ] `data.db` is the production file, not a throwaway (if this was a
      deliberate production test)
- [ ] The protected room, the verification config and the panel settings are
      back to their intended state
- [ ] Any failure above is a **regression** — the matching unit test is in
      `tests/panelRouting.test.ts` (routing) or the module it came from

## What this still does not cover

- Multi-guild behaviour (`DISCORD_GUILD_IDS` with several ids)
- The WEAO fallback path — it only triggers when `clientsettings.roblox.com`
  is unreachable, which cannot be forced from here
- Long-run memory behaviour (the discord.js sweepers run on a 10-minute timer)
- The `empty arrow function` findings on `.catch(() => {})` — those are
  intentional, not a defect
