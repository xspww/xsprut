import db from "./db";
import { TTLCache } from "./cache";

/**
 * Database Caching — serves hot read paths from RAM instead of hitting SQLite
 * on every call.
 *
 * better-sqlite3 is synchronous and fast, but the hottest queries (every
 * incoming message, every 10s monitoring tick, every executor update check)
 * run far more often than the underlying data changes. Each cached helper
 * keeps a short TTL as a safety net, and every write site calls the matching
 * `invalidate*` function so the DB stays the source of truth and reads never
 * go stale for more than the invalidation call.
 */

// ─── protectedRooms ────────────────────────────────────────────────────────
// Hot path: checked on EVERY message (src/events/messageCreate.ts).
export type ProtectedRoomRow = {
  actionType: string;
  timeoutDuration: number;
  actionCount: number;
  noticeMessageId: string | null;
};

const protectedRoomsCache = new TTLCache<string, ProtectedRoomRow | null>(5_000);

const stmtGetProtectedRoom = db.prepare(
  `SELECT actionType, timeoutDuration, actionCount, noticeMessageId
   FROM protectedRooms WHERE guildId = ? AND channelId = ?`,
);

/** Look up a protected room (or null). Cached 5s + invalidated on every write. */
export function getProtectedRoom(guildId: string, channelId: string): ProtectedRoomRow | null {
  const key = `${guildId}:${channelId}`;
  let row = protectedRoomsCache.get(key);
  if (row === undefined) {
    row = (stmtGetProtectedRoom.get(guildId, channelId) as ProtectedRoomRow | undefined) ?? null;
    protectedRoomsCache.set(key, row);
  }
  return row;
}

/** Call after any INSERT/UPDATE/DELETE touching protectedRooms. */
export function invalidateProtectedRoom(guildId: string, channelId: string): void {
  protectedRoomsCache.delete(`${guildId}:${channelId}`);
}

// ─── alerts (Roblox update alert config) ───────────────────────────────────
// Hot path: read on every update detection / alert send.
export type AlertRow = { channelId: string; customContent: string };

const alertsCache = new TTLCache<string, AlertRow[]>(10_000);

const stmtGetAlertsAll = db.prepare(
  `SELECT channelId, customContent FROM alerts WHERE robloxChannel = ? AND enabled = 1`,
);
const stmtGetAlertsGuild = db.prepare(
  `SELECT channelId, customContent FROM alerts WHERE robloxChannel = ? AND guildId = ? AND enabled = 1`,
);

/** List alert channels for a Roblox channel (optionally scoped to a guild). */
export function getAlerts(channel: string, guildId?: string): AlertRow[] {
  const key = guildId ? `${channel}|${guildId}` : channel;
  let rows = alertsCache.get(key);
  if (rows === undefined) {
    rows = (guildId
      ? stmtGetAlertsGuild.all(channel, guildId)
      : stmtGetAlertsAll.all(channel)) as AlertRow[];
    alertsCache.set(key, rows);
  }
  return rows;
}

/** Call after any INSERT/UPDATE/DELETE touching alerts. */
export function invalidateAlerts(): void {
  alertsCache.clear();
}

// ─── knownVersions ─────────────────────────────────────────────────────────
// Append-only in practice (INSERT OR IGNORE); we still invalidate on insert so
// a cached "not seen yet" can never linger.
const knownVersionsCache = new TTLCache<string, boolean>(60_000);

const stmtHasVersion = db.prepare(
  `SELECT 1 FROM knownVersions WHERE hash = ? AND robloxChannel = ?`,
);

/** Has this version hash been recorded for this Roblox channel? */
export function hasVersion(hash: string, channel: string): boolean {
  const key = `${channel}:${hash}`;
  let exists = knownVersionsCache.get(key);
  if (exists === undefined) {
    exists = !!stmtHasVersion.get(hash, channel);
    knownVersionsCache.set(key, exists);
  }
  return exists;
}

/** Call after INSERTing a new knownVersions row. */
export function invalidateVersion(hash: string, channel: string): void {
  knownVersionsCache.delete(`${channel}:${hash}`);
}

