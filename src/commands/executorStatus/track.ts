import { ChatInputCommandInteraction, MessageFlags } from "discord.js";
import db from "../../lib/db";
import logger from "../../lib/logger";
import { invalidateExecutorAlerts } from "../../lib/dbCache";
import {
  forceRefreshEmbeds,
  updateExecutorChatStatusChannels,
  updateExecutorStatusChannels,
} from "../../monitoring/executorStatus";
import { EMBED_REFRESH_INTERVAL_DEFAULT_MS, formatIntervalMs } from "../../lib/constants";
import { unknownChoice, validateInterval, type OptionChannel } from "./shared";

/** `/ex track` — Executor status and update tracking. */

type EmbedRow = { messageId: string | null; channelId: string | null };
type ChannelRow = { voiceChannelId: string | null; channelId: string | null };
type AlertListRow = { channelId: string | null; executorName: string; displayName: string };
type EmbedListRow = AlertListRow & { intervalMs: number | null };
type VoiceListRow = {
  executorName: string;
  displayName: string;
  categoryId: string | null;
  voiceChannelId: string | null;
};
type ChatListRow = {
  executorName: string;
  displayName: string;
  categoryId: string | null;
  channelId: string | null;
};

export async function handleTrack(interaction: ChatInputCommandInteraction, sub: string) {
  switch (sub) {
    case "add":
      return trackAdd(interaction);
    case "remove":
      return trackRemove(interaction);
    case "edit":
      return trackEdit(interaction);
    case "list":
      return trackList(interaction);
    case "refresh":
      return trackRefresh(interaction);
    default:
      return unknownChoice(interaction, "subcommand", sub);
  }
}

// ─── /ex track add ─────────────────────────────────────────────────────────

async function trackAdd(interaction: ChatInputCommandInteraction) {
  const display = interaction.options.getString("display", true);
  // Use the executor name (from WEAO) directly as the display name — no display_name input needed
  const executorName = interaction.options.getString("executor", true);
  const channel = interaction.options.getChannel("channel", false);
  const category = interaction.options.getChannel("category", false);

  if (display === "alert") {
    return addAlertTracker(interaction, executorName, channel);
  }
  if (display === "embed") {
    return addEmbedTracker(interaction, executorName, channel);
  }
  if (display === "voice" || display === "chat") {
    return addChannelTracker(interaction, executorName, category, display);
  }
  return unknownChoice(interaction, "tracker type", display);
}

async function addAlertTracker(
  interaction: ChatInputCommandInteraction,
  executorName: string,
  channel: OptionChannel | null,
) {
  if (!channel) {
    return interaction.reply({
      content: "❌ Please specify a **channel** (text channel) for alerts",
      flags: MessageFlags.Ephemeral,
    });
  }

  const alertContent = interaction.options.getString("content") ?? "";
  db.prepare(
    `INSERT INTO executorAlerts (guildId, channelId, executorName, displayName, customContent, enabled)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(guildId, channelId, executorName) DO UPDATE SET displayName = excluded.displayName, customContent = excluded.customContent, enabled = 1`,
  ).run(interaction.guildId, channel.id, executorName, executorName, alertContent);
  invalidateExecutorAlerts();

  return interaction.reply({
    content: `✅ Alert Message for **${executorName}** in <#${channel.id}> has been set up`,
    flags: MessageFlags.Ephemeral,
  });
}

async function addEmbedTracker(
  interaction: ChatInputCommandInteraction,
  executorName: string,
  channel: OptionChannel | null,
) {
  if (!channel) {
    return interaction.reply({
      content: "❌ Please specify a **channel** (text channel) for Embed Status",
      flags: MessageFlags.Ephemeral,
    });
  }
  const customContent = interaction.options.getString("content") ?? "";

  const intervalRaw = interaction.options.getString("interval");
  let intervalMs = EMBED_REFRESH_INTERVAL_DEFAULT_MS;
  if (intervalRaw) {
    const parsed = validateInterval(intervalRaw);
    if (!parsed.ok) {
      return interaction.reply({ content: parsed.content, flags: MessageFlags.Ephemeral });
    }
    intervalMs = parsed.ms;
  }

  db.prepare(
    `INSERT INTO executorEmbedStatusChannels (guildId, channelId, executorName, displayName, customContent, intervalMs, enabled, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(guildId, channelId, executorName) DO UPDATE SET displayName = excluded.displayName, customContent = excluded.customContent, intervalMs = excluded.intervalMs, enabled = 1, updatedAt = excluded.updatedAt`,
  ).run(interaction.guildId, channel.id, executorName, executorName, customContent, intervalMs, Date.now());

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await forceRefreshEmbeds();

  return interaction.editReply(
    `✅ Status embed for **${executorName}** in <#${channel.id}> has been set up (auto-updates every **${formatIntervalMs(intervalMs)}**)`,
  );
}

