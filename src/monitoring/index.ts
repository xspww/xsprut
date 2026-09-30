import db from "../lib/db";
import {
  hasVersion,
  invalidateVersion,
  getChannelState,
  invalidateChannelState,
} from "../lib/dbCache";
import { ROBLOX_CHANNELS, RobloxChannel } from "../lib/constants";
import logger from "../lib/logger";
import { fetchRobloxPrimary } from "../lib/robloxVersion";
import {
  fetchWeaoCurrentLiveHash,
  fetchWeaoCurrentLiveVersion,
  getWEAORobloxVersion,
} from "../lib/weaoVersions";
import { sendUpdate, sendPreUpdate, sendRevert } from "./alerts";

function addVersion(hash: string, channel: string) {
  db.prepare(
    `
        INSERT OR IGNORE INTO knownVersions (
            hash,
            robloxChannel,
            detectedAt
        )
        VALUES (?, ?, ?)
    `,
  ).run(hash, channel, Date.now());
  // The "not seen yet" cache entry (if any) is now stale.
  invalidateVersion(hash, channel);
}

function markReleased(hash: string) {
  db.prepare(
    `
        UPDATE knownVersions
        SET released = 1
        WHERE hash = ?
    `,
  ).run(hash);
}

function updateChannelState(channel: RobloxChannel, hash: string, version?: string | null) {
  db.prepare(
    `
      INSERT INTO channelState (
        robloxChannel,
        currentVersion,
        previousVersion,
        version
      )
      VALUES (?, ?, NULL, ?)
      ON CONFLICT(robloxChannel)
      DO UPDATE SET
        previousVersion = channelState.currentVersion,
        currentVersion = excluded.currentVersion,
        -- A fallback hash may arrive without its numeric version; never let
        -- that wipe a previously recorded one.
        version = COALESCE(excluded.version, channelState.version)
    `,
  ).run(channel, hash, version ?? null);
  invalidateChannelState(channel);
}

/**
 * If `hash` was previously detected on ZBeta (i.e. a future update has now
 * reached the public LIVE channel), record it as released. Marking is
 * idempotent — it must run on EVERY new LIVE version, not just the first
 * check after a fresh DB, or the ZBeta→LIVE release would never be recorded.
 */
function markReleasedIfZBetaDetected(hash: string) {
  const betaVersion = db
    .prepare(`SELECT 1 FROM knownVersions WHERE hash = ? AND robloxChannel = 'ZBeta'`)
    .get(hash);
  if (betaVersion) {
    markReleased(hash);
    logger.info(`${hash} has been released`);
  }
}

// When clientsettings.roblox.com is unreachable, the LIVE check falls back to
// two WEAO sources (both LIVE-only, so safe for that channel and only that
// channel): (1) the majority `rbxversion` from the latest exploits payload
// (already fetched every 60s by the executor monitor), and (2) the dedicated
// `api/versions/current` endpoint (see src/lib/weaoVersions.ts). WEAO is a
// secondary source, so we log once when entering fallback mode and once when
// the primary recovers.
let weaoFallbackActive = false;

// Rate-limited "no hash" warnings. Without this, a channel whose endpoint
// returns nothing (e.g. Roblox locking it down with an HTTP 4xx) would be
// skipped silently every 10s with zero trace — updates there would be missed
// and no one could tell why. Log at most once per 10 minutes per channel.
const lastNoHashLogAt = new Map<string, number>();
const NO_HASH_LOG_INTERVAL_MS = 10 * 60 * 1000;

function logMissingHash(channel: RobloxChannel, data: unknown) {
  const now = Date.now();
  if (now - (lastNoHashLogAt.get(channel) ?? 0) < NO_HASH_LOG_INTERVAL_MS) return;
  lastNoHashLogAt.set(channel, now);
  logger.warn(
    `No clientVersionUpload for ${channel} (fetch returned ${data === null ? "null/non-200 response" : "a payload without a hash"}) — skipping this check. ` +
      `This usually means Roblox is restricting the channel endpoint, so updates there will NOT be detected until it is reachable again.`,
  );
}

// Channels that most recently returned no hash — used to log a one-shot
// recovery line when the channel becomes readable again after an outage. The
// existing detection logic then alerts immediately for any hash it has not
// seen before.
const missingChannels = new Set<RobloxChannel>();

