import {
  MessageFlags,
  PermissionFlagsBits,
  type Channel,
  type InteractionReplyOptions,
  type TextBasedChannel,
} from "discord.js";

/** Helpers shared by the panel's builders and its three handlers. */

// ─── Permission helper ──────────────────────────────────────────────────────
export function isAdmin(interaction: { memberPermissions?: { has: (p: bigint) => boolean } | null }): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

export function deny(interaction: {
  reply: (opts: InteractionReplyOptions) => Promise<unknown>;
}): Promise<unknown> {
  return interaction.reply({ content: "❌ ต้องเป็น Administrator ถึงใช้ได้", flags: MessageFlags.Ephemeral });
}

/**
 * A channel the panel can post in and delete messages from.
 *
 * Discord returns a bare `Channel` for a fetched id; the panel only ever
 * touches text-based channels that own a message manager.
 */
export type PanelMessageChannel = Extract<TextBasedChannel, { messages: unknown }>;

/**
 * Narrow a fetched channel to one the panel can work with.
 *
 * Returns null for a channel that is gone, is not text-based, or has no
 * message manager (a voice channel, for example).
 */
export function panelChannel(channel: Channel | null | undefined): PanelMessageChannel | null {
  if (!channel || !channel.isTextBased() || !("messages" in channel)) return null;
  return channel;
}

/** The protected-room row the panel reads and writes. */
export type ProtectedRoomRow = {
  actionType: "ban" | "timeout";
  timeoutDuration: number;
  actionCount: number;
  noticeMessageId: string | null;
  imageUrl: string | null;
};
