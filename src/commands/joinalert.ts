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
  .setDescription("👋 Manage new member join alerts")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription("➕ Enable alerts when a new member joins the server")
      .addStringOption((option) =>
        option
          .setName("message")
          .setDescription("Welcome message after the mention (e.g. Welcome) — optional")
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("remove").setDescription("🗑️ Disable new member alerts"),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("list").setDescription("📋 View new member alert settings"),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "❌ You need Administrator permission to manage new member alerts",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!interaction.guildId || !interaction.channelId) {
    return interaction.reply({
      content: "❌ This command can only be used in a server",
      flags: MessageFlags.Ephemeral,
    });
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "add" && !config.ENABLE_GUILD_MEMBERS_INTENT) {
    return interaction.reply({
      content:
        "❌ New member alerts are disabled because the Guild Members intent is not enabled — please enable the intent in the Discord Developer Portal and set `ENABLE_GUILD_MEMBERS_INTENT=true` in .env",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (subcommand === "add") {
    const channel = interaction.guild?.channels.cache.get(interaction.channelId);
    if (!channel || !channel.isTextBased()) {
      return interaction.reply({
        content: "❌ New member alerts must be set up in a text channel",
        flags: MessageFlags.Ephemeral,
      });
    }

    const botMember = interaction.guild?.members.me;
    if (!botMember) {
      return interaction.reply({
        content: "❌ Bot information not found in this server",
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
          "❌ The bot needs **View Channel** and **Send Messages** permissions in this channel to send alerts",
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
      content: `✅ New member alerts enabled in this channel${message ? `\n📝 Message: ${message}` : ""}`,
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
        ? "✅ New member alerts disabled for this server"
        : "ℹ️ No new member alert settings found",
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
      content: "ℹ️ New member alerts have not been set up for this server yet",
      flags: MessageFlags.Ephemeral,
    });
  }

  return interaction.reply({
    content: `📋 New member alerts enabled in <#${existing.channelId}>${
      existing.customMessage ? `\n📝 Message: ${existing.customMessage}` : ""
    }`,
    flags: MessageFlags.Ephemeral,
  });
}
