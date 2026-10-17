import type { ChatInputCommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import db from "../lib/db";
import logger from "../lib/logger";
import { invalidateProtectedRoom } from "../lib/dbCache";
import { buildProtectRoomNoticeComponents, type ProtectAction } from "../lib/protectRoom";
import {
  deleteLocalPanelImage,
  isLocalPanelImageMissing,
  panelImageFilesForPost,
  persistPanelImageFromUrl,
  resolvePanelImageInput,
} from "../lib/panelImage";

/** /protectroom edit — swap the banner without touching the punish counter. */
export async function editProtectRoom(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId || !interaction.channelId) {
    return interaction.reply({
      content: "❌ This command can only be used in a server channel",
      flags: MessageFlags.Ephemeral,
    });
  }
  const row = db
    .prepare("SELECT actionType, actionCount, noticeMessageId, imageUrl FROM protectedRooms WHERE guildId = ? AND channelId = ?")
    .get(interaction.guildId, interaction.channelId) as {
    actionType: ProtectAction;
    actionCount: number;
    noticeMessageId: string | null;
    imageUrl: string | null;
  } | undefined;
  if (!row) {
    return interaction.reply({
      content: "⚠️ This channel is not set as a protected room yet! Use `/protectroom setup` first",
      flags: MessageFlags.Ephemeral,
    });
  }
  const imageUrlOption = interaction.options.getString("banner_url");
  const attachment = interaction.options.getAttachment("banner");
  const wantsClear = !attachment && imageUrlOption?.trim().toLowerCase() === "clear";
  let nextImage: string | null = row.imageUrl;
  if (wantsClear) {
    nextImage = null;
  } else {
    const resolved = resolvePanelImageInput(
      attachment
        ? { url: attachment.url, name: attachment.name, contentType: attachment.contentType, size: attachment.size }
        : null,
      imageUrlOption,
    );
    if (resolved.error) return interaction.reply({ content: resolved.error, flags: MessageFlags.Ephemeral });
    if (!resolved.image) {
      return interaction.reply({
        content: "ℹ️ Nothing to change — attach a `banner`, give a `banner_url`, or set `banner_url` to `clear`",
        flags: MessageFlags.Ephemeral,
      });
    }
    if (resolved.image.kind === "url") {
      nextImage = resolved.image.url;
    } else {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        nextImage = await persistPanelImageFromUrl(resolved.image.url, resolved.image.filename, {
          contentType: attachment?.contentType,
          scope: "protect",
        });
      } catch (e: any) {
        return interaction.editReply(e?.message ?? "❌ Could not save the image");
      }
    }
  }
  const oldImage = row.imageUrl;
  db.prepare("UPDATE protectedRooms SET imageUrl = ? WHERE guildId = ? AND channelId = ?")
    .run(nextImage, interaction.guildId, interaction.channelId);
  invalidateProtectedRoom(interaction.guildId, interaction.channelId);
  if (nextImage !== oldImage) deleteLocalPanelImage(oldImage);
  // Re-post so the new banner takes effect (edits can't add/remove files).
  let noticeOk = false;
  const channel = interaction.channel;
  if (channel?.isTextBased() && channel.isSendable()) {
    try {
      if (row.noticeMessageId) await channel.messages.delete(row.noticeMessageId).catch(() => {});
      const msg = await channel.send({
        components: buildProtectRoomNoticeComponents(row.actionType, row.actionCount ?? 0, nextImage),
        files: panelImageFilesForPost(nextImage),
        flags: MessageFlags.IsComponentsV2,
      });
      db.prepare("UPDATE protectedRooms SET noticeMessageId = ? WHERE guildId = ? AND channelId = ?")
        .run(msg.id, interaction.guildId, interaction.channelId);
      invalidateProtectedRoom(interaction.guildId, interaction.channelId);
      noticeOk = true;
    } catch (e) {
      logger.warn(`[PROTECT] Failed to re-post notice after edit in ${interaction.channelId}:`, e);
    }
  }
  const missingNote =
    !wantsClear && isLocalPanelImageMissing(nextImage)
      ? "\n⚠️ The banner file is missing on disk, the notice was posted without an image"
      : "";
  const text = wantsClear
    ? `✅ Banner removed${noticeOk ? " and the notice was updated" : " (could not update the notice message)"}${missingNote}`
    : `✅ Banner updated${noticeOk ? " and the notice was updated" : " (could not update the notice message)"} — counter kept at **${row.actionCount ?? 0}**${missingNote}`;
  if (interaction.deferred) return interaction.editReply(text);
  return interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
}