// ─── False-revert guards ─────────────────────────────────────────────────────
// Root cause of the 2026-09-10 spam (13 revert alerts in ~40 min alternating
// version-c5aecda2245e4fae <-> version-e7d81637d42c4b23): the LIVE primary
// flapped reachable/unreachable, and every fallback tick returned the stale
// WEAO majority `rbxversion` (executors still on the old build) which happened
// to equal `previousVersion`. A single fetch was trusted immediately, the
// state was flipped BEFORE alerting, so the next primary recovery looked like
// a revert back — a self-sustaining ping-pong.
//
// Three layers, cheapest first:
// 1. Confirmation: a new hash must be seen CONFIRM_REQUIRED consecutive ticks
//    before it can alert. A-B-A-B jitter never confirms.
// 2. Fallback trust: a WEAO fallback hash that is already known (or equals
//    previousVersion) is stale by definition — ignore it WITHOUT flipping
//    channelState, or it poisons `previousVersion` for the next primary tick.
// 3. Revert cooldown: a revert to the same hash cannot alert twice within
//    REVERT_COOLDOWN_MS. Covers primary-side flaps where each phase lasts
//    minutes (long enough to confirm).
const CONFIRM_REQUIRED = 2;
const REVERT_COOLDOWN_MS = 30 * 60 * 1000;

const pendingConfirmation = new Map<RobloxChannel, { hash: string; count: number }>();
const lastRevertAlertAt = new Map<string, number>();

/** Test hook — clears in-memory confirmation + cooldown state. */
export function __resetMonitoringState() {
  pendingConfirmation.clear();
  lastRevertAlertAt.clear();
  missingChannels.clear();
  weaoFallbackActive = false;
}

// Returns true when a hash was obtained (detection ran), false when the
// channel was unreachable and the check was skipped.
export async function checkChannel(channel: RobloxChannel): Promise<boolean> {
  // Single source of truth for the primary fetch (see lib/robloxVersion.ts).
  // fetchRobloxPrimary never throws — null means unreachable. Fresh fetch
  // (no cache): the monitor must see every new hash within one 10s tick.
  const data = await fetchRobloxPrimary(channel);

  let hash = data?.clientVersionUpload;
  let version = data?.version;
  let isFallback = false;

  if (!hash && channel === "LIVE") {
    // Tier 1: WEAO exploits `rbxversion` (majority vote — already fetched every
    // 60s by the executor monitor, no extra request).
    const fallback = getWEAORobloxVersion();
    if (fallback) {
      hash = fallback;
      isFallback = true;
      if (!weaoFallbackActive) {
        weaoFallbackActive = true;
        logger.info(
          "clientsettings.roblox.com unreachable — using WEAO rbxversion as fallback for LIVE detection.",
        );
      }
    }

    // Tier 2: WEAO `api/versions/current` — a dedicated endpoint, independent
    // of the executor monitor. LIVE-only data, so it is safe here and ONLY
    // here (see weaoVersions.ts).
    if (!hash) {
      const weaoLive = await fetchWeaoCurrentLiveHash();
      if (weaoLive) {
        hash = weaoLive;
        isFallback = true;
        version = version ?? (await fetchWeaoCurrentLiveVersion());
        if (!weaoFallbackActive) {
          weaoFallbackActive = true;
          logger.info(
            "clientsettings.roblox.com unreachable — using WEAO versions/current as fallback for LIVE detection.",
          );
        }
      }
    }
  } else if (weaoFallbackActive && channel === "LIVE" && hash) {
    weaoFallbackActive = false;
    logger.info("clientsettings.roblox.com reachable again — LIVE monitoring back on primary source.");
  }

  if (!hash) {
    // Keep blind-skip failures visible: without this, a locked-down channel is
    // polled every 10s and silently ignored forever (see logMissingHash above).
    logMissingHash(channel, data);
    missingChannels.add(channel);
    return false;
  }

  // One-shot recovery notice when a previously blind channel becomes readable
  // again (existing logic below will alert for any unseen hash right away).
  if (missingChannels.delete(channel)) {
    logger.info(`${channel} channel is reachable again — resuming detection.`);
  }

  const currentState = getChannelState(channel);

  const versionExists = hasVersion(hash, channel);

  if (currentState && currentState.currentVersion === hash) {
    // Stable — any half-confirmed challenger is dead.
    pendingConfirmation.delete(channel);
    return true;
  }

  // Layer 1 — confirmation: require the same new hash on consecutive ticks
  // before it can move state or alert. Single-tick jitter (CDN edge
  // inconsistency, one-off fallback) dies here with no side effects.
  const pending = pendingConfirmation.get(channel);
  if (!pending || pending.hash !== hash) {
    pendingConfirmation.set(channel, { hash, count: 1 });
    logger.info(
      `${channel}: new hash ${hash} seen${isFallback ? " (WEAO fallback)" : ""} — waiting for confirmation (${1}/${CONFIRM_REQUIRED}).`,
    );
    return true;
  }
  if (pending.count + 1 < CONFIRM_REQUIRED) {
    pending.count += 1;
    pendingConfirmation.set(channel, pending);
    return true;
  }
  pendingConfirmation.delete(channel);

  // Layer 2 — fallback trust: a fallback hash that is already known (or is
  // exactly the previous version) is stale lag, not a revert. Ignore it
  // WITHOUT touching channelState — flipping state here is what poisoned
  // `previousVersion` and made the next primary tick look like a revert back.
  if (isFallback && currentState) {
    const isStaleRevert = currentState.previousVersion === hash;
    if (isStaleRevert || versionExists) {
      logger.info(
        `${channel}: ignoring stale WEAO fallback hash ${hash} (current=${currentState.currentVersion}, previous=${currentState.previousVersion ?? "none"}) — keeping primary state.`,
      );
      return true;
    }
    // A genuinely new hash via fallback is still allowed through to the
    // normal update path below (it was confirmed above).
  }

  if (channel === "LIVE" && currentState) {
    const isRevert = currentState.previousVersion === hash;

    // Layer 3 — revert cooldown: the same revert cannot alert twice within
    // the window. State still flips (DB tracks reality) but Discord is not
    // spammed when primary itself flaps between two builds for minutes.
    if (isRevert) {
      const key = `${channel}:${hash}`;
      const now = Date.now();
      const lastAt = lastRevertAlertAt.get(key) ?? 0;
      updateChannelState(channel, hash, version);
      if (!versionExists) {
        addVersion(hash, channel);
      }
      markReleasedIfZBetaDetected(hash);
      if (now - lastAt < REVERT_COOLDOWN_MS) {
        logger.info(
          `${channel}: revert to ${hash} suppressed by cooldown (last alert ${Math.round((now - lastAt) / 1000)}s ago).`,
        );
        return true;
      }
      lastRevertAlertAt.set(key, now);
      await sendRevert(hash, currentState.currentVersion, channel);
      return true;
    }

    updateChannelState(channel, hash, version);

    if (versionExists) {
      return true;
    }

    await sendUpdate(hash, channel, version);

    if (!versionExists) {
      addVersion(hash, channel);
    }

    // A ZBeta build reaching LIVE means it has been officially released.
    markReleasedIfZBetaDetected(hash);

    return true;
  }

  if (!versionExists) {
    addVersion(hash, channel);

    if (channel === "ZBeta") {
      await sendPreUpdate(hash, channel, version);
    } else {
      await sendUpdate(hash, channel, version);
      markReleasedIfZBetaDetected(hash);
    }
  }


  updateChannelState(channel, hash, version);
  return true;
}

