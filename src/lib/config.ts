import dotenv from "dotenv";
import path from "path";
dotenv.config({ quiet: true, path: path.join(__dirname, "../../.env") });

const {
  DISCORD_BOT_TOKEN,
  DISCORD_CLIENT_ID,
  DISCORD_GUILD_ID,
  CLIENTSETTINGS_BASE,
  ENABLE_GUILD_MEMBERS_INTENT,
  ALLOWED_USER_IDS,
  COMMAND_COOLDOWN_MS,
  COOLDOWN_MESSAGE_TTL_MS,
  ERROR_WEBHOOK_URL,
  LOG_TO_FILE,
  LOG_FILE,
} = process.env;

// Parse allowed user IDs from env (comma‑separated list)
const allowedUserIds = ALLOWED_USER_IDS
  ? ALLOWED_USER_IDS.split(',').map((id) => id.trim()).filter(Boolean)
  : [];

const DISCORD_GUILD_IDS = DISCORD_GUILD_ID
  ? DISCORD_GUILD_ID.split(",").map((id) => id.trim()).filter(Boolean)
  : [];

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const config = {
  DISCORD_BOT_TOKEN,
  DISCORD_CLIENT_ID,
  DISCORD_GUILD_ID,
  DISCORD_GUILD_IDS,
  // "Don't change unless you know what you're doing" — so a sane default is
  // better than a hard requirement. Kept overridable for staging/proxy setups.
  CLIENTSETTINGS_BASE:
    CLIENTSETTINGS_BASE?.trim() || "https://clientsettings.roblox.com",
  ENABLE_GUILD_MEMBERS_INTENT:
    ENABLE_GUILD_MEMBERS_INTENT?.toLowerCase() === "true",
  ALLOWED_USER_IDS: allowedUserIds,
  // Anti-spam: default command cooldown in ms (0 disables the cooldown).
  COMMAND_COOLDOWN_MS: parseNonNegativeInt(COMMAND_COOLDOWN_MS, 5000),
  // Anti-spam: how long the cooldown warning message stays before the bot
  // auto-deletes it (0 = keep it forever).
  COOLDOWN_MESSAGE_TTL_MS: parseNonNegativeInt(COOLDOWN_MESSAGE_TTL_MS, 5000),
  // Error notifications: Discord webhook URL (empty = log-only mode).
  ERROR_WEBHOOK_URL: ERROR_WEBHOOK_URL?.trim() || "",
  // File logging: append every log line to LOG_FILE.
  LOG_TO_FILE: LOG_TO_FILE?.toLowerCase() !== "false",
  LOG_FILE: LOG_FILE?.trim() || "bot.log",
};

/** Environment variables the bot cannot start without. */
export const REQUIRED_ENV_VARS = ["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID"] as const;

/**
 * Validate the required environment variables.
 *
 * Deliberately NOT run on import: reading config must never throw, or any test
 * (or tool) that transitively imports a lib module would explode before it can
 * run. Bot startup calls this once (`src/index.ts`) so a misconfigured deploy
 * still fails fast and loudly with a readable message.
 */
export function assertConfig(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Copy .env.example to .env and fill them in.`,
    );
  }
}

export default config;
