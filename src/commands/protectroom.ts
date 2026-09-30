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
  .setDescription("🛡️ ตั้งค่าห้องหลอก - แบน/ไทม์เอาท์อัตโนมัติเมื่อมีคนพิมพ์")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName("setup")
      .setDescription("🔧 ตั้งค่าห้องนี้ให้เป็นห้องป้องกัน")
      .addStringOption((option) =>
        option
          .setName("action")
          .setDescription("การกระทำเมื่อมีคนพิมพ์ข้อความ")
          .setRequired(true)
          .addChoices(
            { name: "🔒 Ban (ถาวร)", value: "ban" },
            { name: "⏱️ Timeout (กำหนดเวลาได้)", value: "timeout" }
          )
      )
      .addIntegerOption((option) =>
        option
          .setName("timeout_minutes")
          .setDescription("เวลา Timeout เป็นนาที (เฉพาะกรณีเลือก Timeout, ค่าเริ่มต้น: 60)")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(40320)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("🔓 ยกเลิกการตั้งค่าห้องป้องกันสำหรับห้องนี้")
  )
  .addSubcommand((sub) =>
    sub
      .setName("view")
      .setDescription("📋 ดูสถานะการตั้งค่าห้องป้องกันของห้องนี้")
  );

export async function setProtectRoom(
  interaction: ChatInputCommandInteraction,
  action: ProtectAction,
  timeoutMinutes: number,
) {
  if (!interaction.guildId || !interaction.channelId) {
    return interaction.reply({
      content: "❌ คำสั่งนี้ใช้ได้เฉพาะในห้อง Server เท่านั้น",
      flags: MessageFlags.Ephemeral,
    });
  }

  const timeoutDuration = timeoutMinutes * 60 * 1000;

  const existing = db
    .prepare("SELECT * FROM protectedRooms WHERE guildId = ? AND channelId = ?")
    .get(interaction.guildId, interaction.channelId);

  if (existing) {
    return interaction.reply({
      content: `⚠️ ห้องนี้ถูกตั้งค่าเป็นห้องป้องกันอยู่แล้ว!`,
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
    .setTitle("✅ ตั้งค่าห้องป้องกันเรียบร้อยแล้ว")
    .setDescription(
      `<#${interaction.channelId}> ถูกตั้งค่าเป็นห้องป้องกัน\n\n` +
      `**การลงโทษ:** ${PROTECT_ACTION_META[action].displayName}${action === "timeout" ? ` (${timeoutMinutes} นาที)` : ""}\n\n` +
      `**กฎ:**\n` +
      `• หากมีการพิมพ์ข้อความใดๆ จะถูกลงโทษทันที\n` +
      `• ข้อความทั้งหมดของผู้ใช้รายนั้นในช่วง 1 นาทีที่ผ่านมาจะถูกลบ\n` +
      `• ไม่มีข้อยกเว้น ยกเว้น Guild Owner หรือ Administrator\n\n` +
      (noticeMessageId
        ? `📌 ได้โพสต์ป้ายเตือนในห้องนี้แล้ว — จำนวนคนที่ถูกลงโทษจะอัปเดตที่ป้ายโดยอัตโนมัติ`
        : `⚠️ ไม่สามารถโพสต์ป้ายเตือนในห้องนี้ได้ (ตรวจสอบสิทธิ์ Send Messages)`)
    )
    .setTimestamp();

  logger.info(`[PROTECT] Channel ${interaction.channelId} in guild ${interaction.guildId} set as protected (${action}) by ${interaction.user.tag}`);
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

export async function removeProtectRoom(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId || !interaction.channelId) {
    return interaction.reply({
      content: "❌ คำสั่งนี้ใช้ได้เฉพาะในห้อง Server เท่านั้น",
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
      content: `⚠️ ห้องนี้ยังไม่ได้ตั้งค่าเป็นห้องป้องกัน!`,
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
    content: `✅ ยกเลิกการตั้งค่าห้องป้องกันสำหรับ <#${interaction.channelId}> เรียบร้อยแล้ว`,
    flags: MessageFlags.Ephemeral,
  });
}

export async function statusProtectRoom(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId || !interaction.channelId) {
    return interaction.reply({
      content: "❌ คำสั่งนี้ใช้ได้เฉพาะในห้อง Server เท่านั้น",
      flags: MessageFlags.Ephemeral,
    });
  }

  const existing = db
    .prepare("SELECT actionType, timeoutDuration, actionCount FROM protectedRooms WHERE guildId = ? AND channelId = ?")
    .get(interaction.guildId, interaction.channelId) as { actionType: ProtectAction; timeoutDuration: number; actionCount: number } | undefined;

  if (!existing) {
    return interaction.reply({
      content: `ℹ️ ห้องนี้ไม่ได้เป็นห้องป้องกัน`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("🛡️ สถานะห้องป้องกัน")
    .setDescription(
      `ห้อง <#${interaction.channelId}> เปิดใช้งานระบบห้องป้องกันอยู่\n\n` +
      `**การลงโทษ:** ${PROTECT_ACTION_META[existing.actionType].displayName}${existing.actionType === "timeout" ? ` (${existing.timeoutDuration / (60 * 1000)} นาที)` : ""}\n` +
      `**จำนวนคนที่ถูกลงโทษแล้ว:** ${existing.actionCount}`
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
