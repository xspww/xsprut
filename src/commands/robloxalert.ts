import {
  ChannelType,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";
import { ROBLOX_CHANNELS } from "../lib/constants";
import db from "../lib/db";
import { invalidateAlerts } from "../lib/dbCache";

export const data = new SlashCommandBuilder()
  .setName("robloxalert")
  .setDescription("📢 จัดการระบบแจ้งเตือนการอัปเดตของ Roblox")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription("➕ เปิดการแจ้งเตือนในห้องนี้")
      .addStringOption((option) =>
        option
          .setName("roblox_channel")
          .setDescription("ช่อง Roblox ที่ต้องการติดตาม")
          .setRequired(true)
          .addChoices(
            ...ROBLOX_CHANNELS.map((channel) => ({
              name: channel,
              value: channel,
            })),
          ),
      )
      .addChannelOption((option) =>
        option
          .setName("discord_channel")
          .setDescription("📨 ห้อง Discord ที่จะส่งแจ้งเตือน (ไม่ต้องใส่ = ห้องนี้)")
          .setRequired(false)
          .addChannelTypes(ChannelType.GuildText),
      )
      .addStringOption((option) =>
        option
          .setName("message")
          .setDescription("ข้อความก่อน embed (เช่น @everyone) — ไม่บังคับ")
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("remove")
      .setDescription("➖ ปิดการแจ้งเตือนในห้องนี้")
      .addStringOption((option) =>
        option
          .setName("roblox_channel")
          .setDescription("ช่อง Roblox ที่ต้องการปิดการแจ้งเตือน")
          .setRequired(true)
          .addChoices(
            ...ROBLOX_CHANNELS.map((channel) => ({
              name: channel,
              value: channel,
            })),
          ),
      )
      .addChannelOption((option) =>
        option
          .setName("discord_channel")
          .setDescription("📨 ห้อง Discord ที่ต้องการปิดการแจ้งเตือน (ไม่ต้องใส่ = ห้องนี้)")
          .setRequired(false)
          .addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("list").setDescription("📋 ดูรายการแจ้งเตือนที่ตั้งไว้ในเซิร์ฟเวอร์นี้"),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "❌ ต้องมีสิทธิ์ Administrator ถึงจะจัดการการแจ้งเตือนได้",
      flags: MessageFlags.Ephemeral,
    });
  }

  const subcommand = interaction.options.getSubcommand();
  if (!interaction.guildId || !interaction.channelId) {
    return interaction.reply({
      content: "❌ คำสั่งนี้ใช้ได้เฉพาะใน Server เท่านั้น",
      flags: MessageFlags.Ephemeral,
    });
  }

  const robloxChannel = interaction.options.getString("roblox_channel", true);
  const targetChannelId =
    interaction.options.getChannel("discord_channel", false)?.id ??
    interaction.channelId;

  if (subcommand === "add") {
    const message = interaction.options.getString("message") ?? "";

    const botMember = interaction.guild?.members.me;
    if (!botMember) {
      return interaction.reply({
        content: "❌ ไม่สามารถตรวจสอบสิทธิ์ของบอทในห้องนี้ได้",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Resolve the target channel (an option channel may not be in the client
    // cache yet, so fall back to fetching it).
    let targetChannel =
      interaction.guild.channels.cache.get(targetChannelId) ?? null;
    if (!targetChannel) {
      targetChannel = await interaction.guild.channels
        .fetch(targetChannelId)
        .catch(() => null);
    }

    if (!targetChannel || !targetChannel.isTextBased()) {
      return interaction.reply({
        content: "❌ ใช้ได้เฉพาะห้องข้อความ (Text Channel) เท่านั้น",
        flags: MessageFlags.Ephemeral,
      });
    }

    const permissions = targetChannel.permissionsFor(botMember);
    if (
      !permissions?.has(PermissionFlagsBits.ViewChannel) ||
      !permissions?.has(PermissionFlagsBits.SendMessages)
    ) {
      return interaction.reply({
        content:
          "❌ บอทไม่มีสิทธิ์ **View Channel** และ **Send Messages** ในห้องนั้น กรุณาให้สิทธิ์ก่อนเปิดการแจ้งเตือน",
        flags: MessageFlags.Ephemeral,
      });
    }

    db.prepare(
      `
      INSERT INTO alerts (
        channelId,
        guildId,
        robloxChannel,
        customContent
      )
      VALUES (?, ?, ?, ?)
      ON CONFLICT(channelId, robloxChannel)
      DO UPDATE SET
        customContent = excluded.customContent,
        enabled = 1
    `,
    ).run(targetChannelId, interaction.guildId, robloxChannel, message);
    invalidateAlerts();

    return interaction.reply({
      content: `✅ เปิดการแจ้งเตือน **${robloxChannel}** ในห้อง <#${targetChannelId}> แล้ว`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (subcommand === "remove") {
    const result = db
      .prepare(
        `
      DELETE FROM alerts
      WHERE channelId = ?
      AND robloxChannel = ?
    `,
      )
      .run(targetChannelId, robloxChannel);
    invalidateAlerts();

    return interaction.reply({
      content: result.changes
        ? `✅ ปิดการแจ้งเตือน **${robloxChannel}** ในห้อง <#${targetChannelId}> แล้ว`
        : "ℹ️ ไม่พบการแจ้งเตือนในห้องนี้",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (subcommand === "list") {
    const alerts = db
      .prepare(
        `
      SELECT channelId, robloxChannel, customContent
      FROM alerts
      WHERE guildId = ?
      AND enabled = 1
    `,
      )
      .all(interaction.guildId) as {
      channelId: string;
      robloxChannel: string;
      customContent: string;
    }[];

    if (alerts.length === 0) {
      return interaction.reply({
        content: "ℹ️ ยังไม่มีการตั้งค่าการแจ้งเตือน",
        flags: MessageFlags.Ephemeral,
      });
    }

    return interaction.reply({
      content: alerts
        .map(
          (alert) =>
            `• **${alert.robloxChannel}** → <#${alert.channelId}>${alert.customContent ? ` (ข้อความ: ${alert.customContent})` : ""}`,
        )
        .join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }
}
