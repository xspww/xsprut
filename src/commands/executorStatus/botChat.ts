import { ChatInputCommandInteraction, MessageFlags } from "discord.js";
import db from "../../lib/db";
import logger from "../../lib/logger";
import { updateBotChatChannels } from "../../monitoring/executorStatus";
import { categoryIdOf, unknownChoice } from "./shared";

/** `/ex chat` — the text channel the bot renames with the Roblox version. */

type BotChatRow = {
  categoryId: string | null;
  channelId: string | null;
  mode: string;
  displayName: string;
  robloxChannel: string;
};

export async function handleBotChat(interaction: ChatInputCommandInteraction, sub: string) {
  switch (sub) {
    case "add":
      return botChatAdd(interaction);
    case "remove":
      return botChatRemove(interaction);
    case "list":
      return botChatList(interaction);
    case "refresh":
      return botChatRefresh(interaction);
    default:
      return unknownChoice(interaction, "subcommand", sub);
  }
}

// ─── /ex chat add ──────────────────────────────────────────────────────────

async function botChatAdd(interaction: ChatInputCommandInteraction) {
  const mode = interaction.options.getString("mode", true);
  const displayName = interaction.options.getString("display_name") || "Bot Online";
  const robloxChannel = interaction.options.getString("roblox_channel") || "LIVE";
  const existingChannel = interaction.options.getChannel("channel");
  const category = interaction.options.getChannel("category");

  if (!existingChannel && !category) {
    return interaction.reply({
      content:
        "❌ Please specify either **channel** (an existing text channel) or **category** (for the bot to create a new channel)",
      flags: MessageFlags.Ephemeral,
    });
  }

  const categoryId = existingChannel ? categoryIdOf(existingChannel) : category!.id;
  const channelId = existingChannel ? existingChannel.id : null;

  db.prepare(
    `INSERT INTO botChatChannels (guildId, categoryId, channelId, mode, displayName, robloxChannel, enabled, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(guildId) DO UPDATE SET
       categoryId = excluded.categoryId,
       mode = excluded.mode,
       displayName = excluded.displayName,
       robloxChannel = excluded.robloxChannel,
       channelId = excluded.channelId,
       enabled = 1,
       updatedAt = excluded.updatedAt`,
  ).run(interaction.guildId, categoryId, channelId, mode, displayName, robloxChannel, Date.now());

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await updateBotChatChannels();
  const modeText =
    mode === "custom" ? `Custom name ("${displayName}")` : `Roblox version (${robloxChannel})`;
  return interaction.editReply(
    `✅ Bot Chat Status ${
      existingChannel
        ? `in <#${existingChannel.id}>`
        : "(the bot will create a new channel in the selected category)"
    } with format **${modeText}** has been set up`,
  );
}

// ─── /ex chat remove ───────────────────────────────────────────────────────

async function botChatRemove(interaction: ChatInputCommandInteraction) {
  const row = db
    .prepare(`SELECT channelId FROM botChatChannels WHERE guildId = ?`)
    .get(interaction.guildId) as { channelId: string | null } | undefined;

  if (row?.channelId && interaction.guild) {
    try {
      const ch = await interaction.guild.channels.fetch(row.channelId);
      if (ch) await ch.delete("Removed via /ex chat remove");
    } catch (e) {
      logger.error(`Failed to delete bot chat channel ${row.channelId}:`, e);
    }
  }

  const result = db.prepare(`DELETE FROM botChatChannels WHERE guildId = ?`).run(interaction.guildId);
  return interaction.reply({
    content: result.changes
      ? `✅ Bot Chat Status channel has been removed`
      : `❌ Bot Chat Status is not configured`,
    flags: MessageFlags.Ephemeral,
  });
}

// ─── /ex chat list ─────────────────────────────────────────────────────────

async function botChatList(interaction: ChatInputCommandInteraction) {
  const row = db
    .prepare(
      `SELECT categoryId, channelId, mode, displayName, robloxChannel FROM botChatChannels WHERE guildId = ? AND enabled = 1`,
    )
    .get(interaction.guildId) as BotChatRow | undefined;

  if (!row) {
    return interaction.reply({ content: "_Not configured_", flags: MessageFlags.Ephemeral });
  }

  const modeDesc =
    row.mode === "custom"
      ? `Custom Name ("${row.displayName}")`
      : `Roblox Version (${row.robloxChannel})`;
  return interaction.reply({
    content: `• **Bot Chat Status** → ${
      row.channelId ? `<#${row.channelId}>` : `Category \`${row.categoryId}\``
    } (Mode: **${modeDesc}**)`,
    flags: MessageFlags.Ephemeral,
  });
}

// ─── /ex chat refresh ──────────────────────────────────────────────────────

async function botChatRefresh(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await updateBotChatChannels();
  return interaction.editReply("✅ Bot Chat Status channel name has been refreshed");
}