async function addChannelTracker(
  interaction: ChatInputCommandInteraction,
  executorName: string,
  category: OptionChannel | null,
  display: "voice" | "chat",
) {
  if (!category) {
    return interaction.reply({
      content: "❌ Please specify a **category** for the bot to create a channel in",
      flags: MessageFlags.Ephemeral,
    });
  }

  const table = display === "voice" ? "executorStatusChannels" : "executorChatStatusChannels";
  const channelIdField = display === "voice" ? "voiceChannelId" : "channelId";

  db.prepare(
    `INSERT INTO ${table} (guildId, categoryId, executorName, displayName, ${channelIdField}, updatedAt)
     VALUES (?, ?, ?, ?, NULL, ?)
     ON CONFLICT(guildId, executorName) DO UPDATE SET
       categoryId = excluded.categoryId,
       displayName = excluded.displayName,
       enabled = 1,
       updatedAt = excluded.updatedAt`,
  ).run(interaction.guildId, category.id, executorName, executorName, Date.now());

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (display === "voice") {
    await updateExecutorStatusChannels();
  } else {
    await updateExecutorChatStatusChannels();
  }

  return interaction.editReply(
    `✅ ${display === "voice" ? "Voice" : "Text"} Status for **${executorName}** in category \`${category.id}\` has been set up`,
  );
}

// ─── /ex track remove ──────────────────────────────────────────────────────

async function trackRemove(interaction: ChatInputCommandInteraction) {
  const display = interaction.options.getString("display", true);
  const executorName = interaction.options.getString("executor", true);
  const channel = interaction.options.getChannel("channel", false);

  if (display === "embed") {
    return removeEmbedTracker(interaction, executorName, channel);
  }
  if (display === "alert") {
    return removeAlertTracker(interaction, executorName, channel);
  }
  if (display === "voice" || display === "chat") {
    return removeChannelTracker(interaction, executorName, display);
  }
  return unknownChoice(interaction, "tracker type", display);
}

async function removeEmbedTracker(
  interaction: ChatInputCommandInteraction,
  executorName: string,
  channel: OptionChannel | null,
) {
  const row = db
    .prepare(`SELECT messageId, channelId FROM executorEmbedStatusChannels WHERE guildId = ? AND LOWER(executorName) = ?`)
    .get(interaction.guildId, executorName.toLowerCase()) as EmbedRow | undefined;

  if (row?.messageId && row?.channelId && interaction.guild) {
    try {
      const ch = await interaction.guild.channels.fetch(row.channelId);
      if (ch?.isTextBased()) {
        const msg = await ch.messages.fetch(row.messageId);
        if (msg) await msg.delete();
      }
    } catch (e) {
      logger.error(`Failed to delete embed message ${row?.messageId}:`, e);
    }
  }

  const result = channel
    ? db
        .prepare(`DELETE FROM executorEmbedStatusChannels WHERE guildId = ? AND channelId = ? AND LOWER(executorName) = ?`)
        .run(interaction.guildId, channel.id, executorName.toLowerCase())
    : db
        .prepare(`DELETE FROM executorEmbedStatusChannels WHERE guildId = ? AND LOWER(executorName) = ?`)
        .run(interaction.guildId, executorName.toLowerCase());

  return interaction.reply({
    content: result.changes
      ? `✅ Embed Status for **${executorName}** has been removed`
      : `❌ No Embed Status configuration found for **${executorName}**`,
    flags: MessageFlags.Ephemeral,
  });
}