// ─── Outage backoff ──────────────────────────────────────────────────────────
// A channel whose endpoint stays unreachable (e.g. ZBeta locked down for
// hours) must not be hammered every 10s forever. After SLOW_AFTER_MISSES
// consecutive misses the channel drops to one check per SLOW_POLL_MS until a
// hash comes back. Healthy channels are unaffected. A LIVE check rescued by a
// WEAO fallback counts as a hit (a hash WAS obtained).
const BASE_POLL_MS = 10_000;
const SLOW_POLL_MS = 60_000;
const SLOW_AFTER_MISSES = 6;

const missStreak = new Map<RobloxChannel, number>();
const slowUntil = new Map<RobloxChannel, number>();

let monitoring = false;
export async function startMonitoring() {
  if (monitoring) {
    logger.info("Update monitoring already running.");
    return;
  }

  monitoring = true;
  logger.info("Update monitoring running.");

  async function check() {
    const now = Date.now();
    for (const channel of ROBLOX_CHANNELS) {
      if (now < (slowUntil.get(channel) ?? 0)) continue;
      try {
        const ok = await checkChannel(channel);
        if (ok) {
          missStreak.delete(channel);
          slowUntil.delete(channel);
        } else {
          const streak = (missStreak.get(channel) ?? 0) + 1;
          missStreak.set(channel, streak);
          if (streak >= SLOW_AFTER_MISSES) {
            slowUntil.set(channel, Date.now() + SLOW_POLL_MS);
            // Transition-only log (streak keeps growing on later slow ticks).
            if (streak === SLOW_AFTER_MISSES) {
              logger.warn(
                `${channel} still unreachable after ${streak} checks — slowing to one check per minute until it recovers.`,
              );
            }
          }
        }
      } catch (error) {
        logger.error(`Error while checking ${channel}:`, error);
      }
    }
  }

  while (monitoring) {
    await check();
    await new Promise((resolve) => setTimeout(resolve, BASE_POLL_MS));
  }
}
