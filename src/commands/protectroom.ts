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
  type ProtectAction,
} from "../lib/protectRoom";

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

  db.prepare("INSERT INTO protectedRooms (guildId, channelId, actionType, timeoutDuration, createdAt) VALUES (?, ?, ?, ?, ?)")
    .run(interaction.guildId, interaction.channelId, action, timeoutDuration, Date.now());
  invalidateProtectedRoom(interaction.guildId, interaction.channelId);

  // Post the notice message (embed + counter button) in the protected channel.
  let noticeMessageId: string | null = null;
  if (interaction.channel?.isTextBased()) {
    noticeMessageId = await sendProtectRoomNotice(interaction.channel, action);
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
      `• All messages from that user in the last 1 minute will be deleted\n` +
      `• No exceptions, except for the Guild Owner or Administrators\n\n` +
      (noticeMessageId
        ? `📌 A warning sign has been posted in this channel — the punished user count will update on the sign automatically`
        : `⚠️ Could not post the warning sign in this channel (check the Send Messages permission)`)
    )
    .setTimestamp();

  logger.info(`[PROTECT] Channel ${interaction.channelId} in guild ${interaction.guildId} set as protected (${action}) by ${interaction.user.tag}`);
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
    .prepare("SELECT * FROM protectedRooms WHERE guildId = ? AND channelId = ?")
    .get(interaction.guildId, interaction.channelId) as
    | { noticeMessageId: string | null }
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
    .prepare("SELECT actionType, timeoutDuration, actionCount FROM protectedRooms WHERE guildId = ? AND channelId = ?")
    .get(interaction.guildId, interaction.channelId) as { actionType: ProtectAction; timeoutDuration: number; actionCount: number } | undefined;

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
      `**Users punished so far:** ${existing.actionCount}`
    )
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

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

  if (sub === "view") {
    return statusProtectRoom(interaction);
  }
}
