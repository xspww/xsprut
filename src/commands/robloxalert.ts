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
  .setDescription("📢 Manage the Roblox update alert system")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription("➕ Enable alerts in this channel")
      .addStringOption((option) =>
        option
          .setName("roblox_channel")
          .setDescription("The Roblox channel to track")
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
          .setDescription("📨 Discord channel to send alerts to (omit = this channel)")
          .setRequired(false)
          .addChannelTypes(ChannelType.GuildText),
      )
      .addStringOption((option) =>
        option
          .setName("message")
          .setDescription("Message before the embed (e.g. @everyone) — optional")
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("remove")
      .setDescription("➖ Disable alerts in this channel")
      .addStringOption((option) =>
        option
          .setName("roblox_channel")
          .setDescription("The Roblox channel to disable alerts for")
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
          .setDescription("📨 Discord channel to disable alerts in (omit = this channel)")
          .setRequired(false)
          .addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("list").setDescription("📋 View the alerts set up in this server"),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "❌ You need Administrator permission to manage alerts",
      flags: MessageFlags.Ephemeral,
    });
  }

  const subcommand = interaction.options.getSubcommand();
  if (!interaction.guildId || !interaction.channelId) {
    return interaction.reply({
      content: "❌ This command can only be used in a server",
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
        content: "❌ Could not verify the bot's permissions in this channel",
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
        content: "❌ Only text channels can be used",
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
          "❌ The bot lacks **View Channel** and **Send Messages** permissions in that channel. Please grant them before enabling alerts",
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
      content: `✅ Alerts for **${robloxChannel}** enabled in <#${targetChannelId}>`,
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
        ? `✅ Alerts for **${robloxChannel}** disabled in <#${targetChannelId}>`
        : "ℹ️ No alerts found in this channel",
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
        content: "ℹ️ No alerts have been set up yet",
        flags: MessageFlags.Ephemeral,
      });
    }

    return interaction.reply({
      content: alerts
        .map(
          (alert) =>
            `• **${alert.robloxChannel}** → <#${alert.channelId}>${alert.customContent ? ` (message: ${alert.customContent})` : ""}`,
        )
        .join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }
}
