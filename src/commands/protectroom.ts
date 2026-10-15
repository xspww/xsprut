import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import db from "../lib/db";
import logger from "../lib/logger";
import { invalidateProtectedRoom } from "../lib/dbCache";
import {
  PROTECT_ACTION_META,
  sendProtectRoomNotice,
  buildProtectRoomNoticeComponents,
  type ProtectAction,
} from "../lib/protectRoom";
import {
  deleteLocalPanelImage,
  isLocalPanelImageMissing,
  panelImageFilesForPost,
  persistPanelImageFromUrl,
  resolvePanelImageInput,
} from "../lib/panelImage";

export const data = new SlashCommandBuilder()
  .setName("protectroom")
  .setDescription("🛡️ Set up a decoy room - auto ban/timeout when someone types")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName("setup")
      .setDescription("🔧 Set this channel as a protected room")
      .addStringOption((option) =>
        option
          .setName("action")
          .setDescription("Action to take when someone sends a message")
          .setRequired(true)
          .addChoices(
            { name: "🔒 Ban (permanent)", value: "ban" },
            { name: "⏱️ Timeout (configurable duration)", value: "timeout" }
          )
      )
      .addIntegerOption((option) =>
        option
          .setName("timeout_minutes")
          .setDescription("Timeout duration in minutes (only when Timeout is selected, default: 60)")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(40320)
      )
      .addAttachmentOption((option) =>
        option
          .setName("image")
          .setDescription("🖼️ Banner image uploaded with the command (shown on top of the notice)")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("image_url")
          .setDescription("🔗 Direct https link to a banner image (upload above wins)")
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("edit")
      .setDescription("✏️ Change the banner image without resetting the counter")
      .addAttachmentOption((option) =>
        option
          .setName("image")
          .setDescription("🖼️ New banner image (upload wins over image_url)")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("image_url")
          .setDescription("🔗 Direct https link, or 'clear' to remove the banner")
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("🔓 Remove the protected room setting for this channel")
  )
  .addSubcommand((sub) =>
    sub
      .setName("view")
      .setDescription("📋 View the protected room status of this channel")
  );

export async function setProtectRoom(
  interaction: ChatInputCommandInteraction,
  action: ProtectAction,
  timeoutMinutes: number,
) {
  if (!interaction.guildId || !interaction.channelId) {
    return interaction.reply({
      content: "❌ This command can only be used in a server channel",
      flags: MessageFlags.Ephemeral,
    });
  }

  const timeoutDuration = timeoutMinutes * 60 * 1000;

  const existing = db
    .prepare("SELECT * FROM protectedRooms WHERE guildId = ? AND channelId = ?")
    .get(interaction.guildId, interaction.channelId);

  if (existing) {
    return interaction.reply({
      content: `⚠️ This channel is already set as a protected room!`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // ─── Optional banner image (upload wins over URL) ──────────────────────
  const attachment = interaction.options.getAttachment("image");
  const imageUrlOption = interaction.options.getString("image_url");
  const resolved = resolvePanelImageInput(
    attachment
      ? { url: attachment.url, name: attachment.name, contentType: attachment.contentType, size: attachment.size }
      : null,
    imageUrlOption,
  );
  if (resolved.error) {
    return interaction.reply({ content: resolved.error, flags: MessageFlags.Ephemeral });
  }
  let storedImage: string | null = null;
  if (resolved.image?.kind === "attachment") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      storedImage = await persistPanelImageFromUrl(resolved.image.url, resolved.image.filename, {
        contentType: attachment?.contentType,
        scope: "protect",
      });
    } catch (e: any) {
      return interaction.editReply(e?.message ?? "❌ Could not save the image");
    }
  } else if (resolved.image?.kind === "url") {
    storedImage = resolved.image.url;
  }

  db.prepare("INSERT INTO protectedRooms (guildId, channelId, actionType, timeoutDuration, imageUrl, createdAt) VALUES (?, ?, ?, ?, ?, ?)")
    .run(interaction.guildId, interaction.channelId, action, timeoutDuration, storedImage, Date.now());
  invalidateProtectedRoom(interaction.guildId, interaction.channelId);

  // Post the notice message (banner + counter button) in the protected channel.
  let noticeMessageId: string | null = null;
  if (interaction.channel?.isTextBased()) {
    noticeMessageId = await sendProtectRoomNotice(interaction.channel, action, storedImage);
  }

  db.prepare("UPDATE protectedRooms SET noticeMessageId = ? WHERE guildId = ? AND channelId = ?")
    .run(noticeMessageId, interaction.guildId, interaction.channelId);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("✅ Protected room set up successfully")
    .setDescription(
      `<#${interaction.channelId}> has been set as a protected room\n\n` +
      `**Punishment:** ${PROTECT_ACTION_META[action].displayName}${action === "timeout" ? ` (${timeoutMinutes} minutes)` : ""}\n\n` +
      `**Rules:**\n` +
      `• Anyone who sends any message will be punished immediately\n` +
      `• All messages from that user within 1 minute before and after will be deleted\n` +
      `• No exceptions, except for the Guild Owner or Administrators\n\n` +
      (noticeMessageId
        ? `📌 A warning sign has been posted in this channel — the punished user count will update on the sign automatically`
        : `⚠️ Could not post the warning sign in this channel (check the Send Messages permission)`)
    )
    .setTimestamp();

  logger.info(`[PROTECT] Channel ${interaction.channelId} in guild ${interaction.guildId} set as protected (${action}) by ${interaction.user.tag}`);
  // deferred earlier only when an upload needed downloading
  if (interaction.deferred) {
    return interaction.editReply({ embeds: [embed] });
  }
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

export async function removeProtectRoom(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId || !interaction.channelId) {
    return interaction.reply({
      content: "❌ This command can only be used in a server channel",
      flags: MessageFlags.Ephemeral,
    });
  }

  const existing = db
    .prepare("SELECT noticeMessageId, imageUrl FROM protectedRooms WHERE guildId = ? AND channelId = ?")
    .get(interaction.guildId, interaction.channelId) as
    | { noticeMessageId: string | null; imageUrl: string | null }
    | undefined;

  if (!existing) {
    return interaction.reply({
      content: `⚠️ This channel is not set as a protected room yet!`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Best-effort delete of the notice message posted in the channel.
  if (existing.noticeMessageId && interaction.channel?.isTextBased()) {
    await interaction.channel.messages.delete(existing.noticeMessageId).catch(() => {});
  }

  db.prepare("DELETE FROM protectedRooms WHERE guildId = ? AND channelId = ?")
    .run(interaction.guildId, interaction.channelId);
  invalidateProtectedRoom(interaction.guildId, interaction.channelId);
  deleteLocalPanelImage(existing.imageUrl);

  logger.info(`[PROTECT] Channel ${interaction.channelId} in guild ${interaction.guildId} unprotected by ${interaction.user.tag}`);
  return interaction.reply({
    content: `✅ Protected room setting removed for <#${interaction.channelId}> successfully`,
    flags: MessageFlags.Ephemeral,
  });
}

export async function statusProtectRoom(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId || !interaction.channelId) {
    return interaction.reply({
      content: "❌ This command can only be used in a server channel",
      flags: MessageFlags.Ephemeral,
    });
  }

  const existing = db
    .prepare("SELECT actionType, timeoutDuration, actionCount, imageUrl FROM protectedRooms WHERE guildId = ? AND channelId = ?")
    .get(interaction.guildId, interaction.channelId) as { actionType: ProtectAction; timeoutDuration: number; actionCount: number; imageUrl: string | null } | undefined;

  if (!existing) {
    return interaction.reply({
      content: `ℹ️ This channel is not a protected room`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("🛡️ Protected room status")
    .setDescription(
      `Channel <#${interaction.channelId}> has the protected room system enabled\n\n` +
      `**Punishment:** ${PROTECT_ACTION_META[existing.actionType].displayName}${existing.actionType === "timeout" ? ` (${existing.timeoutDuration / (60 * 1000)} minutes)` : ""}\n` +
      `**Users punished so far:** ${existing.actionCount}\n` +
      `**Banner:** ${existing.imageUrl ? "set 🖼️" : "none"}`
    )
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

import { editProtectRoom } from "./protectroomEdit";

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand(true);

  if (sub === "setup") {
    const action = interaction.options.getString("action", true) as ProtectAction;
    const timeoutMinutes = interaction.options.getInteger("timeout_minutes") ?? 60;
    return setProtectRoom(interaction, action, timeoutMinutes);
  }

  if (sub === "remove") {
    return removeProtectRoom(interaction);
  }

  if (sub === "edit") {
    return editProtectRoom(interaction);
  }

  if (sub === "view") {
    return statusProtectRoom(interaction);
  }
}
