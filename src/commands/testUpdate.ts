import {
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import db from "../lib/db";
import logger from "../lib/logger";
import { getRobloxVersionDetails } from "../lib/robloxVersion";
import { sendUpdate, sendPreUpdate } from "../monitoring/alerts";
import { getAlerts } from "../lib/dbCache";
import {
  createExecutorUpdateContainer,
  fetchExecutorData,
  formatLastBanwave,
  sendExecutorUpdateAlert,
  WeaoExploit,
} from "../monitoring/executorStatus";
import { createJoinAlertContainer } from "../lib/joinAlertCard";
import { sendV2Message } from "../lib/v2Message";

export const data = new SlashCommandBuilder()
  .setName("test")
  .setDescription("🧪 Test the alert system")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) =>
    option
      .setName("type")
      .setDescription("Select the alert type to test")
      .setRequired(true)
      .addChoices(
        { name: "🟥 Roblox Update — LIVE", value: "roblox-live" },
        { name: "🟦 Roblox Update — ZBeta", value: "roblox-zbeta" },
        { name: "🟩 Executor Update Alert", value: "executor-alert" },
        { name: "👋 Join Alert — joinalert", value: "joinalert" },
      ),
  );

async function fetchRealVersionData(channel: string): Promise<{ hash: string; version?: string }> {
  // Unified fetch (cached + WEAO fallback for LIVE) — previously a 4th
  // duplicate implementation. Falls back to channelState, then a static
  // sample only if everything is unreachable.
  const details = await getRobloxVersionDetails(channel).catch((e) => {
    logger.error(`Failed to fetch real version for ${channel}:`, e);
    return null;
  });
  if (details) return details;

  try {
    const row = db
      .prepare(`SELECT currentVersion FROM channelState WHERE robloxChannel = ?`)
      .get(channel) as { currentVersion: string } | undefined;
    if (row?.currentVersion) return { hash: row.currentVersion };
  } catch {
    // ignore — fall through to the static sample
  }
  return { hash: "version-145f189a6a974303", version: "0.732.23.7321040" };
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "❌ Administrator permission is required",
      flags: MessageFlags.Ephemeral,
    });
  }

  const type = interaction.options.getString("type", true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (type === "roblox-live") {
    const { hash, version } = await fetchRealVersionData("LIVE");
    const configured = getAlerts("LIVE", interaction.guildId ?? undefined);
    if (configured.length === 0) {
      return interaction.editReply(
        "⚠️ No channel is configured to receive Roblox updates \n\n" +
          "The bot will **not send any message** when Roblox updates because no alert is configured\n" +
          "Run this command in the channel you want to receive alerts in: `/robloxalert add roblox_channel:LIVE`, then try `/test` again",
      );
    }
    await sendUpdate(hash, "LIVE", version, interaction.guildId ?? undefined);
    return interaction.editReply(
      `✅ Test **Roblox LIVE Update** message sent with the real version \`${hash}\``,
    );
  }

  if (type === "roblox-zbeta") {
    const { hash, version } = await fetchRealVersionData("ZBeta");
    const configured = getAlerts("ZBeta", interaction.guildId ?? undefined);
    if (configured.length === 0) {
      return interaction.editReply(
        "⚠️ No channel is configured to receive ZBeta — use `/robloxalert add roblox_channel:ZBeta` first, then try `/test` again",
      );
    }
    await sendPreUpdate(hash, "ZBeta", version, interaction.guildId ?? undefined);
    return interaction.editReply(
      `✅ Test **Roblox ZBeta Update** message sent with the real version \`${hash}\``,
    );
  }

  if (type === "executor-alert") {
    const exploits = await fetchExecutorData();
    const { hash: robloxVersion } = await fetchRealVersionData("LIVE");

    // Check if configured alert channels exist in this server (guild)
    const configuredAlerts = db
      .prepare(
        `SELECT channelId, executorName, displayName FROM executorAlerts WHERE guildId = ? AND enabled = 1`,
      )
      .all(interaction.guildId) as { channelId: string; executorName: string; displayName: string }[];

    if (configuredAlerts.length > 0) {
      // Send to configured alert channels, but restrict to this guild only by passing guildId
      for (const alert of configuredAlerts) {
        const matchingExploit = exploits.find(
          (e) => e.title?.toLowerCase() === alert.executorName.toLowerCase(),
        );

        const exploitData: WeaoExploit = matchingExploit
          ? { ...matchingExploit, title: alert.displayName, updateStatus: true }
          : { title: alert.displayName, version: "1.7.0", updateStatus: true };

        // Pass interaction.guildId to ensure sendExecutorUpdateAlert only targets channels in this guild
        await sendExecutorUpdateAlert(exploitData, robloxVersion, alert.executorName, interaction.guildId ?? undefined);
      }

      return interaction.editReply(
        `✅ Test **Executor Alert** message sent to the configured alert channels (${configuredAlerts.length} entries) in this server`,
      );
    }

    // If no configured alerts, fallback to sending only to the channel where the command was used
    const workingSample = exploits.find((e) => e.title && e.version) || {
      title: "Madium",
      version: "1.7.0",
    } as WeaoExploit;

    const nowUnix = Math.floor(Date.now() / 1000);
    const verDisplay = workingSample.version?.trim() || "N/A";

    const container = createExecutorUpdateContainer({
      displayName: workingSample.title || "Madium",
      verDisplay,
      robloxVersion,
      banwaveText: formatLastBanwave(workingSample.detectionReason),
      nowUnix,
      logoUrl: workingSample.slug?.logo,
    });

    const ch = interaction.channel;
    if (ch?.isTextBased() && ch.isSendable()) {
      await ch.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return interaction.editReply(`✅ Test **Executor Alert** (${workingSample.title}) message sent in this channel`);
    }

    return interaction.editReply(`❌ Unable to send a message to this channel`);
  }

  if (type === "joinalert") {
    // Send to the configured join-alert channel for this guild when set,
    // otherwise fall back to the channel where the command was used.
    const cfg = db
      .prepare(
        `SELECT channelId, customMessage FROM memberJoinAlerts WHERE guildId = ? AND enabled = 1`,
      )
      .get(interaction.guildId) as { channelId: string; customMessage: string } | undefined;

    let target = interaction.channel;
    if (cfg) {
      try {
        const fetched = await interaction.guild?.channels.fetch(cfg.channelId);
        if (fetched?.isTextBased()) target = fetched;
      } catch {
        // Channel gone — fall back to the current channel.
      }
    }

    if (!target?.isTextBased() || !target.isSendable()) {
      return interaction.editReply("❌ Unable to send a message to this channel");
    }

    const me = interaction.user;
    const container = createJoinAlertContainer({
      username: me.username,
      avatarUrl: me.displayAvatarURL(),
      accountCreatedUnix: Math.floor(me.createdTimestamp / 1000),
    });

    // Same top text as the real welcome: mention (pings only the tester) + custom message.
    const content = `<@${me.id}>${cfg?.customMessage ? ` ${cfg.customMessage}` : ""}`;
    await sendV2Message(target, [container], content, {
      allowedMentions: { users: [me.id] },
    });

    const where = cfg ? `<#${cfg.channelId}>` : "this channel";
    return interaction.editReply(`✅ Test **Join Alert** message sent in ${where}`);
  }
}
