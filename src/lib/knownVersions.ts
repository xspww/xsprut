import type { Database } from "better-sqlite3";
import {
  KNOWN_VERSIONS_MAX_PER_CHANNEL,
  KNOWN_VERSIONS_RETENTION_MS,
} from "./constants";

// Prunes the append-only knownVersions table so it can't grow forever.
// Lives in its own side-effect-free module (no DB opened here) so it can be
// unit-tested against an in-memory database — callers pass the handle in.
//
// Two passes: (1) drop rows older than the retention window, (2) enforce a
// per-channel cap keeping the newest rows. Returns the total deleted count.
export function pruneKnownVersions(
  handle: Database,
  now: number = Date.now(),
  retentionMs: number = KNOWN_VERSIONS_RETENTION_MS,
  maxPerChannel: number = KNOWN_VERSIONS_MAX_PER_CHANNEL,
): { deleted: number } {
  const byAge = handle
    .prepare(`DELETE FROM knownVersions WHERE detectedAt < ?`)
    .run(now - retentionMs);

  const channels = handle
    .prepare(`SELECT DISTINCT robloxChannel FROM knownVersions`)
    .all() as { robloxChannel: string }[];
  const capStmt = handle.prepare(
    `DELETE FROM knownVersions
     WHERE robloxChannel = ?
     AND id NOT IN (
       SELECT id FROM knownVersions
       WHERE robloxChannel = ?
       ORDER BY detectedAt DESC, id DESC
       LIMIT ?
     )`,
  );

  let capped = 0;
  for (const { robloxChannel } of channels) {
    capped += Number(capStmt.run(robloxChannel, robloxChannel, maxPerChannel).changes);
  }

  return { deleted: Number(byAge.changes) + capped };
}
