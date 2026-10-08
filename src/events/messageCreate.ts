import { Events, Message, PermissionFlagsBits } from "discord.js";
import db from "../lib/db";
import logger from "../lib/logger";
import config from "../lib/config";
import { checkCooldown } from "../lib/cooldown";
import { getProtectedRoom, invalidateProtectedRoom } from "../lib/dbCache";
import { ROBLOX_CHANNELS } from "../lib/constants";
import { getRobloxVersion } from "../lib/robloxVersion";
import {
  PROTECT_ACTION_META,
  refreshProtectRoomNotice,
  type ProtectAction,
  type ProtectRoomNoticeTarget,
} from "../lib/protectRoom";

export const name = Events.MessageCreate;

let cleanupStarted = false;

// Cache the hot prepared statements — this handler runs for EVERY message, so
// re-preparing on each call creates avoidable native allocations (GC pressure).
// (db.prepare is also memoized globally in src/lib/db.ts.)
const stmtDeleteOldMessages = db.prepare("DELETE FROM messageLog WHERE timestamp < ?");
const stmtInsertMessageLog = db.prepare(
  "INSERT INTO messageLog (guildId, channelId, userId, messageId, timestamp) VALUES (?, ?, ?, ?, ?)"
);

// Post-punish purge: userIds whose messages are deleted on sight for 60s
// after a punishment. Covers the race where the offender keeps typing while
// the ban/timeout API calls are still in flight (after the pre-punish SELECT
// below has already run), plus anything they send right after. In-memory is
// enough — the window is only 1 minute, so losing it on restart is harmless.
const postPurgeUntil = new Map<string, number>();
const POST_PURGE_MS = 60_000;

// In-flight punish guard: `${guildId}:${userId}` -> guard expiry. Two messages
// from the same offender arriving at once must not double-punish (double
// timeout / double counter). Self-expiring after 30s so no finally-block is
// needed — a banned user is gone and a timed-out user cannot speak anyway.
const punishGuardUntil = new Map<string, number>();
const PUNISH_GUARD_MS = 30_000;

