import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { client } from "../lib/client";
import db from "../lib/db";

const SNOWFLAKE_REGEX = /^\d{17,19}$/;

export const data = new SlashCommandBuilder()
  .setName("whitelist")
  .setDescription("🤖 จัดการ allowlist ของ Bot ที่ได้รับอนุญาตให้เข้าเซิร์ฟเวอร์")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription("➕ เพิ่ม Bot ID ลงใน allowlist")
      .addStringOption((option) =>
        option
          .setName("bot_id")
          .setDescription("Discord User ID ของบอทที่ต้องการอนุญาต")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("remove")
      .setDescription("➖ ลบ Bot ID ออกจาก allowlist")
      .addStringOption((option) =>
        option
          .setName("bot_id")
          .setDescription("Discord User ID ของบอทที่ต้องการลบออกจาก allowlist")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("list").setDescription("📋 ดูรายชื่อ Bot ที่อยู่ใน allowlist"),
  );

function requireAdmin(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "❌ ต้องมีสิทธิ์ Administrator ถึงจะจัดการ allowlist ได้",
      flags: MessageFlags.Ephemeral,
    });
  }
  return null;
}

function requireGuild(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    return interaction.reply({
      content: "❌ คำสั่งนี้ใช้ได้เฉพาะใน Server เท่านั้น",
      flags: MessageFlags.Ephemeral,
    });
  }
  return null;
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const denied = requireAdmin(interaction) ?? requireGuild(interaction);
  if (denied) return denied;

  const guildId = interaction.guildId!;
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "add") {
    const rawId = interaction.options.getString("bot_id", true).trim();

    if (!SNOWFLAKE_REGEX.test(rawId)) {
      return interaction.reply({
        content: "❌ `bot_id` ต้องเป็น Discord ID (ตัวเลข 17–19 หลัก)",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Try to verify the user actually exists and is a bot.
    let isBot: boolean | null = null;
    try {
      const fetched = await client.users.fetch(rawId);
      isBot = fetched.bot ?? false;
    } catch {
      // Unknown user — still allow saving (admin may know something we don't).
      isBot = null;
    }

    if (isBot === false) {
      return interaction.reply({
        content: `⚠️ <@${rawId}> ไม่ใช่บอท — กรุณาตรวจสอบ ID แล้วลองใหม่`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const existing = db
      .prepare("SELECT 1 FROM allowedBots WHERE guildId = ? AND botId = ?")
      .get(guildId, rawId);

    if (existing) {
      return interaction.reply({
        content: `ℹ️ Bot <@${rawId}> อยู่ใน allowlist ของเซิร์ฟเวอร์นี้อยู่แล้ว`,
        flags: MessageFlags.Ephemeral,
      });
    }

    db.prepare("INSERT INTO allowedBots (guildId, botId, addedBy, addedAt) VALUES (?, ?, ?, ?)")
      .run(guildId, rawId, interaction.user.id, Date.now());

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ เพิ่ม Bot ลงใน allowlist แล้ว")
      .setDescription(
        `Bot <@${rawId}> ได้รับอนุญาตให้เข้าเซิร์ฟเวอร์นี้แล้ว\n\n` +
          `**Bot ID:** \`${rawId}\`\n` +
          `**ผู้เพิ่ม:** <@${interaction.user.id}>`,
      )
      .setFooter({ text: "Diff Team" })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (subcommand === "remove") {
    const rawId = interaction.options.getString("bot_id", true).trim();

    if (!SNOWFLAKE_REGEX.test(rawId)) {
      return interaction.reply({
        content: "❌ `bot_id` ต้องเป็น Discord ID (ตัวเลข 17–19 หลัก)",
        flags: MessageFlags.Ephemeral,
      });
    }

    const result = db
      .prepare("DELETE FROM allowedBots WHERE guildId = ? AND botId = ?")
      .run(guildId, rawId);

    if (result.changes === 0) {
      return interaction.reply({
        content: `ℹ️ ไม่พบ Bot <@${rawId}> ใน allowlist ของเซิร์ฟเวอร์นี้`,
        flags: MessageFlags.Ephemeral,
      });
    }

    return interaction.reply({
      content: `✅ ลบ Bot <@${rawId}> ออกจาก allowlist แล้ว — ครั้งถัดไปที่บอทนี้พยายามเข้าเซิร์ฟจะถูกเตะอัตโนมัติ`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // subcommand === "list"
  const rows = db
    .prepare("SELECT botId, addedBy, addedAt FROM allowedBots WHERE guildId = ? ORDER BY addedAt DESC")
    .all(guildId) as { botId: string; addedBy: string; addedAt: number }[];

  if (rows.length === 0) {
    return interaction.reply({
      content: "ℹ️ ยังไม่มี Bot อยู่ใน allowlist — ใช้ `/whitelist add` เพื่อเพิ่ม",
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = rows.map((row, idx) => {
    const addedDate = new Date(row.addedAt).toLocaleString("th-TH");
    return `**${idx + 1}.** <@${row.botId}> — \`${row.botId}\`\n   • เพิ่มโดย <@${row.addedBy}> เมื่อ ${addedDate}`;
  });

  const description = lines.join("\n\n");

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("🤖 รายชื่อ Bot ที่ได้รับอนุญาต")
    .setDescription(description)
    .setFooter({ text: `Diff Team • ${rows.length} บอทใน allowlist` })
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
