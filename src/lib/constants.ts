import path from "node:path";

export const RDD_BASE = "https://rdd.weao.gg"
export const ROBLOX_CHANNELS = ["LIVE", "ZBeta"] as const;

export type RobloxChannel = (typeof ROBLOX_CHANNELS)[number];

// Roblox channel banner images served from the bot's own machine (img/ folder),
// attached to the update alert as files so they never depend on a Discord CDN.
export const ROBLOX_ZBETA_BANNER = { name: "BETA.png", file: path.join(__dirname, "../../img/BETA.png") };
export const ROBLOX_LIVE_BANNER = { name: "LIVE.png", file: path.join(__dirname, "../../img/LIVE.png") };


// knownVersions retention: rows older than this are pruned, and each Roblox
// channel keeps at most MAX rows (newest wins). Pruning runs on boot and on
// PRUNE_INTERVAL. 90d/500 is generous: ZBeta→LIVE promotion happens within
// days, and revert detection reads channelState (not this table), so pruning
// can only turn a very-old-hash reappearance into a plain "update" alert.
export const KNOWN_VERSIONS_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export const KNOWN_VERSIONS_MAX_PER_CHANNEL = 500;
export const KNOWN_VERSIONS_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Executor Embed Status refresh interval (per-row, configurable via /ex track)
export const EMBED_REFRESH_INTERVAL_DEFAULT_MS = 60_000;
export const EMBED_REFRESH_INTERVAL_MIN_MS = 10_000;
export const EMBED_REFRESH_INTERVAL_MAX_MS = 3_600_000;
export const EMBED_SCHEDULER_TICK_MS = 5_000;

/**
 * Parse a human-friendly duration string into milliseconds.
 * Supports combinations like "30s", "1m", "5m", "1h", "1m30s".
 * Returns null if the input is empty, malformed, or zero/negative.
 */
export function parseIntervalToMs(input: string | null | undefined): number | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "") return null;

  // Allow plain integer (interpreted as seconds) — convenient fallback
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return seconds * 1000;
  }

  const re = /(\d+)\s*(ms|s|m|h)/g;
  let totalMs = 0;
  let matched = false;
  let match: RegExpExecArray | null;
  while ((match = re.exec(trimmed)) !== null) {
    matched = true;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    if (unit === "ms") totalMs += value;
    else if (unit === "s") totalMs += value * 1000;
    else if (unit === "m") totalMs += value * 60 * 1000;
    else if (unit === "h") totalMs += value * 60 * 60 * 1000;
  }

  if (!matched) return null;
  if (totalMs <= 0) return null;

  // Reject trailing junk (e.g. "1m foo")
  const residual = trimmed.replace(re, "").trim();
  if (residual !== "") return null;

  return totalMs;
}

/** Render an ms interval back into a compact human-readable label. */
export function formatIntervalMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "1m";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  const remSec = totalSec % 60;
  if (totalMin < 60) {
    return remSec === 0 ? `${totalMin}m` : `${totalMin}m${remSec}s`;
  }
  const totalHr = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  return remMin === 0 ? `${totalHr}h` : `${totalHr}h${remMin}m`;
}