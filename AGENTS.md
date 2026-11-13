# xsprut Project — Agent Notes

Discord bot (`robloxupdatetracker`) that tracks Roblox client updates and executor releases. TypeScript (`commonjs`), discord.js v14, Node >=20. SQLite (`better-sqlite3`, WAL mode, embedded migrations in `src/lib/db.ts`).

## Quick setup / verification

```bash
npm ci
npm run build         # clean + tsc; clean retries locked `dist/` via Atomics.wait
npm run typecheck     # checks both tsconfig.json AND tsconfig.test.json (noEmit)
npm test              # tsx --test tests/*.test.ts; Node built-in test runner
npm run dev           # tsx watch src/index.ts
npm start             # node dist/index.js (requires .env + DISCORD_BOT_TOKEN + DISCORD_CLIENT_ID)
```

- `.env` must exist (`.env.example` is complete). Required: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`. Multi-guild: comma-separated `DISCORD_GUILD_ID`. Never commit `.env`. `ecosystem.config.js` is also gitignored (machine-specific PM2 config).
- `npm run register-commands` hits the Discord API. `register-commands.bat` exists on Windows.
- Before a release: `docs/test-guild-checklist.md` covers Discord-facing behavior (embeds, captcha/code verification, protected room, permissions) that `npm test` does not cover. Run it in a throwaway server.

## Architecture / entrypoints

- `src/index.ts` — startup only. `assertConfig()` is called here, not on import (so tests don't explode). Has retry/backoff `loginWithRetry()` (fails fast on `TokenInvalid` / `4004` / `DisallowedIntents`). Graceful shutdown (`SIGINT`/`SIGTERM`) destroys the client with a 1.5s timeout.
- `src/lib/client.ts` — discord.js client with custom sweepers. Key: `messages` and `invites` swept at 10 min (`interval: 600, lifetime: 600`); `voiceStates` and `guildMembers` are NOT swept (protect-room relies on cached `message.member`; voice states have no REST endpoint). `MessageContent` privileged intent must be enabled in the Discord Developer Portal for `?ver` to work.
- `src/lib/config.ts` — reads `.env` with `dotenv` (quiet). `DB_PATH` or `NODE_TEST_CONTEXT` switches DB to `:memory:` for tests.
- `src/lib/db.ts` — SQLite file `data.db` (default), `:memory:` for tests. Embedded migrations (ALTER TABLE / index creation / column additions / data migrations) run on every open. Do not delete them. Statement-cache monkey-patches `db.prepare()` for hot paths.
- `src/commands/index.ts` — loads all `.ts` files from `src/commands/` except `index.ts` and `protectroomEdit.ts`. Command = `{ data, execute?, cooldownMs?, autocomplete? }`. Sub-directories are skipped (the name does not end in `.ts`/`.js`), so a command may keep its handlers in a folder next to it — `src/commands/executorStatus/` holds the `/ex` command's `data.ts`, `track.ts`, `botVoice.ts`, `botChat.ts` and `shared.ts`.
- `src/events/index.ts` — loads every `.ts` file from `src/events/` except `index.ts`. Same rule: sub-directories are skipped, so `src/events/messageCreate/` holds the message handler's `state.ts`, `prefix.ts` and `protect.ts`, and `src/events/interactionCreate/` holds the interaction handler's `command.ts`, `panel.ts` and `verify.ts`.
- `src/lib/panel.ts` — the server configuration panel. The implementation lives in `src/lib/panel/` (`builders.ts`, `button.ts`, `select.ts`, `modal.ts`, `shared.ts`); `src/lib/panel.ts` stays the public entry point so the existing imports keep working.

## Commands and scripts worth knowing

| Script / command | Note |
|---|---|
| `npm run build` | Also prints `Build completed successfully.` |
| `npm run typecheck` | Two passes: source + tests |
| `npm test` | In-memory SQLite; each `.test.ts` runs in its own child process |
| `npm run refresh-cards` | Force-refresh every enabled embed status card once |
| `npm run pm2:start` | Uses `ecosystem.config.js` (not committed) |
| `npm run register-commands` | Separate script so library import never hits Discord API |

## Development gotchas

- Prefix commands (`?ver`, `?inv`) never work inside protected rooms (protection takes priority).
- `?inv` requires `Create Instant Invite` bot permission; in **Code** verification mode it creates a single-use invite + one cryptographically random `XXXX-XXX-XXXX` code (stored as SHA-256 hash). The plaintext code is visible in the reply for 30 seconds — run `?inv` where only trusted members can read.
- Captcha session TTL = 3 min (`CAPTCHA_MAX_ATTEMPTS` = 3). Invite code TTL = 30 min (`INVITE_CODE_LENGTH` = 11, `INVITE_CODE_ALPHABET` excludes ambiguous `0/O`, `1/I`).
- DB migrations include historical cleanups (`DROP TABLE IF EXISTS musicPanels`, `lockdowns`). Don't remove those.
- `start-bot.bat` and `register-commands.bat` set `PATH` to `C:\Program Files\nodejs`.
- CI (`.github/workflows/build.yml`) runs `npm ci`, `npm run build`, `npm run typecheck`, `npm test` on Node 20 and 22, `fail-fast: false`. A second job (`slop-gate`) runs the AI SLOP Detector over the TypeScript sources — see below.

## Static analysis gate (AI SLOP Detector)

`pip install "ai-slop-detector[js]"` then:

```bash
slop-detector scan . --js --config .slopconfig.yaml --ci-mode hard --ci-report
```

- The project is TypeScript, so `--js` is required — without it the scan finds 0 files. The `[js]` extra installs tree-sitter; without it the analyzer silently falls back to regex and stops measuring god functions, dead code and complexity.
- `.slopconfig.yaml` holds the ignore list. **A config file replaces the built-in ignore list instead of extending it**, so the defaults are repeated in that file on purpose — drop one and `dist/` or `tests/` come back into the scan.
- `patterns.disabled` and `god_function.domain_overrides` only reach the Python pattern registry. The JS/TS analyzer hardcodes its thresholds (50 lines / complexity 10 / nesting depth 4), so a god function has to be split in the code — it cannot be waived from the config.
- The detector's `review` / `pulse` / `sweep` commands read only the Python file results, so they return empty for this repo. The `scan` command and `--ci-mode` gate do work.
- The CI job pins `ai-slop-detector` to an exact version. A new release can change the score, so bumping the pin is a deliberate step: change it, run the scan locally, and check the number before letting CI enforce it. The gate report is uploaded as the `ai-slop-report` artifact.

## What to trust

- Executable truth: `.env.example`, `package.json` scripts, `tsconfig.json`, `docs/test-guild-checklist.md`, `.github/workflows/build.yml`, embedded DB migrations in `src/lib/db.ts`. Docs (`README.md`) agree with these; if they conflict, trust the executable/config source.
