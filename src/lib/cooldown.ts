import config from "./config";

/**
 * In-memory cooldown manager to prevent command spam (rate limiting).
 *
 * Keys are typically `${userId}:${commandName}` (or `${userId}:ver` for the
 * public text command). Cooldowns live in RAM only — they do not need to
 * survive a restart, and a sweep timer keeps the map bounded.
 */
const cooldowns = new Map<string, number>(); // key -> expiresAt (epoch ms)
let sweepTimer: NodeJS.Timeout | null = null;

function ensureSweep() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, expiresAt] of cooldowns) {
      if (expiresAt <= now) cooldowns.delete(key);
    }
  }, 60_000);
  // Don't keep the process alive just for the sweeper.
  sweepTimer.unref?.();
}

/** Remaining cooldown in ms for a key (0 = not on cooldown). */
export function getCooldownRemainingMs(key: string): number {
  const expiresAt = cooldowns.get(key);
  if (expiresAt === undefined) return 0;
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) {
    cooldowns.delete(key);
    return 0;
  }
  return remaining;
}

/** Start a cooldown for a key (no-op for ms <= 0). */
export function setCooldown(key: string, ms: number): void {
  if (ms <= 0) return;
  ensureSweep();
  cooldowns.set(key, Date.now() + ms);
}

/**
 * Check-then-set in one call: if `key` is already cooling down, returns the
 * remaining ms (the caller should refuse the action); otherwise starts the
 * cooldown and returns 0 (the caller may proceed).
 */
export function checkCooldown(key: string, ms: number): number {
  const remaining = getCooldownRemainingMs(key);
  if (remaining > 0) return remaining;
  setCooldown(key, ms);
  return 0;
}

/** Human-readable (Thai) cooldown remaining, rounded up to whole seconds. */
export function formatCooldown(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return `${seconds} วินาที`;
}
