import {
  MessageFlags,
  type ChannelSelectMenuInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { getVerificationConfig, updatePanelMessageId, type VerificationMode } from "../verifyManager";
import { getProtectedRoom } from "../dbCache";
import logger from "../logger";
import { panelImageFilesForPost } from "../panelImage";
import { buildVerifyPanel, buildProtectPanel, buildVerifyPublicContainer } from "./builders";
import { deny, isAdmin, panelChannel } from "./shared";

/** The select menus of the panel: string, role and channel pickers. */

export type PanelSelectInteraction =
  | StringSelectMenuInteraction
  | RoleSelectMenuInteraction
  | ChannelSelectMenuInteraction;

export async function handlePanelSelect(interaction: PanelSelectInteraction) {
  if (!isAdmin(interaction)) {
    await deny(interaction);
    return;
  }
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "❌ ใช้ได้เฉพาะใน server", flags: MessageFlags.Ephemeral });
    return;
  }

  const customId = interaction.customId;

  // ── Protect room select ──
  if (customId === "panel:protect:select") {
    const selected = interaction.values?.[0];
    await interaction.update({ components: [await buildProtectPanel(guildId, selected)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  // ── Verify mode select (string) ──
  if (customId === "panel:verify:mode") {
    await applyVerifyMode(interaction, guildId, interaction.values?.[0] === "code" ? "code" : "captcha");
    return;
  }

  // ── Verify verified role select (role) ──
  if (customId === "panel:verify:role:verified") {
    const roleId =
      interaction.values?.[0] ?? ("roles" in interaction ? interaction.roles.first()?.id : undefined);
    if (!roleId) {
      await interaction.reply({ content: "❌ ไม่ได้เลือก role", flags: MessageFlags.Ephemeral });
      return;
    }
    const cfg = getVerificationConfig(guildId);
    if (!cfg) {
      await interaction.reply({ content: "❌ ยังไม่ได้ตั้งค่า", flags: MessageFlags.Ephemeral });
      return;
    }
    const { saveVerificationConfig } = await import("../verifyManager.js");
    saveVerificationConfig({
      guildId,
      channelId: cfg.channelId,
      verifiedRoleId: roleId,
      unverifiedRoleId: cfg.unverifiedRoleId,
      embedTitle: cfg.embedTitle,
      embedDescription: cfg.embedDescription,
      successMessage: cfg.successMessage,
      imageUrl: cfg.imageUrl,
      verificationMode: cfg.verificationMode,
      createdAt: cfg.createdAt,
    });
    await interaction.update({ components: [buildVerifyPanel(guildId)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  // ── Verify channel select (channel) ──
  if (customId === "panel:verify:channel") {
    await applyVerifyChannel(interaction, guildId);
    return;
  }

  await interaction.reply({ content: "❌ Select ไม่รู้จัก", flags: MessageFlags.Ephemeral });
}

/** Switch the verification mode and re-post the public panel message. */
async function applyVerifyMode(
  interaction: PanelSelectInteraction,
  guildId: string,
  mode: VerificationMode,
) {
  const cfg = getVerificationConfig(guildId);
  if (!cfg) {
    await interaction.reply({ content: "❌ ยังไม่ได้ตั้งค่า", flags: MessageFlags.Ephemeral });
    return;
  }

  // Invalidate invite codes if switching away from code mode
  if (mode !== "code") {
    const { deleteInviteCodesForGuild } = await import("../verifyManager.js");
    deleteInviteCodesForGuild(guildId);
  }
  const { saveVerificationConfig } = await import("../verifyManager.js");
  saveVerificationConfig({
    guildId,
    channelId: cfg.channelId,
    verifiedRoleId: cfg.verifiedRoleId,
    unverifiedRoleId: cfg.unverifiedRoleId,
    embedTitle: cfg.embedTitle,
    embedDescription: cfg.embedDescription,
    successMessage: cfg.successMessage,
    imageUrl: cfg.imageUrl,
    verificationMode: mode,
    createdAt: cfg.createdAt,
  });

  // Re-post public panel if mode changed (button label depends on mode)
  if (cfg.panelMessageId && cfg.channelId) {
    const fetched = await interaction.client.channels.fetch(cfg.channelId).catch(() => null);
    const channel = panelChannel(fetched);
    if (channel?.isSendable()) {
      try {
        await channel.messages.delete(cfg.panelMessageId);
      } catch {
        /* ignore */
      }
      const newContainer = buildVerifyPublicContainer({
        embedTitle: cfg.embedTitle,
        embedDescription: cfg.embedDescription,
        mode,
        imageUrl: cfg.imageUrl,
      });
      try {
        const sent = await channel.send({
          components: [newContainer],
          files: panelImageFilesForPost(cfg.imageUrl),
          flags: MessageFlags.IsComponentsV2,
        });
        updatePanelMessageId(guildId, sent.id);
      } catch (e) {
        logger.warn(`[PANEL] re-post after mode change failed: ${e}`);
      }
    }
  }

  await interaction.update({ components: [buildVerifyPanel(guildId)], flags: MessageFlags.IsComponentsV2 });
}

/** Move the public panel message to another channel. */
async function applyVerifyChannel(
  interaction: PanelSelectInteraction,
  guildId: string,
) {
  const channelId =
    interaction.values?.[0] ??
    ("channels" in interaction ? interaction.channels.first()?.id : undefined);
  if (!channelId) {
    await interaction.reply({ content: "❌ ไม่ได้เลือก channel", flags: MessageFlags.Ephemeral });
    return;
  }
  const cfg = getVerificationConfig(guildId);
  if (!cfg) {
    await interaction.reply({ content: "❌ ยังไม่ได้ตั้งค่า", flags: MessageFlags.Ephemeral });
    return;
  }
  const oldChannelId = cfg.channelId;
  const { saveVerificationConfig } = await import("../verifyManager.js");
  saveVerificationConfig({
    guildId,
    channelId,
    verifiedRoleId: cfg.verifiedRoleId,
    unverifiedRoleId: cfg.unverifiedRoleId,
    embedTitle: cfg.embedTitle,
    embedDescription: cfg.embedDescription,
    successMessage: cfg.successMessage,
    imageUrl: cfg.imageUrl,
    verificationMode: cfg.verificationMode,
    createdAt: cfg.createdAt,
  });

  // If channel changed, delete old panel message (user can Re-post to new channel)
  if (oldChannelId !== channelId && cfg.panelMessageId) {
    const fetched = await interaction.client.channels.fetch(oldChannelId).catch(() => null);
    const oldChannel = panelChannel(fetched);
    if (oldChannel) {
      try {
        await oldChannel.messages.delete(cfg.panelMessageId);
      } catch {
        /* ignore */
      }
    }
    updatePanelMessageId(guildId, null);
  }

  await interaction.update({ components: [buildVerifyPanel(guildId)], flags: MessageFlags.IsComponentsV2 });
}
