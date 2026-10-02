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
  .setDescription("🤖 Manage the allowlist of bots allowed to join the server")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription("➕ Add a Bot ID to the allowlist")
      .addStringOption((option) =>
        option
          .setName("bot_id")
          .setDescription("Discord user ID of the bot to allow")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("remove")
      .setDescription("➖ Remove a Bot ID from the allowlist")
      .addStringOption((option) =>
        option
          .setName("bot_id")
          .setDescription("Discord user ID of the bot to remove from the allowlist")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("list").setDescription("📋 View the bots in the allowlist"),
  );

function requireAdmin(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "❌ Administrator permission is required to manage the allowlist",
      flags: MessageFlags.Ephemeral,
    });
  }
  return null;
}

function requireGuild(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    return interaction.reply({
      content: "❌ This command can only be used in a server",
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
        content: "❌ `bot_id` must be a Discord ID (17–19 digits)",
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
        content: `⚠️ <@${rawId}> is not a bot — please check the ID and try again`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const existing = db
      .prepare("SELECT 1 FROM allowedBots WHERE guildId = ? AND botId = ?")
      .get(guildId, rawId);

    if (existing) {
      return interaction.reply({
        content: `ℹ️ Bot <@${rawId}> is already in this server's allowlist`,
        flags: MessageFlags.Ephemeral,
      });
    }

    db.prepare("INSERT INTO allowedBots (guildId, botId, addedBy, addedAt) VALUES (?, ?, ?, ?)")
      .run(guildId, rawId, interaction.user.id, Date.now());

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Bot added to the allowlist")
      .setDescription(
        `Bot <@${rawId}> is now allowed to join this server\n\n` +
          `**Bot ID:** \`${rawId}\`\n` +
          `**Added by:** <@${interaction.user.id}>`,
      )
      .setFooter({ text: "Diff Team" })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (subcommand === "remove") {
    const rawId = interaction.options.getString("bot_id", true).trim();

    if (!SNOWFLAKE_REGEX.test(rawId)) {
      return interaction.reply({
        content: "❌ `bot_id` must be a Discord ID (17–19 digits)",
        flags: MessageFlags.Ephemeral,
      });
    }

    const result = db
      .prepare("DELETE FROM allowedBots WHERE guildId = ? AND botId = ?")
      .run(guildId, rawId);

    if (result.changes === 0) {
      return interaction.reply({
        content: `ℹ️ Bot <@${rawId}> was not found in this server's allowlist`,
        flags: MessageFlags.Ephemeral,
      });
    }

    return interaction.reply({
      content: `✅ Bot <@${rawId}> removed from the allowlist — the next time this bot tries to join the server it will be kicked automatically`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // subcommand === "list"
  const rows = db
    .prepare("SELECT botId, addedBy, addedAt FROM allowedBots WHERE guildId = ? ORDER BY addedAt DESC")
    .all(guildId) as { botId: string; addedBy: string; addedAt: number }[];

  if (rows.length === 0) {
    return interaction.reply({
      content: "ℹ️ No bots in the allowlist yet — use `/whitelist add` to add one",
      flags: MessageFlags.Ephemeral,
    });
  }

  const lines = rows.map((row, idx) => {
    const addedDate = new Date(row.addedAt).toLocaleString("en-US");
    return `**${idx + 1}.** <@${row.botId}> — \`${row.botId}\`\n   • Added by <@${row.addedBy}> on ${addedDate}`;
  });

  const description = lines.join("\n\n");

  const embed = new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle("🤖 Allowed bots")
    .setDescription(description)
    .setFooter({ text: `Diff Team • ${rows.length} bots in the allowlist` })
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
