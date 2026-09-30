import config from "./config";
import { fetchJsonWithRetry } from "./http";
import {
  fetchWeaoCurrentLiveHash,
  fetchWeaoCurrentLiveVersion,
  getWEAORobloxVersion,
} from "./weaoVersions";

export type RobloxVersionDetails = { hash: string; version?: string };

type RobloxPrimaryPayload = {
  clientVersionUpload?: string;
  version?: string;
};

// Single source of truth for Roblox clientsettings fetches (previously each
// call site rolled its own with different timeouts: 10s in the monitor, 4s in
// the executor loop, none in /ver — now uniformly 3 retries, 8s timeout).
// Never throws: null means "unreachable", and callers decide what to do.
// (Deliberate: the 10s monitor tick previously logged a per-channel error on
// every failed fetch; now a miss is just a miss and the monitor's throttled
// warn + fallback logs are the only noise.)
export async function fetchRobloxPrimary(
  channel: string,
): Promise<RobloxPrimaryPayload | null> {
  try {
    const data = await fetchJsonWithRetry<RobloxPrimaryPayload>(
      `${config.CLIENTSETTINGS_BASE}/v2/client-version/WindowsPlayer/channel/${channel}`,
      { retries: 3, timeoutMs: 8000 },
    );
    return data;
  } catch {
    return null;
  }
}

// Short cache for user-facing commands (/ver, ?ver) so a burst of checks
// doesn't hammer Roblox. Positive results live 30s, misses only 10s so
// recovery after an outage is still fast. (The 60s monitoring ticks bypass
// the cache with useCache:false — they run rarely enough already.)
const versionCache = new Map<string, { at: number; data: RobloxVersionDetails | null }>();
const POSITIVE_TTL_MS = 30_000;
const NEGATIVE_TTL_MS = 10_000;

/**
 * Fetch the current Roblox client version for a channel (LIVE/ZBeta).
 * Returns `{ hash, version }` or null when unreachable.
 *
 * LIVE has a WEAO fallback chain (Tier-1 in-memory rbxversion snapshot from
 * the executor monitor, Tier-2 weao.gg/api/versions/current). ZBeta has no
 * secondary source, so a primary miss is a plain miss.
 */
export async function getRobloxVersionDetails(
  channel: string,
  opts: { useCache?: boolean } = {},
): Promise<RobloxVersionDetails | null> {
  const useCache = opts.useCache ?? true;

  if (useCache) {
    const entry = versionCache.get(channel);
    if (entry) {
      const ttl = entry.data ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
      if (Date.now() - entry.at < ttl) return entry.data;
    }
  }

  const primary = await fetchRobloxPrimary(channel);
  let hash: string | null = primary?.clientVersionUpload ?? null;
  let version: string | undefined = primary?.version;

  if (!hash && channel === "LIVE") {
    // Tier 1: in-memory WEAO rbxversion (no extra request).
    hash = getWEAORobloxVersion();

    // Tier 2: dedicated WEAO versions endpoint (cached 60s internally).
    if (!hash) {
      const weaoHash = await fetchWeaoCurrentLiveHash();
      if (weaoHash) {
        hash = weaoHash;
        version = version ?? (await fetchWeaoCurrentLiveVersion());
      }
    }
  }

  const result: RobloxVersionDetails | null = hash ? { hash, version } : null;
  if (useCache) versionCache.set(channel, { at: Date.now(), data: result });
  return result;
}

/** Hash-only wrapper (kept for /ver, ?ver and other existing callers). */
export async function getRobloxVersion(
  channel: string,
  opts: { useCache?: boolean } = {},
): Promise<string | null> {
  const details = await getRobloxVersionDetails(channel, opts);
  return details?.hash ?? null;
}
