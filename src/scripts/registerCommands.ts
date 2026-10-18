/**
 * CLI entry: register the slash commands with Discord.
 *
 * Usage: `npm run register-commands`
 *
 * Kept as a separate entry point on purpose — the library function must never
 * auto-run on import, or every bot boot (and every test) would hit the Discord
 * API. The previous implementation sniffed `process.argv[1]`, which broke
 * whenever the path or the runner changed; a dedicated file cannot drift.
 *
 * Exits 0 on success, 1 on failure (assertConfig / API errors).
 */
import { registerCommands } from "../lib/registerCommands";

registerCommands()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
