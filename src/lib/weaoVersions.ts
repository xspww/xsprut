import { fetchJsonWithRetry } from "./http";
import logger from "./logger";

// WEAO "current versions" endpoint — the same source rdd.weao.gg's
// "Download Latest" button uses. It reports the PUBLIC production hashes per
// platform:
//
//   GET https://weao.gg/api/versions/current
//   { Windows: "version-...", Mac: "version-...", Android: "...", iOS: "...",
//     WindowsResponse: { version, clientVersionUpload, timestamp }, ... }
//
// IMPORTANT: this source reports only the public LIVE production version — it
// has no ZBeta (or hidden-channel) data, so this fallback may ONLY be used for
// the LIVE channel check.

export type WeaoCurrentVersions = {
  Windows?: string;
  WindowsResponse?: {
    version?: string;
    clientVersionUpload?: string;
    timestamp?: number;
  };
};

const WEAO_VERSIONS_URL = "https://weao.gg/api/versions/current";

// The Roblox monitor polls every 10s — WEAO should not be hit that often.
// Cache the payload for 60s (matches the executor monitor's polling cadence).
const CACHE_TTL_MS = 60_000;

let cached: { at: number; data: WeaoCurrentVersions | null } | null = null;

// Rate-limited logging so a persistent outage can't spam bot.log every minute.
let lastFailureLogAt = 0;
const FAILURE_LOG_INTERVAL_MS = 10 * 60 * 1000;

/** Fetch (or serve cached) WEAO current versions. Never throws. */
export async function fetchWeaoCurrentVersions(): Promise<WeaoCurrentVersions | null> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const data = await fetchJsonWithRetry<WeaoCurrentVersions>(WEAO_VERSIONS_URL, {
    retries: 3,
    timeoutMs: 8000,
    headers: { "User-Agent": "RobloxUpdateTracker/1.0", Accept: "application/json" },
  }).catch(() => null);

  cached = { at: Date.now(), data };

  if (!data) {
    const now = Date.now();
    if (now - lastFailureLogAt >= FAILURE_LOG_INTERVAL_MS) {
      lastFailureLogAt = now;
      logger.warn(`WEAO ${WEAO_VERSIONS_URL} fetch failed — LIVE fallback unavailable.`);
    }
  }
  return data;
}

/** Current public LIVE Windows hash per WEAO (or null when unreachable). */
export async function fetchWeaoCurrentLiveHash(): Promise<string | null> {
  const data = await fetchWeaoCurrentVersions();
  return data?.Windows || data?.WindowsResponse?.clientVersionUpload || null;
}

// ─── Tier-1 in-memory snapshot ─────────────────────────────────────────────
// The executor monitor fetches the WEAO exploits payload every 60s. Each entry
// carries the Roblox version it was last seen on (`rbxversion`), so the
// majority value is a free, request-less fallback for LIVE detection. The
// snapshot lives here (not in monitoring/executorStatus.ts) so both the
// producer (executor monitor) and every consumer (robloxVersion.ts,
// monitoring/index.ts) import from lib with no circular dependency.

let lastRbxversions: string[] = [];

/** Overwrite the snapshot (called by the executor monitor after each fetch). */
export function setWeaoRbxversionSnapshot(values: (string | null | undefined)[]): void {
  // Drop stale / non-hash values at write time so reads are a pure vote.
  lastRbxversions = values.filter((v): v is string => !!v && /^version-/.test(v));
}

/**
 * Best-effort current Roblox LIVE version from the snapshot (majority vote).
 * Returns null until the executor monitor has completed its first fetch.
 */
export function getWEAORobloxVersion(): string | null {
  if (lastRbxversions.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of lastRbxversions) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/** Numeric LIVE version (e.g. "0.734.0.7340917") per WEAO, or undefined. */
export async function fetchWeaoCurrentLiveVersion(): Promise<string | undefined> {
  const data = await fetchWeaoCurrentVersions();
  return data?.WindowsResponse?.version;
}
