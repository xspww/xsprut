import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  Guild,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import db from "../lib/db";
import logger from "../lib/logger";
import { getChannelState, invalidateAlerts } from "../lib/dbCache";
import {
  EMBED_REFRESH_INTERVAL_DEFAULT_MS,
  formatIntervalMs,
} from "../lib/constants";

export const data = new SlashCommandBuilder()
  .setName("config")
  .setDescription("⚙️ View an overview of all server settings")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    return interaction.reply({
      content: "❌ This command can only be used in a server",
      flags: MessageFlags.Ephemeral,
    });
  }

  // Auto-clean deleted channels from DB
  if (interaction.guild) {
    await cleanupStaleChannels(interaction.guild, interaction.guildId);
  }

  return interaction.reply({
    embeds: [buildSettingsEmbed(interaction.guildId)],
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Drop or detach every channel reference that no longer exists.
 *
 * A channel deleted in Discord leaves a dangling row behind; the background
 * refreshers would keep trying to rename it. Runs before the overview is
 * built so the embed shows the cleaned-up state.
 */
async function cleanupStaleChannels(guild: Guild, guildId: string) {
  try {
    const fetchedChannels = await guild.channels.fetch();
    const isGone = (channelId: string) => !fetchedChannels.has(channelId);

    cleanAlertChannels(guildId, isGone);
    cleanChatStatusChannels(guildId, isGone);
    cleanVoiceStatusChannels(guildId, isGone);
    cleanBotVoiceChannel(guildId, isGone);
    cleanEmbedStatusChannels(guildId, isGone);
    cleanJoinAlertChannel(guildId, isGone);
  } catch (e) {
    logger.error("Failed to auto-clean stale channels in /config:", e);
  }
}

/** Delete the alert rows whose channel is gone. */
function cleanAlertChannels(guildId: string, isGone: (channelId: string) => boolean) {
  const rows = db
    .prepare(`SELECT channelId FROM alerts WHERE guildId = ?`)
    .all(guildId) as { channelId: string }[];
  for (const row of rows) {
    if (isGone(row.channelId)) {
      db.prepare(`DELETE FROM alerts WHERE guildId = ? AND channelId = ?`).run(guildId, row.channelId);
    }
  }
  invalidateAlerts();
}

/** Detach the executor text-status rows whose channel is gone. */
function cleanChatStatusChannels(guildId: string, isGone: (channelId: string) => boolean) {
  const rows = db
    .prepare(`SELECT executorName, channelId FROM executorChatStatusChannels WHERE guildId = ?`)
    .all(guildId) as { executorName: string; channelId: string | null }[];
  for (const row of rows) {
    if (row.channelId && isGone(row.channelId)) {
      db.prepare(
        `UPDATE executorChatStatusChannels SET channelId = NULL WHERE guildId = ? AND executorName = ?`,
      ).run(guildId, row.executorName);
    }
  }
}

/** Detach the executor voice-status rows whose channel is gone. */
function cleanVoiceStatusChannels(guildId: string, isGone: (channelId: string) => boolean) {
  const rows = db
    .prepare(`SELECT executorName, voiceChannelId FROM executorStatusChannels WHERE guildId = ?`)
    .all(guildId) as { executorName: string; voiceChannelId: string | null }[];
  for (const row of rows) {
    if (row.voiceChannelId && isGone(row.voiceChannelId)) {
      db.prepare(
        `UPDATE executorStatusChannels SET voiceChannelId = NULL WHERE guildId = ? AND executorName = ?`,
      ).run(guildId, row.executorName);
    }
  }
}

/** Detach the bot voice-status row whose channel is gone. */
function cleanBotVoiceChannel(guildId: string, isGone: (channelId: string) => boolean) {
  const rows = db
    .prepare(`SELECT voiceChannelId FROM botVoiceChannels WHERE guildId = ?`)
    .all(guildId) as { voiceChannelId: string | null }[];
  for (const row of rows) {
    if (row.voiceChannelId && isGone(row.voiceChannelId)) {
      db.prepare(`UPDATE botVoiceChannels SET voiceChannelId = NULL WHERE guildId = ?`).run(guildId);
    }
  }
}

/** Delete the executor embed-status rows whose channel is gone. */
function cleanEmbedStatusChannels(guildId: string, isGone: (channelId: string) => boolean) {
  const rows = db
    .prepare(`SELECT executorName, channelId FROM executorEmbedStatusChannels WHERE guildId = ?`)
    .all(guildId) as { executorName: string; channelId: string | null }[];
  for (const row of rows) {
    if (row.channelId && isGone(row.channelId)) {
      db.prepare(
        `DELETE FROM executorEmbedStatusChannels WHERE guildId = ? AND executorName = ?`,
      ).run(guildId, row.executorName);
    }
  }
}

/** Delete the join-alert row whose channel is gone. */
function cleanJoinAlertChannel(guildId: string, isGone: (channelId: string) => boolean) {
  const rows = db
    .prepare(`SELECT channelId FROM memberJoinAlerts WHERE guildId = ?`)
    .all(guildId) as { channelId: string | null }[];
  for (const row of rows) {
    if (row.channelId && isGone(row.channelId)) {
      db.prepare(`DELETE FROM memberJoinAlerts WHERE guildId = ?`).run(guildId);
    }
  }
}

// ─── Row shapes ────────────────────────────────────────────────────────────

type RobloxAlertRow = { channelId: string; robloxChannel: string; customContent: string };
type TrackerRow = {
  executorName: string;
  displayName: string;
  categoryId: string;
  channelId: string | null;
};
type EmbedTrackerRow = {
  executorName: string;
  displayName: string;
  channelId: string;
  intervalMs: number | null;
};
type BotVoiceRow = {
  categoryId: string;
  voiceChannelId: string | null;
  mode: string;
  displayName: string;
  robloxChannel: string;
  omitPrefix?: number | boolean;
};
type ExecAlertRow = { channelId: string; executorName: string; displayName: string };
type JoinAlertRow = { channelId: string; customMessage: string };

/** Build the "Server Settings" overview embed for one guild. */
function buildSettingsEmbed(guildId: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("📋 Server Settings")
    .setColor(0x3b82f6)
    .setTimestamp()
    .setFooter({ text: "Diff Team" });

  addVersionSection(embed);
  addRobloxAlertsSection(embed, guildId);
  addBotVoiceSection(embed, guildId);
  addExecutorTrackerSections(embed, guildId);
  addJoinAlertSection(embed, guildId);
  addExecutorAlertSection(embed, guildId);

  return embed;
}

// ─── Embed sections ────────────────────────────────────────────────────────

/** Current Roblox versions, read from the cache — no API call. */
function addVersionSection(embed: EmbedBuilder) {
  const versionLines = (["LIVE", "ZBeta"] as const).map((ch) => {
    const st = getChannelState(ch);
    if (!st) return `• **${ch}:** _Never detected_`;
    const numeric = st.version ? ` (${st.version})` : "";
    return `• **${ch}:** \`${st.currentVersion}\`${numeric}`;
  });

  embed.addFields({
    name: "🎮 Current Roblox Versions",
    value: versionLines.join("\n"),
    inline: false,
  });
}

/** Roblox update alert channels, split by Roblox channel. */
function addRobloxAlertsSection(embed: EmbedBuilder, guildId: string) {
  const robloxAlerts = db
    .prepare(
      `SELECT channelId, robloxChannel, customContent FROM alerts
       WHERE guildId = ? AND enabled = 1 ORDER BY robloxChannel`,
    )
    .all(guildId) as RobloxAlertRow[];

  const liveAlerts = robloxAlerts.filter((a) => a.robloxChannel === "LIVE");
  const zbetaAlerts = robloxAlerts.filter((a) => a.robloxChannel === "ZBeta");
  const robloxLines: string[] = [];

  if (liveAlerts.length > 0) {
    robloxLines.push("**LIVE:**");
    robloxLines.push(...liveAlerts.map((a) => `• <#${a.channelId}>${a.customContent.trim() ? ` — \`${a.customContent}\`` : ""}`));
  }
  if (zbetaAlerts.length > 0) {
    if (robloxLines.length > 0) robloxLines.push("");
    robloxLines.push("**ZBeta:**");
    robloxLines.push(...zbetaAlerts.map((a) => `• <#${a.channelId}>${a.customContent.trim() ? ` — \`${a.customContent}\`` : ""}`));
  }

  embed.addFields({
    name: "🚨 Roblox Alerts",
    value: robloxLines.length > 0 ? robloxLines.join("\n") : "_Not configured_",
    inline: false,
  });
}

/** The channel the bot itself keeps renamed with its status. */
function addBotVoiceSection(embed: EmbedBuilder, guildId: string) {
  const botVoiceTracker = db
    .prepare(
      `SELECT categoryId, voiceChannelId, mode, displayName, robloxChannel, omitPrefix FROM botVoiceChannels
       WHERE guildId = ? AND enabled = 1`,
    )
    .get(guildId) as BotVoiceRow | undefined;

  const botVoiceText = botVoiceTracker
    ? `• ${botVoiceTracker.voiceChannelId ? `<#${botVoiceTracker.voiceChannelId}>` : `Category \`${botVoiceTracker.categoryId}\``} (Mode: **${botVoiceTracker.mode === "custom" ? `Custom name "${botVoiceTracker.displayName}"` : `Roblox version ${botVoiceTracker.robloxChannel}`}**)`
    : "_Not configured_";

  embed.addFields({
    name: "🤖 Bot Status Voice Channel",
    value: botVoiceText,
    inline: false,
  });
}

/** Executor trackers, one field per display mode. */
function addExecutorTrackerSections(embed: EmbedBuilder, guildId: string) {
  const voiceTrackers = db
    .prepare(
      `SELECT executorName, displayName, categoryId, voiceChannelId FROM executorStatusChannels
       WHERE guildId = ? AND enabled = 1 ORDER BY executorName`,
    )
    .all(guildId) as (TrackerRow & { voiceChannelId: string | null })[];

  const chatTrackers = db
    .prepare(
      `SELECT executorName, displayName, categoryId, channelId FROM executorChatStatusChannels
       WHERE guildId = ? AND enabled = 1 ORDER BY executorName`,
    )
    .all(guildId) as TrackerRow[];

  const embedTrackers = db
    .prepare(
      `SELECT executorName, displayName, channelId, intervalMs FROM executorEmbedStatusChannels
       WHERE guildId = ? AND enabled = 1 ORDER BY executorName`,
    )
    .all(guildId) as EmbedTrackerRow[];

  embed.addFields({
    name: "🔊 Executor Tracking (Voice)",
    value:
      voiceTrackers.length > 0
        ? voiceTrackers
            .map(
              (e) =>
                `• **${e.displayName}** (\`${e.executorName}\`) → ${e.voiceChannelId ? `<#${e.voiceChannelId}>` : `Category \`${e.categoryId}\``}`,
            )
            .join("\n")
        : "_Not configured_",
    inline: false,
  });

  embed.addFields({
    name: "💬 Executor Tracking (Text)",
    value:
      chatTrackers.length > 0
        ? chatTrackers
            .map(
              (e) =>
                `• **${e.displayName}** (\`${e.executorName}\`) → ${e.channelId ? `<#${e.channelId}>` : `Category \`${e.categoryId}\``}`,
            )
            .join("\n")
        : "_Not configured_",
    inline: false,
  });

  embed.addFields({
    name: "📊 Executor Tracking (Embed)",
    value:
      embedTrackers.length > 0
        ? embedTrackers
            .map((e) => {
              const interval = formatIntervalMs(e.intervalMs || EMBED_REFRESH_INTERVAL_DEFAULT_MS);
              return `• **${e.displayName}** (\`${e.executorName}\`) → <#${e.channelId}> (\`${interval}\`)`;
            })
            .join("\n")
        : "_Not configured_",
    inline: false,
  });
}

/** The channel that greets new members. */
function addJoinAlertSection(embed: EmbedBuilder, guildId: string) {
  const joinAlert = db
    .prepare(
      `SELECT channelId, customMessage FROM memberJoinAlerts WHERE guildId = ? AND enabled = 1`,
    )
    .get(guildId) as JoinAlertRow | undefined;

  embed.addFields({
    name: "👋 New Member Alerts",
    value: joinAlert
      ? `• <#${joinAlert.channelId}>${joinAlert.customMessage.trim() ? ` — \`${joinAlert.customMessage}\`` : ""}`
      : "_Not configured_",
    inline: false,
  });
}

/** Channels that get a message when an executor updates. */
function addExecutorAlertSection(embed: EmbedBuilder, guildId: string) {
  const execAlerts = db
    .prepare(`SELECT channelId, executorName, displayName FROM executorAlerts WHERE guildId = ? AND enabled = 1`)
    .all(guildId) as ExecAlertRow[];

  embed.addFields({
    name: "📢 Executor Update Alerts",
    value:
      execAlerts.length > 0
        ? execAlerts.map((a) => `• **${a.displayName}** (\`${a.executorName}\`) → <#${a.channelId}>`).join("\n")
        : "_Not configured_",
    inline: false,
  });
}