async function removeAlertTracker(
  interaction: ChatInputCommandInteraction,
  executorName: string,
  channel: OptionChannel | null,
) {
  const result = channel
    ? db
        .prepare(`DELETE FROM executorAlerts WHERE guildId = ? AND channelId = ? AND LOWER(executorName) = ?`)
        .run(interaction.guildId, channel.id, executorName.toLowerCase())
    : db
        .prepare(`DELETE FROM executorAlerts WHERE guildId = ? AND LOWER(executorName) = ?`)
        .run(interaction.guildId, executorName.toLowerCase());
  invalidateExecutorAlerts();

  return interaction.reply({
    content: result.changes
      ? `✅ Alerts for **${executorName}** have been removed from Alert Messages`
      : `❌ No Alert Message configuration found for **${executorName}**`,
    flags: MessageFlags.Ephemeral,
  });
}

async function removeChannelTracker(
  interaction: ChatInputCommandInteraction,
  executorName: string,
  display: "voice" | "chat",
) {
  const table = display === "voice" ? "executorStatusChannels" : "executorChatStatusChannels";
  const channelIdField = display === "voice" ? "voiceChannelId" : "channelId";

  const row = db
    .prepare(`SELECT ${channelIdField} FROM ${table} WHERE guildId = ? AND LOWER(executorName) = ?`)
    .get(interaction.guildId, executorName.toLowerCase()) as ChannelRow | undefined;

  const channelId = row?.[channelIdField];
  if (channelId && interaction.guild) {
    try {
      const ch = await interaction.guild.channels.fetch(channelId);
      if (ch) await ch.delete(`Removed via /ex track remove (${display})`);
    } catch (e) {
      logger.error(`Failed to delete ${display} channel ${channelId}:`, e);
    }
  }

  const result = db
    .prepare(`DELETE FROM ${table} WHERE guildId = ? AND LOWER(executorName) = ?`)
    .run(interaction.guildId, executorName.toLowerCase());

  return interaction.reply({
    content: result.changes
      ? `✅ ${display === "voice" ? "Voice" : "Text"} Status for **${executorName}** has been removed`
      : `❌ No ${display === "voice" ? "Voice" : "Text"} Status configuration found for **${executorName}**`,
    flags: MessageFlags.Ephemeral,
  });
}

// ─── /ex track edit ────────────────────────────────────────────────────────

