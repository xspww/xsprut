import { Events } from "discord.js";
import logger from "../lib/logger";
import { startMonitoring } from "../monitoring";
import { startExecutorStatusMonitoring } from "../monitoring/executorStatus";
import { reconnectAllVoiceChannels } from "../lib/voiceManager";
import { loadBotStatusOnBoot } from "../lib/presenceManager";
import { cleanupOrphanedGuilds } from "../lib/guildCleanup";
import db from "../lib/db";
import { pruneKnownVersions } from "../lib/knownVersions";
import { invalidateKnownVersionsCache } from "../lib/dbCache";
import { KNOWN_VERSIONS_PRUNE_INTERVAL_MS } from "../lib/constants";

function runKnownVersionsPrune() {
  try {
    const { deleted } = pruneKnownVersions(db);
    // The hasVersion cache may hold entries for rows that no longer exist.
    invalidateKnownVersionsCache();
    if (deleted > 0) logger.info(`Pruned ${deleted} old knownVersions rows`);
  } catch (e) {
    logger.error("Error pruning knownVersions:", e);
  }
}

export const name = Events.ClientReady;
export const once = true;

export async function execute(...args: any[]) {
  try {
    logger.info("Logged into Discord bot!");
    const client = args[0];
    try {
      logger.info(`Bot user: ${client?.user?.tag ?? 'unknown'} (${client?.user?.id ?? 'unknown id'})`);
    } catch {}

    // Full-auto cleanup: wipe DB data for any guild the bot is no longer a
    // member of (kicked/left), before monitoring starts so removed guilds are
    // not re-managed. Membership-based — no DISCORD_GUILD_ID needed.
    try {
      cleanupOrphanedGuilds();
    } catch (e) {
      logger.error('Error in guild cleanup:', e);
    }

    // Bound the append-only knownVersions table (90d / 500-per-channel),
    // then keep pruning on a 6h interval so it can't grow forever.
    runKnownVersionsPrune();
    setInterval(runKnownVersionsPrune, KNOWN_VERSIONS_PRUNE_INTERVAL_MS);

    startMonitoring();
    startExecutorStatusMonitoring();
    await reconnectAllVoiceChannels();
    loadBotStatusOnBoot();
  } catch (e) {
    logger.error('Error in ClientReady handler:', e);
  }
}
