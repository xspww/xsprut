import {
  ChatInputCommandInteraction,
  EmbedBuilder,
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
  .setDescription("⚙️ ดูภาพรวมการตั้งค่าทั้งหมดของเซิร์ฟเวอร์")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    return interaction.reply({
      content: "❌ ใช้คำสั่งนี้ได้เฉพาะใน Server เท่านั้น",
      flags: MessageFlags.Ephemeral,
    });
  }

  // Auto-clean deleted channels from DB
  if (interaction.guild) {
    try {
      const fetchedChannels = await interaction.guild.channels.fetch();

      // Clean alerts table
      db.prepare(
        `SELECT channelId FROM alerts WHERE guildId = ?`,
      )
        .all(interaction.guildId)
        .forEach((row: any) => {
          if (!fetchedChannels.has(row.channelId)) {
            db.prepare(`DELETE FROM alerts WHERE guildId = ? AND channelId = ?`).run(interaction.guildId, row.channelId);
          }
        });
      invalidateAlerts();

      // Clean executorChatStatusChannels table
      db.prepare(
        `SELECT executorName, channelId FROM executorChatStatusChannels WHERE guildId = ?`,
      )
        .all(interaction.guildId)
        .forEach((row: any) => {
          if (row.channelId && !fetchedChannels.has(row.channelId)) {
            db.prepare(`UPDATE executorChatStatusChannels SET channelId = NULL WHERE guildId = ? AND executorName = ?`).run(interaction.guildId, row.executorName);
          }
        });

      // Clean executorStatusChannels table
      db.prepare(
        `SELECT executorName, voiceChannelId FROM executorStatusChannels WHERE guildId = ?`,
      )
        .all(interaction.guildId)
        .forEach((row: any) => {
          if (row.voiceChannelId && !fetchedChannels.has(row.voiceChannelId)) {
            db.prepare(`UPDATE executorStatusChannels SET voiceChannelId = NULL WHERE guildId = ? AND executorName = ?`).run(interaction.guildId, row.executorName);
          }
        });

      // Clean botVoiceChannels table
      db.prepare(
        `SELECT voiceChannelId FROM botVoiceChannels WHERE guildId = ?`,
      )
        .all(interaction.guildId)
        .forEach((row: any) => {
          if (row.voiceChannelId && !fetchedChannels.has(row.voiceChannelId)) {
            db.prepare(`UPDATE botVoiceChannels SET voiceChannelId = NULL WHERE guildId = ?`).run(interaction.guildId);
          }
        });

      // Clean executorEmbedStatusChannels table
      db.prepare(
        `SELECT executorName, channelId FROM executorEmbedStatusChannels WHERE guildId = ?`,
      )
        .all(interaction.guildId)
        .forEach((row: any) => {
          if (row.channelId && !fetchedChannels.has(row.channelId)) {
            db.prepare(`DELETE FROM executorEmbedStatusChannels WHERE guildId = ? AND executorName = ?`).run(interaction.guildId, row.executorName);
          }
        });

      // Clean memberJoinAlerts table
      db.prepare(`SELECT channelId FROM memberJoinAlerts WHERE guildId = ?`)
        .all(interaction.guildId)
        .forEach((row: any) => {
          if (row.channelId && !fetchedChannels.has(row.channelId)) {
            db.prepare(`DELETE FROM memberJoinAlerts WHERE guildId = ?`).run(interaction.guildId);
          }
        });
    } catch (e) {
      logger.error("Failed to auto-clean stale channels in /config:", e);
    }
  }


  // Roblox Update Alerts
  const robloxAlerts = db
    .prepare(
      `SELECT channelId, robloxChannel, customContent FROM alerts
       WHERE guildId = ? AND enabled = 1 ORDER BY robloxChannel`,
    )
    .all(interaction.guildId) as { channelId: string; robloxChannel: string; customContent: string }[];

  // Executor Voice Trackers
  const voiceTrackers = db
    .prepare(
      `SELECT executorName, displayName, categoryId, voiceChannelId FROM executorStatusChannels
       WHERE guildId = ? AND enabled = 1 ORDER BY executorName`,
    )
    .all(interaction.guildId) as {
    executorName: string;
    displayName: string;
    categoryId: string;
    voiceChannelId: string | null;
  }[];

  // Executor Chat Status Trackers
  const chatTrackers = db
    .prepare(
      `SELECT executorName, displayName, categoryId, channelId FROM executorChatStatusChannels
       WHERE guildId = ? AND enabled = 1 ORDER BY executorName`,
    )
    .all(interaction.guildId) as {
    executorName: string;
    displayName: string;
    categoryId: string;
    channelId: string | null;
  }[];

  // Executor Embed Status Trackers
  const embedTrackers = db
    .prepare(
      `SELECT executorName, displayName, channelId, intervalMs FROM executorEmbedStatusChannels
       WHERE guildId = ? AND enabled = 1 ORDER BY executorName`,
    )
    .all(interaction.guildId) as {
    executorName: string;
    displayName: string;
    channelId: string;
    intervalMs: number | null;
  }[];

  // Bot Voice Status
  const botVoiceTracker = db
    .prepare(
      `SELECT categoryId, voiceChannelId, mode, displayName, robloxChannel, omitPrefix FROM botVoiceChannels
       WHERE guildId = ? AND enabled = 1`,
    )
    .get(interaction.guildId) as {
    categoryId: string;
    voiceChannelId: string | null;
    mode: string;
    displayName: string;
    robloxChannel: string;
    omitPrefix?: number | boolean;
  } | undefined;

  // Executor Text Alert Channels
  const execAlerts = db
    .prepare(`SELECT channelId, executorName, displayName FROM executorAlerts WHERE guildId = ? AND enabled = 1`)
    .all(interaction.guildId) as { channelId: string; executorName: string; displayName: string }[];

  const embed = new EmbedBuilder()
    .setTitle("📋 การตั้งค่าเซิร์ฟเวอร์")
    .setColor(0x3b82f6)
    .setTimestamp()
    .setFooter({ text: "Diff Team" });

  // ── Current Roblox versions (from channelState — no API call) ──────────
  const versionLines = (["LIVE", "ZBeta"] as const).map((ch) => {
    const st = getChannelState(ch);
    if (!st) return `• **${ch}:** _ยังไม่เคยตรวจพบ_`;
    const numeric = st.version ? ` (${st.version})` : "";
    return `• **${ch}:** \`${st.currentVersion}\`${numeric}`;
  });

  embed.addFields({
    name: "🎮 เวอร์ชัน Roblox ปัจจุบัน",
    value: versionLines.join("\n"),
    inline: false,
  });

  // ── Roblox Update Alerts ────────────────────────────────────────────────
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
    name: "🚨 การแจ้งเตือน Roblox",
    value: robloxLines.length > 0 ? robloxLines.join("\n") : "_ยังไม่ได้ตั้งค่า_",
    inline: false,
  });

  // ── Bot Voice Status ───────────────────────────────────────────────────
  const botVoiceText = botVoiceTracker
    ? `• ${botVoiceTracker.voiceChannelId ? `<#${botVoiceTracker.voiceChannelId}>` : `Category \`${botVoiceTracker.categoryId}\``} (โหมด: **${botVoiceTracker.mode === "custom" ? `ตั้งชื่อเอง "${botVoiceTracker.displayName}"` : `เวอร์ชั่น Roblox ${botVoiceTracker.robloxChannel}`}**)`
    : "_ยังไม่ได้ตั้งค่า_";

  embed.addFields({
    name: "🤖 ห้อง Voice สถานะบอท",
    value: botVoiceText,
    inline: false,
  });

  // ── Executor Voice Trackers ─────────────────────────────────────────────
  embed.addFields({
    name: "🔊 ติดตามสถานะ Executor (Voice)",
    value:
      voiceTrackers.length > 0
        ? voiceTrackers
            .map(
              (e) =>
                `• **${e.displayName}** (\`${e.executorName}\`) → ${e.voiceChannelId ? `<#${e.voiceChannelId}>` : `Category \`${e.categoryId}\``}`,
            )
            .join("\n")
        : "_ยังไม่ได้ตั้งค่า_",
    inline: false,
  });

  // ── Executor Chat Status Trackers ────────────────────────────────────────
  embed.addFields({
    name: "💬 ติดตามสถานะ Executor (Text)",
    value:
      chatTrackers.length > 0
        ? chatTrackers
            .map(
              (e) =>
                `• **${e.displayName}** (\`${e.executorName}\`) → ${e.channelId ? `<#${e.channelId}>` : `Category \`${e.categoryId}\``}`,
            )
            .join("\n")
        : "_ยังไม่ได้ตั้งค่า_",
    inline: false,
  });

  // ── Executor Embed Status Trackers ───────────────────────────────────────
  embed.addFields({
    name: "📊 ติดตามสถานะ Executor (Embed)",
    value:
      embedTrackers.length > 0
        ? embedTrackers
            .map((e) => {
              const interval = formatIntervalMs(e.intervalMs || EMBED_REFRESH_INTERVAL_DEFAULT_MS);
              return `• **${e.displayName}** (\`${e.executorName}\`) → <#${e.channelId}> (\`${interval}\`)`;
            })
            .join("\n")
        : "_ยังไม่ได้ตั้งค่า_",
    inline: false,
  });

  const joinAlert = db
    .prepare(
      `SELECT channelId, customMessage FROM memberJoinAlerts WHERE guildId = ? AND enabled = 1`,
    )
    .get(interaction.guildId) as { channelId: string; customMessage: string } | undefined;

  embed.addFields({
    name: "👋 แจ้งเตือนสมาชิกใหม่",
    value: joinAlert
      ? `• <#${joinAlert.channelId}>${joinAlert.customMessage.trim() ? ` — \`${joinAlert.customMessage}\`` : ""}`
      : "_ยังไม่ได้ตั้งค่า_",
    inline: false,
  });

  // ── Executor Alert Channels ─────────────────────────────────────────────
  embed.addFields({
    name: "📢 แจ้งเตือนการอัปเดต Executor",
    value:
      execAlerts.length > 0
        ? execAlerts.map((a) => `• **${a.displayName}** (\`${a.executorName}\`) → <#${a.channelId}>`).join("\n")
        : "_ยังไม่ได้ตั้งค่า_",
    inline: false,
  });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
