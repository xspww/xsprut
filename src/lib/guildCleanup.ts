import { getVoiceConnection } from "@discordjs/voice";
import { client } from "./client";
import db from "./db";
import logger from "./logger";
import { clearDbCaches } from "./dbCache";

// Every per-guild table and its guild column. Global tables (botStatus,
// knownVersions, channelState, executorLastState) and messageLog (keyed by
// channelId only) are intentionally excluded.
export const GUILD_TABLES: { table: string; guildColumn: string }[] = [
  { table: "alerts", guildColumn: "guildId" },
  { table: "executorStatusChannels", guildColumn: "guildId" },
  { table: "executorAlerts", guildColumn: "guildId" },
  { table: "executorChatStatusChannels", guildColumn: "guildId" },
  { table: "executorEmbedStatusChannels", guildColumn: "guildId" },
  { table: "botVoiceChannels", guildColumn: "guildId" },
  { table: "botChatChannels", guildColumn: "guildId" },
  { table: "memberJoinAlerts", guildColumn: "guildId" },
  { table: "protectedRooms", guildColumn: "guildId" },
  { table: "verificationConfig", guildColumn: "guildId" },
  { table: "allowedBots", guildColumn: "guildId" },
];

export function collectGuildsWithData(dbase = db): Set<string> {
  const guilds = new Set<string>();
  for (const { table, guildColumn } of GUILD_TABLES) {
    const rows = dbase.prepare(`SELECT DISTINCT ${guildColumn} AS gid FROM ${table}`).all() as { gid: string }[];
    for (const row of rows) guilds.add(row.gid);
  }
  return guilds;
}

export function deleteGuildData(guildIds: string[], dbase = db): number {
  let deleted = 0;
  for (const guildId of guildIds) {
    for (const { table, guildColumn } of GUILD_TABLES) {
      try {
        deleted += dbase.prepare(`DELETE FROM ${table} WHERE ${guildColumn} = ?`).run(guildId).changes;
      } catch (e) {
        logger.error(`Failed to delete ${table} rows for guild ${guildId}:`, e);
      }
    }
  }
  return deleted;
}

/**
 * Returns guild IDs that still have DB data but that the bot is no longer a
 * member of (kicked / left). Pure function — testable without a live client.
 */
export function collectKickedGuilds(memberGuildIds: Iterable<string>, dbase = db): string[] {
  const memberOf = new Set(memberGuildIds);
  const kicked: string[] = [];
  for (const guildId of collectGuildsWithData(dbase)) {
    if (!memberOf.has(guildId)) kicked.push(guildId);
  }
  return kicked;
}

/**
 * Full-auto guild cleanup: wipes per-guild DB data for any guild the bot is
 * no longer a member of (kicked/left), regardless of DISCORD_GUILD_ID.
 * Runs at boot. Safety guard: if the bot is in zero guilds at ready time
 * (unexpected state), skip to avoid nuking all data.
 */
export function cleanupOrphanedGuilds(): string[] {
  if (client.guilds.cache.size === 0) {
    logger.warn("Guild cleanup: bot is in 0 guilds at ready — skipping cleanup to avoid wiping all data.");
    return [];
  }

  const orphaned = collectKickedGuilds(client.guilds.cache.keys());
  for (const guildId of orphaned) {
    // Best-effort: leave any lingering voice connection for this guild
    try {
      const conn = getVoiceConnection(guildId);
      if (conn) conn.destroy();
    } catch {}

    logger.info(`Guild cleanup: bot is no longer in guild ${guildId} (kicked) — wiping its data.`);
  }

  deleteGuildData(orphaned);
  // Mass deletes touched several cached tables — drop every cached row so the
  // next read goes back to the (already updated) DB.
  clearDbCaches();

  if (orphaned.length > 0) {
    logger.info(`Guild cleanup: removed data for ${orphaned.length} guild(s): ${orphaned.join(", ")}`);
  }
  return orphaned;
}
