import {
  Message,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
} from "discord.js";
import db from "../../lib/db";
import logger from "../../lib/logger";
import { getProtectedRoom, invalidateProtectedRoom } from "../../lib/dbCache";
import {
  PROTECT_ACTION_META,
  refreshProtectRoomNotice,
  type ProtectAction,
  type ProtectRoomNoticeTarget,
} from "../../lib/protectRoom";
import {
  POST_PURGE_MS,
  PUNISH_GUARD_MS,
  postPurgeUntil,
  punishGuardUntil,
} from "./state";

/**
 * The protected-room (honeypot) punishment.
 *
 * A protected channel punishes ANY message, so this path takes priority over
 * the prefix commands.
 */

/** The parts of a protected room this handler needs. */
type ProtectedRoomRow = {
  actionType: ProtectAction;
  timeoutDuration: number;
  actionCount: number;
  noticeMessageId: string | null;
};

/** A guild channel that owns a message manager — the channels deletion works on. */
type MessageChannel = Guild["channels"]["cache"] extends Map<string, infer C>
  ? Extract<C, { messages: unknown }>
  : never;

/**
 * Delete the message on sight if the author was just punished.
 *
 * This covers the race where the offender keeps typing while the ban/timeout
 * API calls were still in flight.
 */
export async function applyPostPunishPurge(message: Message, scopeKey: string): Promise<void> {
  const purgeUntil = postPurgeUntil.get(scopeKey);
  if (purgeUntil === undefined) return;

  if (Date.now() < purgeUntil) {
    try {
      await message.delete();
    } catch {
      // Already gone or no permission — the normal flow handles the rest.
    }
  } else {
    postPurgeUntil.delete(scopeKey);
  }
}

/** Punish the author of a message sent in a protected room. */
export async function handleProtectedRoomViolation(
  message: Message,
  scopeKey: string,
): Promise<void> {
  try {
    // Get the guild member. message.member can be null when the member
    // isn't cached (e.g. GuildMembers intent off) — fetch before giving up
    // so the offender can't slip through silently.
    const member = await resolveMember(message);
    if (!member) {
      logger.warn(
        `[PROTECT] Could not resolve member ${message.author.tag} in guild ${message.guildId} — skipping punish`,
      );
      return;
    }

    const protectedRoom = claimPunishRight(message, member, scopeKey);
    if (!protectedRoom) return;

    // Check the bot has the right permission for the configured action
    const botMember = await message.guild!.members.fetchMe();
    const neededPerm = PROTECT_ACTION_META[protectedRoom.actionType].permission;
    if (!botMember.permissions.has(neededPerm)) {
      punishGuardUntil.delete(scopeKey);
      logger.warn(`[PROTECT] Bot lacks ${neededPerm} permission in guild ${message.guildId}`);
      return;
    }

    // Take action FIRST (ban/timeout before deleting messages) so the user is
    // punished immediately. Deleting messages afterwards is best-effort cleanup.
    const punished = await applyPunishment(message, member, protectedRoom, scopeKey);
    if (!punished) return;

    // Watch this user for 60s so messages that slipped through the
    // pre-punish SELECT (typed while the ban/timeout calls were in flight)
    // are deleted on sight by the check at the top of this handler.
    // Guild-scoped: never touches other servers. (The in-flight guard above
    // stays armed until it expires so duplicates can't double-count.)
    postPurgeUntil.set(scopeKey, Date.now() + POST_PURGE_MS);

    // Now clean up messages. Use the local messageLog (which has been tracking
    // every message the user sends) to find messages they sent in the last
    // 1 minute across ALL channels OF THIS GUILD — then delete from each
    // channel where they exist, within Discord's bulk-delete window
    // (<= 14 days old).
    await deleteRecentMessages(message, botMember);

    // Clean up this guild's DB logs for this user
    db.prepare("DELETE FROM messageLog WHERE guildId = ? AND userId = ?").run(
      message.guildId,
      message.author.id,
    );
  } catch (error) {
    logger.error(
      `[PROTECT] Error handling protected room violation for ${message.author.tag}:`,
      error,
    );
  }
}

/** Resolve the author as a guild member, fetching them if they are not cached. */
async function resolveMember(message: Message): Promise<GuildMember | null> {
  let member = message.member;
  if (!member) {
    try {
      member = await message.guild!.members.fetch(message.author.id);
    } catch {
      member = null;
    }
  }
  return member;
}

