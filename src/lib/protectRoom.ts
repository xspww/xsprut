import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  TextDisplayBuilder,
  type TextBasedChannel,
} from "discord.js";
import db from "./db";
import logger from "./logger";
import { invalidateProtectedRoom } from "./dbCache";

/**
 * Helpers for the protected-room "notice" message.
 *
 * The notice is a Components v2 container that renders like the reference
 * design — one dark box containing:
 *   - a bold title ("DO NOT SEND MESSAGES IN THIS CHANNEL")
 *   - a body line explaining the punishment
 *   - a disabled gray pill at the bottom showing how many people have been
 *     punished so far (e.g. "Kicks: 42" / "Timeouts: 42")
 */

/** The punishment applied to users who post in a protected room. */
export type ProtectAction = "ban" | "timeout";

/** Everything the notice refresh needs to find and update its message. */
export interface ProtectRoomNoticeTarget {
  guildId: string;
  channelId: string;
  actionType: ProtectAction;
  noticeMessageId: string | null;
}

/** Per-action metadata: counter label, embed text, Thai display name, required permission. */
export const PROTECT_ACTION_META: Record<
  ProtectAction,
  {
    countLabel: string;
    description: string;
    displayName: string;
    permission: bigint;
  }
> = {
  ban: {
    countLabel: "Kicks",
    description:
      "This channel is used to catch spam bots. Any messages sent here will result in a **softban**.",
    displayName: "🔒 Ban (ถาวร)",
    permission: PermissionFlagsBits.BanMembers,
  },
  timeout: {
    countLabel: "Timeouts",
    description:
      "This channel is used to catch spam bots. Any messages sent here will result in a **timeout**.",
    displayName: "⏱️ Timeout",
    permission: PermissionFlagsBits.ModerateMembers,
  },
};

/** Build the Components v2 container: header/body text + logo thumbnail + counter pill. */
export function buildProtectRoomNoticeComponents(
  actionType: ProtectAction,
  count: number,
) {
  const meta = PROTECT_ACTION_META[actionType];

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# DO NOT SEND MESSAGES IN THIS CHANNEL"),
      new TextDisplayBuilder().setContent(meta.description),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("protect_room_counter")
          .setLabel(`${meta.countLabel}: ${count}`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
      ),
    );

  return [container];
}

/** Send the notice message into a channel. Returns the message id, or null on failure. */
export async function sendProtectRoomNotice(
  channel: TextBasedChannel,
  actionType: ProtectAction,
): Promise<string | null> {
  if (!channel.isSendable()) return null;
  try {
    const msg = await channel.send({
      components: buildProtectRoomNoticeComponents(actionType, 0),
      flags: MessageFlags.IsComponentsV2,
    });
    return msg.id;
  } catch (err) {
    logger.warn(`[PROTECT] Failed to send notice in channel ${channel.id}: ${err}`);
    return null;
  }
}

/**
 * Refresh the notice message in a channel so the counter shows `count`.
 * `channel` and `target` come from the caller (who already has them in hand),
 * so no extra guild/channel fetch or DB read happens here. If the stored
 * notice message is gone (deleted by an admin, channel nuked, etc.) it
 * re-posts a fresh one and stores the new id.
 */
export async function refreshProtectRoomNotice(
  channel: TextBasedChannel,
  target: ProtectRoomNoticeTarget,
  count: number,
): Promise<void> {
  if (!channel.isSendable()) return;

  const components = buildProtectRoomNoticeComponents(target.actionType, count);

  // Try editing the existing notice message first.
  if (target.noticeMessageId) {
    try {
      const message = await channel.messages.fetch(target.noticeMessageId);
      await message.edit({ components });
      return;
    } catch (err) {
      logger.warn(
        `[PROTECT] Notice message ${target.noticeMessageId} not editable (${target.channelId}), re-posting: ${err}`,
      );
    }
  }

  // Notice is missing/deleted — re-post it and store the new id.
  const newId = await sendProtectRoomNotice(channel, target.actionType);
  if (newId) {
    db.prepare(
      "UPDATE protectedRooms SET noticeMessageId = ? WHERE guildId = ? AND channelId = ?",
    ).run(newId, target.guildId, target.channelId);
    invalidateProtectedRoom(target.guildId, target.channelId);
  }
}
