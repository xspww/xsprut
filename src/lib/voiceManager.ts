import { joinVoiceChannel, VoiceConnection } from "@discordjs/voice";
import { client } from "./client";
import db from "./db";
import logger from "./logger";

// In-memory cooldown map to avoid repeated join attempts when the network is failing
const joinCooldownMs = 15 * 60 * 1000; // 15 minutes
const failedJoins = new Map<string, number>(); // guildId -> nextAllowedAttempt timestamp
let sweepTimer: NodeJS.Timeout | null = null;

// Drop expired entries so the map never grows unbounded. Runs on a lazy timer
// that is only started once a failure has been recorded.
function ensureFailedJoinsSweep() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [guildId, nextAllowed] of failedJoins) {
      if (nextAllowed <= now) failedJoins.delete(guildId);
    }
  }, 60_000);
  // Don't keep the process alive just for the sweeper.
  sweepTimer.unref?.();
}

function recordFailedJoin(guildId: string) {
  ensureFailedJoinsSweep();
  failedJoins.set(guildId, Date.now() + joinCooldownMs);
}

// joinVoiceChannel() returns the SAME connection object when called again for
// an already-connected guild, so without this guard the same connection would
// get duplicate error/stateChange handlers (double logs, double destroy).
const handledConnections = new WeakSet<VoiceConnection>();

export function attachVoiceConnectionHandlers(connection: VoiceConnection, guildId: string) {
  try {
    if (handledConnections.has(connection)) return;
    handledConnections.add(connection);
    // Prevent unhandled 'error' events from crashing the process
    connection.on("error", (err) => {
      logger.error(`Voice connection error in guild ${guildId}:`, err);
      try {
        // set cooldown to avoid reattempting immediately
        recordFailedJoin(guildId);
      } catch (e) {
        // ignore
      }
      try {
        connection.destroy();
      } catch (e) {
        // ignore
      }
    });

    connection.on("stateChange", (oldState, newState) => {
      try {
        logger.info(
          `Voice connection state change for guild ${guildId}: ${oldState.status} -> ${newState.status}`,
        );
      } catch (e) {
        // ignore
      }
    });
  } catch (e) {
    logger.warn(`Failed to attach voice handlers for guild ${guildId}:`, e);
  }
}

export async function joinBotVoiceChannel(guildId: string, voiceChannelId: string) {
  try {
    const nextAllowed = failedJoins.get(guildId) ?? 0;
    if (Date.now() < nextAllowed) {
      logger.warn(`Skipping join for guild ${guildId} due to recent failures; next attempt allowed at ${new Date(nextAllowed).toISOString()}`);
      return false;
    }

    const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId));
    if (!guild) return false;

    const channel = guild.channels.cache.get(voiceChannelId) ?? (await guild.channels.fetch(voiceChannelId));
    if (!channel || !channel.isVoiceBased()) return false;

    const connection = joinVoiceChannel({
      channelId: voiceChannelId,
      guildId: guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });

    // Attach handlers to avoid unhandled 'error' events from killing the process
    attachVoiceConnectionHandlers(connection, guildId);

    db.prepare(
      `
      INSERT INTO botVoiceChannels (guildId, voiceChannelId, enabled)
      VALUES (?, ?, 1)
      ON CONFLICT(guildId)
      DO UPDATE SET voiceChannelId = excluded.voiceChannelId, enabled = 1
      `,
    ).run(guildId, voiceChannelId);

    return true;
  } catch (error: any) {
    logger.error(`Failed to join voice channel ${voiceChannelId} in guild ${guildId}:`, error);
    // set cooldown so we don't spam join attempts
    try {
      recordFailedJoin(guildId);
    } catch (e) {
      // ignore
    }
    return false;
  }
}

export async function reconnectAllVoiceChannels() {
  const configs = db
    .prepare(
      `
      SELECT guildId, voiceChannelId
      FROM botVoiceChannels
      WHERE enabled = 1
      `,
    )
    .all() as { guildId: string; voiceChannelId: string }[];

  for (const config of configs) {
    await joinBotVoiceChannel(config.guildId, config.voiceChannelId);
  }
}