export async function execute(message: Message) {
  try {
    // Ignore bot messages
    if (message.author?.bot) return;
    // NOTE: no per-message log here on purpose — this handler runs on EVERY
    // message, so logging would flood both stdout and bot.log. messageLog in
    // the DB already records what protect-room cleanup needs.

    if (!cleanupStarted) {
      cleanupStarted = true;
      const sweepTimer = setInterval(() => {
        try {
          // Delete rows older than 2 minutes (120,000 ms)
          const threshold = Date.now() - 120_000;
          stmtDeleteOldMessages.run(threshold);
        } catch (e) {
          logger.error("Failed to clean up messageLog:", e);
        }
        // Drop expired post-punish purge + punish-guard entries so the maps can't grow.
        try {
          const now = Date.now();
          for (const [key, until] of postPurgeUntil) {
            if (until <= now) postPurgeUntil.delete(key);
          }
          for (const [key, until] of punishGuardUntil) {
            if (until <= now) punishGuardUntil.delete(key);
          }
        } catch {
          // ignore
        }
      }, 5 * 60 * 1000); // run every 5 minutes
      sweepTimer.unref?.();
    }

    // Only process guild messages
    if (!message.guild || !message.channel.isTextBased()) return;

    // Guild-scoped keys — a punishment in one server must never touch another.
    const scopeKey = `${message.guildId}:${message.author.id}`;

    // Post-punish purge window: this user was just punished — delete their
    // messages on sight in ANY channel of this guild. Best-effort (needs
    // Manage Messages). Falls through to the normal flow below so protection
    // re-triggers if the original punish failed.
    const purgeUntil = postPurgeUntil.get(scopeKey);
    if (purgeUntil !== undefined) {
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

    // Log EVERY message from every user (for tracking)
    try {
      stmtInsertMessageLog.run(message.guildId, message.channelId, message.author.id, message.id, Date.now());
    } catch (e) {
      // Message might already be logged, ignore
    }

    // The protected-room (honeypot) check must take priority over ?ver — the
    // channel's purpose is to punish ANY message, so ?ver must not bypass it.
    // Served from the DB cache (see src/lib/dbCache.ts) since this runs on
    // EVERY message.
    const isProtected = getProtectedRoom(message.guildId!, message.channelId);

    // Public ?ver — view the current Roblox version without a slash command.
    // Everyone can use it in normal channels; just type "?ver" (optionally
    // "?ver ZBeta"). Never answers in a protected room.
    if (!isProtected) {
      const verMatch = message.content.match(/^\?ver(?:\s+(.+))?$/i);
      if (verMatch) {
        // Anti-spam: ?ver hits the Roblox API every time, so limit each user
        // to one call per cooldown window. Silently ignore repeats.
        if (checkCooldown(`ver:${message.author.id}`, config.COMMAND_COOLDOWN_MS) > 0) {
          return;
        }
        try {
          const wantedRaw = verMatch[1]?.trim() ?? "LIVE";
          const channel = (ROBLOX_CHANNELS as readonly string[]).find(
            (c) => c.toLowerCase() === wantedRaw.toLowerCase(),
          );
          if (!channel) {
            await message.reply(
              `❌ Unknown channel \`${wantedRaw}\`. Available: ${ROBLOX_CHANNELS.map((c) => `\`${c}\``).join(", ")}`,
            );
            return;
          }
          // Cached (30s) + WEAO fallback for LIVE — ?ver previously hit the
          // Roblox API on every call with no fallback.
          const version = await getRobloxVersion(channel);
          await message.reply(
            version
              ? `Current version of \`${channel}\` is \`${version}\``
              : "❌ Could not fetch version info right now, please try again later",
          );
        } catch (error) {
          logger.error("[VER] Failed to handle ?ver:", error);
        }
        return;
      }

      // Public ?inv — create a temporary invite link for the current channel.
      // The link expires after 30 minutes and works for only 1 use.
      if (/^\?inv\s*$/i.test(message.content)) {
        // Anti-spam: one invite per user per cooldown window (same as ?ver).
        if (checkCooldown(`inv:${message.author.id}`, config.COMMAND_COOLDOWN_MS) > 0) {
          return;
        }
        try {
          // Creating an invite needs Create Instant Invite IN THIS CHANNEL —
          // check the channel overwrite-resolved permissions, not the
          // guild-wide ones (they can differ per channel).
          const botMember = await message.guild.members.fetchMe();
          const channelPerms = (message.channel as any).permissionsFor?.(botMember);
          if (!channelPerms?.has(PermissionFlagsBits.CreateInstantInvite)) {
            await message.reply("❌ The bot lacks the `Create Instant Invite` permission in this channel");
            return;
          }

          const invite = await (message.channel as any).createInvite({
            maxAge: 30 * 60, // Expire after 30 minutes (in seconds)
            maxUses: 1, // Maximum number of uses: 1
          });
          const reply = await message.reply(
            `🔗 Invite link: ${invite.url}\n⏱️ Expires in **30 minutes** | **1 use**\n_This message will be auto-deleted <t:${Math.floor((Date.now() + 30_000) / 1000)}:R>_`
          );
          // Auto-delete the reply AND the command message after 30s so the
          // invite link doesn't linger in chat. Deleting another user's
          // message needs Manage Messages — if that fails it's best-effort.
          const timer = setTimeout(async () => {
            try {
              await reply.delete();
            } catch {
              // Reply already gone — fine.
            }
            try {
              await message.delete();
            } catch {
              // Command message already gone, or bot lacks Manage Messages — fine.
            }
          }, 30_000);
          timer.unref?.();
        } catch (error) {
          logger.error("[INV] Failed to handle ?inv:", error);
          await message.reply("❌ Could not create an invite link, please try again later");
        }
        return;
      }
    }

    if (!isProtected) return;

    // Channel is protected, ban the user and delete their recent messages
    try {
      // Get the guild member. message.member can be null when the member
      // isn't cached (e.g. GuildMembers intent off) — fetch before giving up
      // so the offender can't slip through silently.
      let member = message.member;
      if (!member) {
        try {
          member = await message.guild.members.fetch(message.author.id);
        } catch {
          member = null;
        }
      }
      if (!member) {
        logger.warn(
          `[PROTECT] Could not resolve member ${message.author.tag} in guild ${message.guildId} — skipping punish`
        );
        return;
      }

      // Skip protection for Guild Owner or Administrator
      if (
        message.guild.ownerId === message.author.id ||
        member.permissions.has(PermissionFlagsBits.Administrator)
      ) {
        logger.info(
          `[PROTECT] Skipped protection for ${message.author.tag} in guild ${message.guildId}`
        );
        return;
      }

      // A second message from the same offender arriving while the first
      // punish is still in flight must not double-punish / double-count.
      // Check-AND-set here is atomic (no await between them), so two
      // concurrent handlers can't both slip through. Cleared on every
      // failure return below so a failed punish doesn't suppress retries.
      const guardUntil = punishGuardUntil.get(scopeKey);
      if (guardUntil !== undefined && Date.now() < guardUntil) {
        logger.info(
          `[PROTECT] Punish already in flight for ${message.author.tag} in guild ${message.guildId} — skipping duplicate`
        );
        return;
      }
      punishGuardUntil.set(scopeKey, Date.now() + PUNISH_GUARD_MS);

      // Get protected room settings (from the DB cache — row was fetched
      // above for the isProtected check, so no extra query).
      const protectedRoom = getProtectedRoom(message.guildId!, message.channelId)! as {
        actionType: ProtectAction;
        timeoutDuration: number;
        actionCount: number;
        noticeMessageId: string | null;
      };

      // Check the bot has the right permission for the configured action
      const botMember = await message.guild.members.fetchMe();
      const neededPerm = PROTECT_ACTION_META[protectedRoom.actionType].permission;
      if (!botMember.permissions.has(neededPerm)) {
        punishGuardUntil.delete(scopeKey);
        logger.warn(
          `[PROTECT] Bot lacks ${neededPerm} permission in guild ${message.guildId}`
        );
        return;
      }

      // Take action FIRST (ban/timeout before deleting messages) so the user is
      // punished immediately. Deleting messages afterwards is best-effort cleanup.
      let actionTaken = "skipped";
      try {
        if (protectedRoom.actionType === "timeout") {
          // Apply timeout
          await member.timeout(
            protectedRoom.timeoutDuration,
            `[PROTECTED ROOM] Sent message in protected channel`
          );
          actionTaken = `timed out (${protectedRoom.timeoutDuration / 60_000}m)`;
        } else {
          // Ban the user
          await message.guild.members.ban(message.author.id, {
            reason: `[PROTECTED ROOM] Sent message in protected channel`,
          });
          actionTaken = "banned";
        }
        logger.info(
          `[PROTECT] ${actionTaken} ${message.author.tag} in guild ${message.guildId} for protected room violation.`
        );

        // Increment the punishment counter and refresh the notice
        // message so the pill shows the updated total.
        try {
          db.prepare(
            "UPDATE protectedRooms SET actionCount = actionCount + 1 WHERE guildId = ? AND channelId = ?"
          ).run(message.guildId, message.channelId);
          // actionCount changed — drop the cached row so /protectroom view
          // and the next message see the new count.
          invalidateProtectedRoom(message.guildId!, message.channelId);

          // Re-read instead of using the pre-punish cached value — a
          // concurrent punish may have incremented it in between.
          const fresh = db
            .prepare("SELECT actionCount FROM protectedRooms WHERE guildId = ? AND channelId = ?")
            .get(message.guildId, message.channelId) as { actionCount: number } | undefined;
          const count = fresh?.actionCount ?? protectedRoom.actionCount + 1;

          const target: ProtectRoomNoticeTarget = {
            guildId: message.guildId!,
            channelId: message.channelId,
            actionType: protectedRoom.actionType,
            noticeMessageId: protectedRoom.noticeMessageId,
          };
          await refreshProtectRoomNotice(message.channel, target, count);
        } catch (err) {
          logger.error(`[PROTECT] Failed to update notice counter in guild ${message.guildId}:`, err);
        }
      } catch (error) {
        punishGuardUntil.delete(scopeKey);
        logger.error(`[PROTECT] Error applying ${protectedRoom.actionType} to ${message.author.tag}:`, error);
        // If the punish action failed, skip cleanup so we don't waste time.
        return;
      }

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
      const oneMinuteMs = 60 * 1000;
      const oneMinuteAgo = Date.now() - oneMinuteMs;

      {
        // Pull this guild's messages from this user within the last 1 minute.
        const userMessages = db
          .prepare(
            "SELECT messageId, channelId FROM messageLog WHERE guildId = ? AND userId = ? AND timestamp >= ?"
          )
          .all(message.guildId, message.author.id, oneMinuteAgo) as { messageId: string; channelId: string }[];

        logger.info(
          `[PROTECT] Found ${userMessages.length} messages from ${message.author.tag} in last 1 minute across all channels`
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
            // Prefer the cache — channels.fetch hits the API every time.
            const channel: any =
              message.guild.channels.cache.get(channelId) ??
              (await message.guild.channels.fetch(channelId).catch(() => null));
            if (!channel || !channel.isTextBased?.()) {
              logger.warn(
                `[PROTECT] Channel ${channelId} not text-based or not found, skipping`
              );
              continue;
            }
            // ManageMessages is channel-level (overwrites can differ per
            // channel), so check it here instead of once guild-wide.
            if (!channel.permissionsFor?.(botMember)?.has(PermissionFlagsBits.ManageMessages)) {
              logger.warn(
                `[PROTECT] Bot lacks ManageMessages in channel ${channelId} — skipping`
              );
              continue;
            }
            // bulkDelete needs 2-100 messages — a single id always throws,
            // so delete it directly instead of wasting an API call.
            if (ids.length === 1) {
              try {
                await channel.messages.delete(ids[0]);
                deletedCount++;
              } catch (delErr: any) {
                if (delErr?.code !== 10008) {
                  logger.warn(`[PROTECT] delete ${ids[0]} failed:`, delErr);
                }
              }
              continue;
            }
            // Prefer bulkDelete; fall back to per-message delete
            if (typeof channel.bulkDelete === "function") {
              try {
                const bulk = await channel.bulkDelete(ids, true);
                deletedCount += bulk.size;
                logger.info(
                  `[PROTECT] bulkDelete removed ${bulk.size} messages from channel ${channelId}`
                );
              } catch (bulkErr) {
                logger.warn(
                  `[PROTECT] bulkDelete failed on ${channelId}, falling back to per-message delete:`,
                  bulkErr
                );
                for (const id of ids) {
                  try {
                    await channel.messages.delete(id);
                    deletedCount++;
                  } catch (delErr: any) {
                    if (delErr?.code !== 10008) {
                      logger.warn(
                        `[PROTECT] delete ${id} failed:`,
                        delErr
                      );
                    }
                  }
                }
              }
            } else {
              for (const id of ids) {
                try {
                  await channel.messages.delete(id);
                  deletedCount++;
                } catch (delErr: any) {
                  if (delErr?.code !== 10008) {
                    logger.warn(`[PROTECT] delete ${id} failed:`, delErr);
                  }
                }
              }
            }
          } catch (e) {
            logger.error(
              `[PROTECT] Error deleting messages in channel ${channelId}:`,
              e
            );
          }
        }

        logger.info(
          `[PROTECT] Deleted ${deletedCount} messages total from ${message.author.tag} across all channels (last 1 min)`
        );
      }

      // Clean up this guild's DB logs for this user
      db.prepare("DELETE FROM messageLog WHERE guildId = ? AND userId = ?").run(message.guildId, message.author.id);
    } catch (error) {
      logger.error(
        `[PROTECT] Error handling protected room violation for ${message.author.tag}:`,
        error
      );
    }
  } catch (e) {
    logger.error("[messageCreate] Unhandled error in message handler:", e);
  }
}