async function trackEdit(interaction: ChatInputCommandInteraction) {
  const executorName = interaction.options.getString("executor", true);
  const newContent = interaction.options.getString("content");
  const newIntervalRaw = interaction.options.getString("interval");

  if (newContent === null && newIntervalRaw === null) {
    return interaction.reply({
      content: "❌ Please specify at least one thing to edit (**content** or **interval**)",
      flags: MessageFlags.Ephemeral,
    });
  }

  let newIntervalMs: number | null = null;
  if (newIntervalRaw !== null) {
    const parsed = validateInterval(newIntervalRaw);
    if (!parsed.ok) {
      return interaction.reply({ content: parsed.content, flags: MessageFlags.Ephemeral });
    }
    newIntervalMs = parsed.ms;
  }

  const embedUpdated = updateEmbedTracker(interaction, executorName, newContent, newIntervalMs);
  const alertUpdated = updateAlertTracker(interaction, executorName, newContent);

  if (!embedUpdated && !alertUpdated) {
    return interaction.reply({
      content: `❌ No configuration found for **${executorName}**`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await updateExecutorStatusChannels();

  const intervalNote =
    newIntervalMs !== null ? ` (auto-updates every **${formatIntervalMs(newIntervalMs)}**)` : "";
  return interaction.editReply(
    `✅ Settings for **${executorName}** have been updated and embeds/status refreshed${intervalNote}`,
  );
}

function updateEmbedTracker(
  interaction: ChatInputCommandInteraction,
  executorName: string,
  newContent: string | null,
  newIntervalMs: number | null,
): boolean {
  const embedRow = db
    .prepare(`SELECT channelId FROM executorEmbedStatusChannels WHERE guildId = ? AND LOWER(executorName) = ?`)
    .get(interaction.guildId, executorName.toLowerCase());
  if (!embedRow) return false;

  if (newContent !== null) {
    db.prepare(
      `UPDATE executorEmbedStatusChannels SET customContent = ?, updatedAt = ? WHERE guildId = ? AND LOWER(executorName) = ?`,
    ).run(newContent, Date.now(), interaction.guildId, executorName.toLowerCase());
  }
  if (newIntervalMs !== null) {
    db.prepare(
      `UPDATE executorEmbedStatusChannels SET intervalMs = ?, updatedAt = ? WHERE guildId = ? AND LOWER(executorName) = ?`,
    ).run(newIntervalMs, Date.now(), interaction.guildId, executorName.toLowerCase());
  }
  return true;
}

function updateAlertTracker(
  interaction: ChatInputCommandInteraction,
  executorName: string,
  newContent: string | null,
): boolean {
  const alertRow = db
    .prepare(`SELECT channelId FROM executorAlerts WHERE guildId = ? AND LOWER(executorName) = ?`)
    .get(interaction.guildId, executorName.toLowerCase());
  if (!alertRow) return false;

  if (newContent !== null) {
    db.prepare(
      `UPDATE executorAlerts SET customContent = ? WHERE guildId = ? AND LOWER(executorName) = ?`,
    ).run(newContent, interaction.guildId, executorName.toLowerCase());
  }
  invalidateExecutorAlerts();
  return true;
}

// ─── /ex track list ────────────────────────────────────────────────────────

async function trackList(interaction: ChatInputCommandInteraction) {
  const alerts = db
    .prepare(`SELECT channelId, executorName, displayName FROM executorAlerts WHERE guildId = ? AND enabled = 1`)
    .all(interaction.guildId) as AlertListRow[];
  const embeds = db
    .prepare(`SELECT channelId, executorName, displayName, intervalMs FROM executorEmbedStatusChannels WHERE guildId = ? AND enabled = 1`)
    .all(interaction.guildId) as EmbedListRow[];
  const voice = db
    .prepare(`SELECT executorName, displayName, categoryId, voiceChannelId FROM executorStatusChannels WHERE guildId = ? AND enabled = 1`)
    .all(interaction.guildId) as VoiceListRow[];
  const chat = db
    .prepare(`SELECT executorName, displayName, categoryId, channelId FROM executorChatStatusChannels WHERE guildId = ? AND enabled = 1`)
    .all(interaction.guildId) as ChatListRow[];

  if (alerts.length === 0 && embeds.length === 0 && voice.length === 0 && chat.length === 0) {
    return interaction.reply({ content: "_No configurations yet_", flags: MessageFlags.Ephemeral });
  }

  return interaction.reply({
    content: buildTrackerList(alerts, embeds, voice, chat).join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}

function buildTrackerList(
  alerts: AlertListRow[],
  embeds: EmbedListRow[],
  voice: VoiceListRow[],
  chat: ChatListRow[],
): string[] {
  const lines: string[] = [];

  if (alerts.length > 0) {
    lines.push("**📢 Alert Messages:**");
    lines.push(...alerts.map((r) => `• **${r.displayName}** (\`${r.executorName}\`) → <#${r.channelId}>`));
  }
  if (embeds.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("**📊 Embed Status (Auto-updated):**");
    lines.push(...embedTrackerLines(embeds));
  }
  if (voice.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("**🔊 Voice Status:**");
    lines.push(...voiceTrackerLines(voice));
  }
  if (chat.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("**💬 Text Status:**");
    lines.push(...chatTrackerLines(chat));
  }

  return lines;
}

function embedTrackerLines(embeds: EmbedListRow[]): string[] {
  return embeds.map((r) => {
    const interval = formatIntervalMs(r.intervalMs || EMBED_REFRESH_INTERVAL_DEFAULT_MS);
    return `• **${r.displayName}** (\`${r.executorName}\`) → <#${r.channelId}> (\`${interval}\`)`;
  });
}

function voiceTrackerLines(voice: VoiceListRow[]): string[] {
  return voice.map(
    (r) =>
      `• **${r.displayName}** (\`${r.executorName}\`) → ${
        r.voiceChannelId ? `<#${r.voiceChannelId}>` : `Category: \`${r.categoryId}\``
      }`,
  );
}

function chatTrackerLines(chat: ChatListRow[]): string[] {
  return chat.map(
    (r) =>
      `• **${r.displayName}** (\`${r.executorName}\`) → ${
        r.channelId ? `<#${r.channelId}>` : `Category: \`${r.categoryId}\``
      }`,
  );
}

// ─── /ex track refresh ─────────────────────────────────────────────────────

async function trackRefresh(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await updateExecutorStatusChannels(); // This also updates chat channels
  await forceRefreshEmbeds();
  return interaction.editReply("✅ All Executor statuses have been force-updated");
}