/**
 * Decide whether this message may be punished, and claim that right.
 *
 * Returns the protected-room settings when the punishment may go ahead, or
 * null when it must be skipped (staff member, punish already in flight).
 * Claiming the right is atomic — no await between the check and the set — so
 * two concurrent handlers cannot both slip through.
 */
function claimPunishRight(
  message: Message,
  member: GuildMember,
  scopeKey: string,
): ProtectedRoomRow | null {
  // Skip protection for Guild Owner or Administrator
  if (
    message.guild!.ownerId === message.author.id ||
    member.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    logger.info(
      `[PROTECT] Skipped protection for ${message.author.tag} in guild ${message.guildId}`,
    );
    return null;
  }

  // A second message from the same offender arriving while the first
  // punish is still in flight must not double-punish / double-count.
  // Cleared on every failure return below so a failed punish doesn't
  // suppress retries.
  const guardUntil = punishGuardUntil.get(scopeKey);
  if (guardUntil !== undefined && Date.now() < guardUntil) {
    logger.info(
      `[PROTECT] Punish already in flight for ${message.author.tag} in guild ${message.guildId} — skipping duplicate`,
    );
    return null;
  }
  punishGuardUntil.set(scopeKey, Date.now() + PUNISH_GUARD_MS);

  // Get protected room settings (from the DB cache — row was fetched
  // above for the isProtected check, so no extra query).
  return getProtectedRoom(message.guildId!, message.channelId)! as ProtectedRoomRow;
}

/**
 * Ban or time out the offender and refresh the notice counter.
 *
 * Returns false when the punishment itself failed — the caller must then stop
 * without deleting any messages.
 */
async function applyPunishment(
  message: Message,
  member: GuildMember,
  protectedRoom: ProtectedRoomRow,
  scopeKey: string,
): Promise<boolean> {
  let actionTaken = "skipped";
  try {
    if (protectedRoom.actionType === "timeout") {
      await member.timeout(
        protectedRoom.timeoutDuration,
        `[PROTECTED ROOM] Sent message in protected channel`,
      );
      actionTaken = `timed out (${protectedRoom.timeoutDuration / 60_000}m)`;
    } else {
      await message.guild!.members.ban(message.author.id, {
        reason: `[PROTECTED ROOM] Sent message in protected channel`,
      });
      actionTaken = "banned";
    }
  } catch (error) {
    punishGuardUntil.delete(scopeKey);
    logger.error(
      `[PROTECT] Error applying ${protectedRoom.actionType} to ${message.author.tag}:`,
      error,
    );
    // If the punish action failed, skip cleanup so we don't waste time.
    return false;
  }

  logger.info(
    `[PROTECT] ${actionTaken} ${message.author.tag} in guild ${message.guildId} for protected room violation.`,
  );

  // Increment the punishment counter and refresh the notice
  // message so the pill shows the updated total.
  await refreshNoticeCounter(message, protectedRoom);
  return true;
}

/** Bump the stored punishment count and repaint the notice message. */
async function refreshNoticeCounter(
  message: Message,
  protectedRoom: ProtectedRoomRow,
): Promise<void> {
  try {
    db.prepare(
      "UPDATE protectedRooms SET actionCount = actionCount + 1 WHERE guildId = ? AND channelId = ?",
    ).run(message.guildId, message.channelId);
    // actionCount changed — drop the cached row so /protectroom view
    // and the next message see the new count.
    invalidateProtectedRoom(message.guildId!, message.channelId);

    // Re-read instead of using the pre-punish cached value — a
    // concurrent punish may have incremented it in between.
    const fresh = db
      .prepare("SELECT actionCount, imageUrl FROM protectedRooms WHERE guildId = ? AND channelId = ?")
      .get(message.guildId, message.channelId) as
      | { actionCount: number; imageUrl: string | null }
      | undefined;
    const count = fresh?.actionCount ?? protectedRoom.actionCount + 1;

    const target: ProtectRoomNoticeTarget = {
      guildId: message.guildId!,
      channelId: message.channelId,
      actionType: protectedRoom.actionType,
      noticeMessageId: protectedRoom.noticeMessageId,
      imageUrl: fresh?.imageUrl ?? null,
    };
    await refreshProtectRoomNotice(message.channel, target, count);
  } catch (err) {
    logger.error(`[PROTECT] Failed to update notice counter in guild ${message.guildId}:`, err);
  }
}