/** Call after mass-deleting knownVersions rows (prune) — drops all entries. */
export function invalidateKnownVersionsCache(): void {
  knownVersionsCache.clear();
}

// ─── channelState ──────────────────────────────────────────────────────────
// Read every 10s per Roblox channel (plus once per 60s voice/chat tick);
// invalidated on every write.
export type ChannelStateRow = {
  currentVersion: string;
  previousVersion: string | null;
  /** Numeric Roblox version (e.g. "0.737.0.7371584") — null when unknown. */
  version: string | null;
};

const channelStateCache = new TTLCache<string, ChannelStateRow | null>(9_000);

const stmtGetChannelState = db.prepare(
  `SELECT currentVersion, previousVersion, version FROM channelState WHERE robloxChannel = ?`,
);

export function getChannelState(channel: string): ChannelStateRow | null {
  let row = channelStateCache.get(channel);
  if (row === undefined) {
    row = (stmtGetChannelState.get(channel) as ChannelStateRow | undefined) ?? null;
    channelStateCache.set(channel, row);
  }
  return row;
}

/** Call after writing channelState. */
export function invalidateChannelState(channel: string): void {
  channelStateCache.delete(channel);
}

// ─── executorLastState ─────────────────────────────────────────────────────
// Hot path: one read per executor on every 60s monitoring tick.
export type ExecutorLastStateRow = {
  version: string | null;
  status: string;
  lastAlertedVersion: string | null;
};

const executorLastStateCache = new TTLCache<string, ExecutorLastStateRow | null>(30_000);

const stmtGetExecutorLastState = db.prepare(
  `SELECT version, status, lastAlertedVersion FROM executorLastState WHERE title = ?`,
);

export function getExecutorLastState(title: string): ExecutorLastStateRow | null {
  let row = executorLastStateCache.get(title);
  if (row === undefined) {
    row = (stmtGetExecutorLastState.get(title) as ExecutorLastStateRow | undefined) ?? null;
    executorLastStateCache.set(title, row);
  }
  return row;
}

/** Call after any write to executorLastState. */
export function invalidateExecutorLastState(title: string): void {
  executorLastStateCache.delete(title);
}

// ─── executorAlerts ────────────────────────────────────────────────────────
// Read on every executor update detection (per matching executor).
export type ExecutorAlertRow = {
  channelId: string;
  displayName: string;
  customContent?: string;
};

const executorAlertsCache = new TTLCache<string, ExecutorAlertRow[]>(30_000);

const stmtGetExecutorAlerts = db.prepare(
  `SELECT channelId, displayName, customContent FROM executorAlerts
   WHERE LOWER(executorName) = ? AND enabled = 1`,
);
const stmtGetExecutorAlertsGuild = db.prepare(
  `SELECT channelId, displayName, customContent FROM executorAlerts
   WHERE LOWER(executorName) = ? AND enabled = 1 AND guildId = ?`,
);

/** List executor-alert channels for a normalized executor name. */
export function getExecutorAlerts(searchName: string, guildId?: string): ExecutorAlertRow[] {
  const key = guildId ? `${searchName}|${guildId}` : searchName;
  let rows = executorAlertsCache.get(key);
  if (rows === undefined) {
    rows = (guildId
      ? stmtGetExecutorAlertsGuild.all(searchName, guildId)
      : stmtGetExecutorAlerts.all(searchName)) as ExecutorAlertRow[];
    executorAlertsCache.set(key, rows);
  }
  return rows;
}

/** Call after any write to executorAlerts (add / remove / edit / auto-delete). */
export function invalidateExecutorAlerts(): void {
  executorAlertsCache.clear();
}

/** Drop every cache — used by the guild cleanup after mass deletes. */
export function clearDbCaches(): void {
  protectedRoomsCache.clear();
  alertsCache.clear();
  knownVersionsCache.clear();
  channelStateCache.clear();
  executorLastStateCache.clear();
  executorAlertsCache.clear();
}
