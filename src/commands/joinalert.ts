import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";
import config from "../lib/config";
import db from "../lib/db";

export const data = new SlashCommandBuilder()
  .setName("joinalert")
  .setDescription("👋 จัดการแจ้งเตือนสมาชิกใหม่")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription("➕ เปิดการแจ้งเตือนเมื่อมีสมาชิกใหม่เข้าเซิร์ฟเวอร์")
      .addStringOption((option) =>
        option
          .setName("message")
          .setDescription("ข้อความต้อนรับหลัง mention (เช่น ยินดีต้อนรับ) — ไม่บังคับ")
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("remove").setDescription("🗑️ ปิดการแจ้งเตือนสมาชิกใหม่"),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("list").setDescription("📋 ดูการตั้งค่าการแจ้งเตือนสมาชิกใหม่"),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "❌ ต้องมีสิทธิ์ Administrator ถึงจะจัดการการแจ้งเตือนสมาชิกใหม่ได้",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!interaction.guildId || !interaction.channelId) {
    return interaction.reply({
      content: "❌ คำสั่งนี้ใช้ได้เฉพาะใน Server เท่านั้น",
      flags: MessageFlags.Ephemeral,
    });
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "add" && !config.ENABLE_GUILD_MEMBERS_INTENT) {
    return interaction.reply({
      content:
        "❌ ระบบแจ้งเตือนสมาชิกใหม่ถูกปิดอยู่ เพราะยังไม่ได้เปิด Guild Members intent — กรุณาเปิด intent ใน Discord Developer Portal และตั้ง `ENABLE_GUILD_MEMBERS_INTENT=true` ใน .env",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (subcommand === "add") {
    const channel = interaction.guild?.channels.cache.get(interaction.channelId);
    if (!channel || !channel.isTextBased()) {
      return interaction.reply({
        content: "❌ ต้องตั้งค่าการแจ้งเตือนสมาชิกใหม่ในห้องข้อความ (Text Channel)",
        flags: MessageFlags.Ephemeral,
      });
    }

    const botMember = interaction.guild?.members.me;
    if (!botMember) {
      return interaction.reply({
        content: "❌ ไม่พบข้อมูลบอทในเซิร์ฟเวอร์นี้",
        flags: MessageFlags.Ephemeral,
      });
    }

    const permissions = channel.permissionsFor(botMember);
    if (
      !permissions?.has(PermissionFlagsBits.ViewChannel) ||
      !permissions?.has(PermissionFlagsBits.SendMessages)
    ) {
      return interaction.reply({
        content:
          "❌ บอทต้องการสิทธิ์ **View Channel** และ **Send Messages** ในห้องนี้เพื่อส่งการแจ้งเตือน",
        flags: MessageFlags.Ephemeral,
      });
    }

    const message = interaction.options.getString("message") ?? "";

    db.prepare(
      `
      INSERT INTO memberJoinAlerts (guildId, channelId, customMessage, enabled)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(guildId)
      DO UPDATE SET channelId = excluded.channelId, customMessage = excluded.customMessage, enabled = 1
    `,
    ).run(interaction.guildId, interaction.channelId, message);

    return interaction.reply({
      content: `✅ เปิดการแจ้งเตือนสมาชิกใหม่ในห้องนี้แล้ว${message ? `\n📝 ข้อความ: ${message}` : ""}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (subcommand === "remove") {
    const result = db
      .prepare(
        `
      DELETE FROM memberJoinAlerts
      WHERE guildId = ?
    `,
      )
      .run(interaction.guildId);

    return interaction.reply({
      content: result.changes
        ? "✅ ปิดการแจ้งเตือนสมาชิกใหม่สำหรับเซิร์ฟเวอร์นี้แล้ว"
        : "ℹ️ ไม่มีการตั้งค่าการแจ้งเตือนสมาชิกใหม่",
      flags: MessageFlags.Ephemeral,
    });
  }

  const existing = db
    .prepare(
      `
      SELECT channelId, customMessage
      FROM memberJoinAlerts
      WHERE guildId = ?
        AND enabled = 1
    `,
    )
    .get(interaction.guildId) as { channelId: string; customMessage: string } | undefined;

  if (!existing) {
    return interaction.reply({
      content: "ℹ️ ยังไม่ได้ตั้งค่าการแจ้งเตือนสมาชิกใหม่สำหรับเซิร์ฟเวอร์นี้",
      flags: MessageFlags.Ephemeral,
    });
  }

  return interaction.reply({
    content: `📋 เปิดการแจ้งเตือนสมาชิกใหม่ที่ <#${existing.channelId}>${
      existing.customMessage ? `\n📝 ข้อความ: ${existing.customMessage}` : ""
    }`,
    flags: MessageFlags.Ephemeral,
  });
}
