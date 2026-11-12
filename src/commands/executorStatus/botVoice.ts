import { ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { getVoiceConnection } from "@discordjs/voice";
import db from "../../lib/db";
import logger from "../../lib/logger";
import { updateBotVoiceChannels } from "../../monitoring/executorStatus";
import { categoryIdOf, unknownChoice, type OptionChannel } from "./shared";

/** `/ex voice` — the voice channel the bot stays in, renamed with its status. */

type BotVoiceRow = {
  categoryId: string | null;
  voiceChannelId: string | null;
  mode: string;
  displayName: string;
  robloxChannel: string;
};

export async function handleBotVoice(interaction: ChatInputCommandInteraction, sub: string) {
  switch (sub) {
    case "add":
      return botVoiceAdd(interaction);
    case "remove":
      return botVoiceRemove(interaction);
    case "list":
      return botVoiceList(interaction);
    case "refresh":
      return botVoiceRefresh(interaction);
    default:
      return unknownChoice(interaction, "subcommand", sub);
  }
}

// ─── /ex voice add ─────────────────────────────────────────────────────────

async function botVoiceAdd(interaction: ChatInputCommandInteraction) {
  const mode = interaction.options.getString("mode", true);
  const displayName = interaction.options.getString("display_name") || "Bot Online";
  const robloxChannel = interaction.options.getString("roblox_channel") || "LIVE";
  const existingChannel = interaction.options.getChannel("channel");
  const category = interaction.options.getChannel("category");

  if (!existingChannel && !category) {
    return interaction.reply({
      content:
        "❌ Please specify either **channel** (an existing voice channel) or **category** (for the bot to create a new channel)",
      flags: MessageFlags.Ephemeral,
    });
  }

  const modeText =
    mode === "custom" ? `Custom name ("${displayName}")` : `Roblox version (${robloxChannel})`;

  if (existingChannel) {
    return addBotVoiceToChannel(interaction, existingChannel, mode, displayName, robloxChannel, modeText);
  }

  return addBotVoiceToCategory(interaction, category!, mode, displayName, robloxChannel, modeText);
}

/** Point the bot status at a voice channel that already exists. */
async function addBotVoiceToChannel(
  interaction: ChatInputCommandInteraction,
  existingChannel: OptionChannel,
  mode: string,
  displayName: string,
  robloxChannel: string,
  modeText: string,
) {
  db.prepare(
    `INSERT INTO botVoiceChannels (guildId, categoryId, voiceChannelId, mode, displayName, robloxChannel, enabled, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(guildId) DO UPDATE SET
       categoryId = excluded.categoryId,
       mode = excluded.mode,
       displayName = excluded.displayName,
       robloxChannel = excluded.robloxChannel,
       voiceChannelId = excluded.voiceChannelId,
       enabled = 1,
       updatedAt = excluded.updatedAt`,
  ).run(
    interaction.guildId,
    categoryIdOf(existingChannel),
    existingChannel.id,
    mode,
    displayName,
    robloxChannel,
    Date.now(),
  );

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await updateBotVoiceChannels();
  return interaction.editReply(
    `✅ Bot Voice Status in <#${existingChannel.id}> with format **${modeText}** has been set up`,
  );
}

/** Let the bot create its own voice channel inside the chosen category. */
async function addBotVoiceToCategory(
  interaction: ChatInputCommandInteraction,
  category: OptionChannel,
  mode: string,
  displayName: string,
  robloxChannel: string,
  modeText: string,
) {
  db.prepare(
    `INSERT INTO botVoiceChannels (guildId, categoryId, voiceChannelId, mode, displayName, robloxChannel, enabled, updatedAt)
     VALUES (?, ?, NULL, ?, ?, ?, 1, ?)
     ON CONFLICT(guildId) DO UPDATE SET
       categoryId = excluded.categoryId,
       mode = excluded.mode,
       displayName = excluded.displayName,
       robloxChannel = excluded.robloxChannel,
       voiceChannelId = NULL,
       enabled = 1,
       updatedAt = excluded.updatedAt`,
  ).run(interaction.guildId, category.id, mode, displayName, robloxChannel, Date.now());

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await updateBotVoiceChannels();
  return interaction.editReply(
    `✅ Bot Voice Status in category \`${category.id}\` with format **${modeText}** has been set up`,
  );
}

// ─── /ex voice remove ──────────────────────────────────────────────────────

async function botVoiceRemove(interaction: ChatInputCommandInteraction) {
  try {
    // `guildId` is checked by the command entry point; the guard keeps the
    // type honest if this handler is ever called from somewhere else.
    if (interaction.guildId) {
      const conn = getVoiceConnection(interaction.guildId);
      if (conn) conn.destroy();
    }
  } catch (e) {
    logger.warn(
      "Executor status refresh failed: ",
      e instanceof Error ? e.message : String(e),
    );
  }

  const row = db
    .prepare(`SELECT voiceChannelId FROM botVoiceChannels WHERE guildId = ?`)
    .get(interaction.guildId) as { voiceChannelId: string | null } | undefined;

  if (row?.voiceChannelId && interaction.guild) {
    try {
      const ch = await interaction.guild.channels.fetch(row.voiceChannelId);
      if (ch) await ch.delete("Removed via /ex voice remove");
    } catch (e) {
      logger.error(`Failed to delete bot voice channel ${row.voiceChannelId}:`, e);
    }
  }

  const result = db.prepare(`DELETE FROM botVoiceChannels WHERE guildId = ?`).run(interaction.guildId);
  return interaction.reply({
    content: result.changes
      ? `✅ Bot Voice Status channel has been removed`
      : `❌ Bot Voice Status is not configured`,
    flags: MessageFlags.Ephemeral,
  });
}

// ─── /ex voice list ────────────────────────────────────────────────────────

async function botVoiceList(interaction: ChatInputCommandInteraction) {
  const row = db
    .prepare(
      `SELECT categoryId, voiceChannelId, mode, displayName, robloxChannel FROM botVoiceChannels WHERE guildId = ? AND enabled = 1`,
    )
    .get(interaction.guildId) as BotVoiceRow | undefined;

  if (!row) {
    return interaction.reply({ content: "_Not configured_", flags: MessageFlags.Ephemeral });
  }

  const modeDesc =
    row.mode === "custom"
      ? `Custom Name ("${row.displayName}")`
      : `Roblox Version (${row.robloxChannel})`;
  return interaction.reply({
    content: `• **Bot Voice Status** → ${
      row.voiceChannelId ? `<#${row.voiceChannelId}>` : `Category \`${row.categoryId}\``
    } (Mode: **${modeDesc}**)`,
    flags: MessageFlags.Ephemeral,
  });
}

// ─── /ex voice refresh ─────────────────────────────────────────────────────

async function botVoiceRefresh(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await updateBotVoiceChannels();
  return interaction.editReply("✅ Bot Voice Status channel name has been refreshed");
}
