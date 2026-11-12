import { Message } from "discord.js";
import db from "../../lib/db";
import logger from "../../lib/logger";

/**
 * State shared by the message handler and its helpers.
 *
 * The handler runs for EVERY message the bot sees, so the hot prepared
 * statements are cached here instead of being re-prepared on each call
 * (db.prepare is also memoized globally in src/lib/db.ts).
 */

export const stmtDeleteOldMessages = db.prepare("DELETE FROM messageLog WHERE timestamp < ?");
export const stmtInsertMessageLog = db.prepare(
  "INSERT INTO messageLog (guildId, channelId, userId, messageId, timestamp) VALUES (?, ?, ?, ?, ?)",
);

// Post-punish purge: userIds whose messages are deleted on sight for 60s
// after a punishment. Covers the race where the offender keeps typing while
// the ban/timeout API calls are still in flight (after the pre-punish SELECT
// has already run), plus anything they send right after. In-memory is
// enough — the window is only 1 minute, so losing it on restart is harmless.
export const postPurgeUntil = new Map<string, number>();
export const POST_PURGE_MS = 60_000;

// In-flight punish guard: `${guildId}:${userId}` -> guard expiry. Two messages
// from the same offender arriving at once must not double-punish (double
// timeout / double counter). Self-expiring after 30s so no finally-block is
// needed — a banned user is gone and a timed-out user cannot speak anyway.
export const punishGuardUntil = new Map<string, number>();
export const PUNISH_GUARD_MS = 30_000;

let cleanupStarted = false;

/** Start the periodic sweep of expired rows and in-memory entries. */
export function ensureCleanupTimer(): void {
  if (cleanupStarted) return;
  cleanupStarted = true;

  const sweepTimer = setInterval(() => {
    try {
      // Delete rows older than 2 minutes (120,000 ms).
      // Runs every 5 minutes — rows can linger up to ~7 min, fine for cleanup.
      const threshold = Date.now() - 120_000;
      stmtDeleteOldMessages.run(threshold);
    } catch (e) {
      logger.error("Failed to clean up messageLog:", e);
    }
    // Drop expired post-punish purge + punish-guard entries so the maps can't grow.
    try {
      const now = Date.now();
      for (const [key, until] of postPurgeUntil) {
        if (until <= now) postPurgeUntil.delete(key);
      }
      for (const [key, until] of punishGuardUntil) {
        if (until <= now) punishGuardUntil.delete(key);
      }
    } catch {
      // ignore
    }
  }, 5 * 60 * 1000); // run every 5 minutes
  sweepTimer.unref?.();
}

/**
 * Log every message from every user.
 *
 * The handler itself stays silent on purpose — it runs on EVERY message, so
 * logging would flood both stdout and bot.log. The messageLog table already
 * records what protect-room cleanup needs.
 */
export function logMessage(message: Message): void {
  try {
    stmtInsertMessageLog.run(
      message.guildId,
      message.channelId,
      message.author.id,
      message.id,
      Date.now(),
    );
  } catch {
    // Message might already be logged, ignore
  }
}
