import { Events, Message } from "discord.js";
import logger from "../lib/logger";
import { getProtectedRoom } from "../lib/dbCache";
import { handlePrefixCommand } from "./messageCreate/prefix";
import { applyPostPunishPurge, handleProtectedRoomViolation } from "./messageCreate/protect";
import { ensureCleanupTimer, logMessage } from "./messageCreate/state";

export const name = Events.MessageCreate;

export async function execute(message: Message) {
  try {
    // Ignore bot messages
    if (message.author?.bot) return;
    // NOTE: no per-message log here on purpose — this handler runs on EVERY
    // message, so logging would flood both stdout and bot.log. messageLog in
    // the DB already records what protect-room cleanup needs.

    ensureCleanupTimer();

    // Only process guild messages
    if (!message.guild || !message.channel.isTextBased()) return;

    // Guild-scoped keys — a punishment in one server must never touch another.
    const scopeKey = `${message.guildId}:${message.author.id}`;

    await applyPostPunishPurge(message, scopeKey);

    logMessage(message);

    // The protected-room (honeypot) check must take priority over ?ver — the
    // channel's purpose is to punish ANY message, so ?ver must not bypass it.
    // Served from the DB cache (see src/lib/dbCache.ts) since this runs on
    // EVERY message.
    const isProtected = getProtectedRoom(message.guildId!, message.channelId);

    if (!isProtected) {
      await handlePrefixCommand(message);
      return;
    }

    await handleProtectedRoomViolation(message, scopeKey);
  } catch (e) {
    logger.error("[messageCreate] Unhandled error in message handler:", e);
  }
}
