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
  "INSERT INTO messageLog (channelId, userId, messageId, timestamp) VALUES (?, ?, ?, ?)"
);

export async function execute(message: Message) {
  try {
    // Ignore bot messages
    if (message.author?.bot) return;
    // NOTE: no per-message log here on purpose — this handler runs on EVERY
    // message, so logging would flood both stdout and bot.log. messageLog in
    // the DB already records what protect-room cleanup needs.

    if (!cleanupStarted) {
      cleanupStarted = true;
      setInterval(() => {
        try {
          // Delete rows older than 2 minutes (120,000 ms)
          const threshold = Date.now() - 120_000;
          stmtDeleteOldMessages.run(threshold);
        } catch (e) {
          logger.error("Failed to clean up messageLog:", e);
        }
      }, 5 * 60 * 1000); // run every 5 minutes
    }

    // Only process guild messages
    if (!message.guild || !message.channel.isTextBased()) return;

    // Log EVERY message from every user (for tracking)
    try {
      stmtInsertMessageLog.run(message.channelId, message.author.id, message.id, Date.now());
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
          const wanted = verMatch[1]?.trim() ?? "LIVE";
          const channel = ROBLOX_CHANNELS.includes(wanted as any) ? wanted : "LIVE";
          // Cached (30s) + WEAO fallback for LIVE — ?ver previously hit the
          // Roblox API on every call with no fallback.
          const version = await getRobloxVersion(channel);
          await message.reply(
            version
              ? `เวอร์ชันปัจจุบันของ \`${channel}\` คือ \`${version}\``
              : "❌ ไม่สามารถดึงข้อมูลเวอร์ชันได้ในตอนนี้ กรุณาลองใหม่ภายหลัง",
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
          // Creating an invite needs the Create Instant Invite permission.
          const botMember = await message.guild.members.fetchMe();
          if (!botMember.permissions.has(PermissionFlagsBits.CreateInstantInvite)) {
            await message.reply("❌ บอทไม่มีสิทธิ์ `Create Instant Invite` ในช่องนี้");
            return;
          }

          const invite = await (message.channel as any).createInvite({
            maxAge: 30 * 60, // Expire after 30 minutes (in seconds)
            maxUses: 1, // Maximum number of uses: 1
          });
          const reply = await message.reply(
            `🔗 ลิงก์เชิญ: ${invite.url}\n⏱️ หมดอายุใน **30 นาที** | ใช้ได้ **1 ครั้ง**\n_ข้อความนี้จะถูกลบอัตโนมัติ <t:${Math.floor((Date.now() + 30_000) / 1000)}:R>_`
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
          await message.reply("❌ ไม่สามารถสร้างลิงก์เชิญได้ กรุณาลองใหม่ภายหลัง");
        }
        return;
      }
    }

    if (!isProtected) return;

    // Channel is protected, ban the user and delete their recent messages
    try {
      // Get the guild member
      const member = message.member;
      if (!member) return;

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
          await message.member?.timeout(
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

          const target: ProtectRoomNoticeTarget = {
            guildId: message.guildId!,
            channelId: message.channelId,
            actionType: protectedRoom.actionType,
            noticeMessageId: protectedRoom.noticeMessageId,
          };
          await refreshProtectRoomNotice(message.channel, target, protectedRoom.actionCount + 1);
        } catch (err) {
          logger.error(`[PROTECT] Failed to update notice counter in guild ${message.guildId}:`, err);
        }
      } catch (error) {
        logger.error(`[PROTECT] Error applying ${protectedRoom.actionType} to ${message.author.tag}:`, error);
        // If the punish action failed, skip cleanup so we don't waste time.
        return;
      }

      // Now clean up messages. Use the local messageLog (which has been tracking
      // every message the user sends) to find messages they sent in the last
      // 1 minute across ALL channels — then delete from each channel where
      // they exist, within Discord's bulk-delete window (<= 14 days old).
      const oneMinuteMs = 60 * 1000;
      const oneMinuteAgo = Date.now() - oneMinuteMs;

      // Need ManageMessages to delete messages (same member as the action
      // permission check above — reuse it instead of fetching again).
      if (!botMember.permissions.has(PermissionFlagsBits.ManageMessages)) {
        logger.warn(
          `[PROTECT] Bot lacks ManageMessages permission in guild ${message.guildId} — cannot delete messages`
        );
      } else {
        // Pull messages from this user within the last 1 minute, across all channels
        const userMessages = db
          .prepare(
            "SELECT messageId, channelId FROM messageLog WHERE userId = ? AND timestamp >= ?"
          )
          .all(message.author.id, oneMinuteAgo) as { messageId: string; channelId: string }[];

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
            const channel: any = await message.guild.channels.fetch(channelId);
            if (!channel || !channel.isTextBased?.()) {
              logger.warn(
                `[PROTECT] Channel ${channelId} not text-based or not found, skipping`
              );
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

      // Clean up the DB logs for this user
      db.prepare("DELETE FROM messageLog WHERE userId = ?").run(message.author.id);
    } catch (error) {
      logger.error(
        `[PROTECT] Error handling protected room violation for ${message.author.tag}:`,
        error
      );
    }
  } catch (e) {
    // ignore
  }
}