/** Delete every message the offender sent in this guild in the last minute. */
async function deleteRecentMessages(message: Message, botMember: GuildMember): Promise<void> {
  const oneMinuteMs = 60 * 1000;
  const oneMinuteAgo = Date.now() - oneMinuteMs;

  // Pull this guild's messages from this user within the last 1 minute.
  const userMessages = db
    .prepare(
      "SELECT messageId, channelId FROM messageLog WHERE guildId = ? AND userId = ? AND timestamp >= ?",
    )
    .all(message.guildId, message.author.id, oneMinuteAgo) as {
    messageId: string;
    channelId: string;
  }[];

  logger.info(
    `[PROTECT] Found ${userMessages.length} messages from ${message.author.tag} in last 1 minute across all channels`,
  );

  // Group by channel — bulkDelete per channel
  const byChannel = new Map<string, string[]>();
  for (const m of userMessages) {
    if (!byChannel.has(m.channelId)) byChannel.set(m.channelId, []);
    byChannel.get(m.channelId)!.push(m.messageId);
  }

  let deletedCount = 0;
  for (const [channelId, ids] of byChannel) {
    try {
      const channel = await resolveMessageChannel(message.guild!, channelId);
      if (!channel) {
        logger.warn(`[PROTECT] Channel ${channelId} not text-based or not found, skipping`);
        continue;
      }
      // ManageMessages is channel-level (overwrites can differ per
      // channel), so check it here instead of once guild-wide.
      if (!channel.permissionsFor?.(botMember)?.has(PermissionFlagsBits.ManageMessages)) {
        logger.warn(
          `[PROTECT] Bot lacks ManageMessages in channel ${channelId} — skipping`,
        );
        continue;
      }
      deletedCount += await deleteFromChannel(channel, ids);
    } catch (e) {
      logger.error(`[PROTECT] Error deleting messages in channel ${channelId}:`, e);
    }
  }

  logger.info(
    `[PROTECT] Deleted ${deletedCount} messages total from ${message.author.tag} across all channels (last 1 min)`,
  );
}

/** Find the channel to delete from — the cache first, the API only as a fallback. */
async function resolveMessageChannel(
  guild: Guild,
  channelId: string,
): Promise<MessageChannel | null> {
  // Prefer the cache — channels.fetch hits the API every time.
  const cached = guild.channels.cache.get(channelId);
  const channel = cached ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel || !channel.isTextBased() || !("messages" in channel)) return null;
  return channel;
}

/** Delete the given message ids from one channel. Returns how many were removed. */
async function deleteFromChannel(channel: MessageChannel, ids: string[]): Promise<number> {
  // bulkDelete needs 2-100 messages — a single id always throws,
  // so delete it directly instead of wasting an API call.
  if (ids.length === 1) {
    return deleteOne(channel, ids[0]);
  }

  // Prefer bulkDelete; fall back to per-message delete
  if (typeof channel.bulkDelete === "function") {
    try {
      const bulk = await channel.bulkDelete(ids, true);
      logger.info(
        `[PROTECT] bulkDelete removed ${bulk.size} messages from channel ${channel.id}`,
      );
      return bulk.size;
    } catch (bulkErr) {
      logger.warn(
        `[PROTECT] bulkDelete failed on ${channel.id}, falling back to per-message delete:`,
        bulkErr,
      );
    }
  }

  let deletedCount = 0;
  for (const id of ids) {
    deletedCount += await deleteOne(channel, id);
  }
  return deletedCount;
}

/** Delete a single message, ignoring the "already gone" error. */
async function deleteOne(channel: MessageChannel, id: string): Promise<number> {
  try {
    await channel.messages.delete(id);
    return 1;
  } catch (delErr) {
    if (!isUnknownMessageError(delErr)) {
      logger.warn(`[PROTECT] delete ${id} failed:`, delErr);
    }
    return 0;
  }
}

/** Discord error code 10008 means the message is already gone — not a failure. */
function isUnknownMessageError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const { code } = error;
  return typeof code === "number" && code === 10008;
}
