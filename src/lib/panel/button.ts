import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
} from "discord.js";
import db from "../db";
import logger from "../logger";
import { getProtectedRoom, invalidateProtectedRoom } from "../dbCache";
import { disableVerificationConfig, getVerificationConfig, updatePanelMessageId } from "../verifyManager";
import { deleteLocalPanelImage, panelImageFilesForPost } from "../panelImage";
import { buildProtectRoomNoticeComponents, type ProtectAction } from "../protectRoom";
import {
  buildComingSoonPanel,
  buildMainMenu,
  buildProtectPanel,
  buildStatusPanel,
  buildVerifyEditModal,
  buildVerifyPublicContainer,
  buildVerifyPanel,
} from "./builders";
import { deny, isAdmin, panelChannel, type PanelMessageChannel, type ProtectedRoomRow } from "./shared";

/** The panel's buttons. */

export async function handlePanelButton(interaction: ButtonInteraction) {
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

  if (await handleNavigationButton(interaction, guildId, customId)) return;
  if (await handleVerifyButton(interaction, guildId, customId)) return;
  if (await handleProtectButton(interaction, guildId, customId)) return;

  // Unknown
  await interaction.reply({ content: "❌ ปุ่มไม่รู้จัก", flags: MessageFlags.Ephemeral });
}

/**
 * The navigation buttons: main menu, refresh and category pages.
 *
 * Returns true when the button was handled.
 */
async function handleNavigationButton(
  interaction: ButtonInteraction,
  guildId: string,
  customId: string,
): Promise<boolean> {
  // Main menu
  if (customId === "panel:main" || customId === "panel:back") {
    await interaction.update({ components: [buildMainMenu()], flags: MessageFlags.IsComponentsV2 });
    return true;
  }

  if (await handleRefreshButton(interaction, guildId, customId)) return true;
  if (await handleCategoryButton(interaction, guildId, customId)) return true;

  return false;
}

/**
 * The refresh buttons — they re-render the view the user is already on.
 *
 * Returns true when the button was handled.
 */
async function handleRefreshButton(
  interaction: ButtonInteraction,
  guildId: string,
  customId: string,
): Promise<boolean> {
  if (customId === "panel:refresh") {
    await interaction.update({ components: [buildMainMenu()], flags: MessageFlags.IsComponentsV2 });
    return true;
  }
  if (customId === "panel:refresh:verify") {
    await interaction.update({ components: [buildVerifyPanel(guildId)], flags: MessageFlags.IsComponentsV2 });
    return true;
  }
  if (customId.startsWith("panel:refresh:protect")) {
    const parts = customId.split(":");
    const ch = parts[3] || null;
    await interaction.update({ components: [await buildProtectPanel(guildId, ch)], flags: MessageFlags.IsComponentsV2 });
    return true;
  }
  if (customId === "panel:refresh:status") {
    await interaction.update({ components: [buildStatusPanel(guildId)], flags: MessageFlags.IsComponentsV2 });
    return true;
  }
  return false;
}

/**
 * The category buttons — they open a section of the panel.
 *
 * Returns true when the button was handled.
 */
async function handleCategoryButton(
  interaction: ButtonInteraction,
  guildId: string,
  customId: string,
): Promise<boolean> {
  if (customId === "panel:verify") {
    await interaction.update({ components: [buildVerifyPanel(guildId)], flags: MessageFlags.IsComponentsV2 });
    return true;
  }
  if (customId === "panel:protect") {
    const channelId = interaction.channelId;
    await interaction.update({ components: [await buildProtectPanel(guildId, channelId)], flags: MessageFlags.IsComponentsV2 });
    return true;
  }
  if (customId === "panel:status") {
    await interaction.update({ components: [buildStatusPanel(guildId)], flags: MessageFlags.IsComponentsV2 });
    return true;
  }

  const info = COMING_SOON_PANELS[customId];
  if (info) {
    await interaction.update({ components: [buildComingSoonPanel(info.title, info.hint)], flags: MessageFlags.IsComponentsV2 });
    return true;
  }
  return false;
}

/** The sections that only point at the slash command that does the work. */
const COMING_SOON_PANELS: Record<string, { title: string; hint: string }> = {
  "panel:alerts": { title: "📡 Roblox Alerts", hint: "ใช้ `/robloxalert add` `/robloxalert remove` `/robloxalert list`" },
  "panel:executor": { title: "🤖 Executor Status", hint: "ใช้ `/executorStatus track add|remove|edit` `/executorStatus config`" },
  "panel:join": { title: "👋 Join Alert", hint: "ใช้ `/joinalert enable|disable|setchannel|setmessage`" },
  "panel:config": { title: "⚙️ General Config", hint: "ใช้ `/config`" },
  "panel:cleanup": { title: "🧹 Cleanup", hint: "ใช้ `/cleanup`" },
};

/**
 * The verification buttons: edit, re-post and disable.
 *
 * Returns true when the button was handled.
 */
async function handleVerifyButton(
  interaction: ButtonInteraction,
  guildId: string,
  customId: string,
): Promise<boolean> {
  if (customId === "panel:verify:edit") {
    const cfg = getVerificationConfig(guildId);
    const modal = buildVerifyEditModal(cfg);
    await interaction.showModal(modal);
    return true;
  }
  if (customId === "panel:verify:repost") {
    await repostVerifyPanel(interaction, guildId);
    return true;
  }
  if (customId === "panel:verify:disable") {
    await interaction.update({ components: [buildVerifyDisableConfirm()], flags: MessageFlags.IsComponentsV2 });
    return true;
  }
  if (customId === "panel:verify:disable:confirm") {
    await disableVerify(interaction, guildId);
    return true;
  }
  return false;
}

/** The "turn verification off" confirmation card. */
function buildVerifyDisableConfirm() {
  const container = new ContainerBuilder().setAccentColor(0xef4444);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("# ⛔ ยืนยันการปิด Verification"),
    new TextDisplayBuilder().setContent("ระบบ verification จะถูกปิด แต่ config จะยังอยู่ (เปิดใหม่ได้)"),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel:verify:disable:confirm").setLabel("✅ ยืนยันปิด").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("panel:verify").setLabel("❌ ยกเลิก").setStyle(ButtonStyle.Secondary),
    ),
  );
  return container;
}

/** Delete the old public panel message and post a fresh one. */
async function repostVerifyPanel(interaction: ButtonInteraction, guildId: string) {
  const cfg = getVerificationConfig(guildId);
  if (!cfg) {
    await interaction.reply({ content: "❌ ยังไม่ได้ตั้งค่า", flags: MessageFlags.Ephemeral });
    return;
  }
  const fetched = await interaction.client.channels.fetch(cfg.channelId).catch(() => null);
  const channel = panelChannel(fetched);
  if (!channel?.isSendable()) {
    await interaction.reply({ content: "❌ ไม่สามารถส่งข้อความได้", flags: MessageFlags.Ephemeral });
    return;
  }
  if (cfg.panelMessageId) {
    try {
      await channel.messages.delete(cfg.panelMessageId);
    } catch {
      /* ignore */
    }
  }
  const newContainer = buildVerifyPublicContainer({
    embedTitle: cfg.embedTitle,
    embedDescription: cfg.embedDescription,
    mode: cfg.verificationMode,
    imageUrl: cfg.imageUrl,
  });
  try {
    const sent = await channel.send({
      components: [newContainer],
      files: panelImageFilesForPost(cfg.imageUrl),
      flags: MessageFlags.IsComponentsV2,
    });
    updatePanelMessageId(guildId, sent.id);
    await interaction.reply({ content: "✅ Re-post สำเร็จ", flags: MessageFlags.Ephemeral });
  } catch (e) {
    logger.error("[PANEL] verify repost failed:", e);
    await interaction.reply({ content: "❌ Re-post ไม่สำเร็จ", flags: MessageFlags.Ephemeral });
  }
}

/** Turn verification off and remove the public panel message. */
async function disableVerify(interaction: ButtonInteraction, guildId: string) {
  const cfg = getVerificationConfig(guildId);
  if (cfg?.panelMessageId && cfg.channelId) {
    const fetched = await interaction.client.channels.fetch(cfg.channelId).catch(() => null);
    const channel = panelChannel(fetched);
    if (channel) {
      try {
        await channel.messages.delete(cfg.panelMessageId);
      } catch {
        /* ignore */
      }
    }
  }
  disableVerificationConfig(guildId);
  const { deleteInviteCodesForGuild } = await import("../verifyManager.js");
  deleteInviteCodesForGuild(guildId);
  await interaction.update({ components: [buildVerifyPanel(guildId)], flags: MessageFlags.IsComponentsV2 });
  await interaction.followUp({ content: "✅ Verification ถูกปิดแล้ว", flags: MessageFlags.Ephemeral });
}

/**
 * The protected-room buttons: edit banner, switch action, timeout, re-post
 * and disable.
 *
 * Returns true when the button was handled.
 */
async function handleProtectButton(
  interaction: ButtonInteraction,
  guildId: string,
  customId: string,
): Promise<boolean> {
  const action = protectButtonAction(customId);
  if (!action) return false;

  switch (action.kind) {
    case "edit":
      await showProtectBannerModal(interaction, action.channelId);
      return true;
    case "switch-action":
      await switchProtectAction(interaction, guildId, action.channelId);
      return true;
    case "timeout":
      await openTimeoutModal(interaction, guildId, action.channelId);
      return true;
    case "disable-confirm":
      await disableProtectRoom(interaction, guildId, action.channelId);
      return true;
    case "disable":
      await interaction.update({
        components: [buildProtectDisableConfirm(action.channelId)],
        flags: MessageFlags.IsComponentsV2,
      });
      return true;
    case "repost":
      await repostProtectNotice(interaction, guildId, action.channelId);
      return true;
  }
}

/** What a protected-room button asks the panel to do. */
export type ProtectButtonAction =
  | { kind: "edit"; channelId: string }
  | { kind: "switch-action"; channelId: string }
  | { kind: "timeout"; channelId: string }
  | { kind: "disable-confirm"; channelId: string }
  | { kind: "disable"; channelId: string }
  | { kind: "repost"; channelId: string };

/**
 * Which protected-room action a button customId asks for.
 *
 * The order matters: "panel:protect:disable:" is a prefix of
 * "panel:protect:disable:confirm:", so the confirm button has to be matched
 * first. The other way round the confirm button only re-shows the
 * confirmation card and the room is never actually turned off.
 */
export function protectButtonAction(customId: string): ProtectButtonAction | null {
  if (customId.startsWith("panel:protect:disable:confirm:")) {
    return { kind: "disable-confirm", channelId: customId.split(":")[4] ?? "" };
  }
  if (customId.startsWith("panel:protect:disable:")) {
    return { kind: "disable", channelId: customId.split(":")[3] ?? "" };
  }
  if (customId.startsWith("panel:protect:edit:")) {
    return { kind: "edit", channelId: customId.split(":")[3] ?? "" };
  }
  if (customId.startsWith("panel:protect:action:")) {
    return { kind: "switch-action", channelId: customId.split(":")[3] ?? "" };
  }
  if (customId.startsWith("panel:protect:timeout:")) {
    return { kind: "timeout", channelId: customId.split(":")[3] ?? "" };
  }
  if (customId.startsWith("panel:protect:repost:")) {
    return { kind: "repost", channelId: customId.split(":")[3] ?? "" };
  }
  return null;
}

/** Open the modal that edits the protected-room banner. */
async function showProtectBannerModal(interaction: ButtonInteraction, channelId: string) {
  const modal = new ModalBuilder()
    .setCustomId(`panel:protect:edit:modal:${channelId}`)
    .setTitle("Edit Protected Room Banner");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("banner")
        .setLabel("Banner URL (หรือ 'clear')")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(500)
        .setValue(""),
    ),
  );
  await interaction.showModal(modal);
}

/** The "turn the protected room off" confirmation card. */
function buildProtectDisableConfirm(channelId: string) {
  const container = new ContainerBuilder().setAccentColor(0xef4444);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("# ⛔ ยืนยันการปิด Protected Room"),
    new TextDisplayBuilder().setContent(`Channel <#${channelId}> จะถูกยกเลิกการป้องกัน`),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`panel:protect:disable:confirm:${channelId}`).setLabel("✅ ยืนยันปิด").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`panel:refresh:protect:${channelId}`).setLabel("❌ ยกเลิก").setStyle(ButtonStyle.Secondary),
    ),
  );
  return container;
}

/** Flip a protected room between ban and timeout, and repaint the notice. */
async function switchProtectAction(
  interaction: ButtonInteraction,
  guildId: string,
  channelId: string,
) {
  const room = getProtectedRoom(guildId, channelId) as ProtectedRoomRow | null;
  if (!room) {
    await interaction.reply({ content: "❌ ไม่พบ protected room", flags: MessageFlags.Ephemeral });
    return;
  }
  const newAction: ProtectAction = room.actionType === "ban" ? "timeout" : "ban";
  db.prepare(`UPDATE protectedRooms SET actionType = ? WHERE guildId = ? AND channelId = ?`).run(
    newAction,
    guildId,
    channelId,
  );
  invalidateProtectedRoom(guildId, channelId);

  // Re-post notice with new action
  const fetched = await interaction.client.channels.fetch(channelId).catch(() => null);
  const channel = panelChannel(fetched);
  if (channel?.isSendable()) {
    if (room.noticeMessageId) {
      try {
        await channel.messages.delete(room.noticeMessageId);
      } catch {
        /* ignore */
      }
    }
    try {
      const fresh = db
        .prepare(`SELECT actionCount, imageUrl FROM protectedRooms WHERE guildId = ? AND channelId = ?`)
        .get(guildId, channelId) as { actionCount: number; imageUrl: string | null } | undefined;
      const imageUrl = fresh?.imageUrl ?? room.imageUrl;
      const msg = await channel.send({
        components: buildProtectRoomNoticeComponents(newAction, fresh?.actionCount ?? 0, imageUrl),
        files: panelImageFilesForPost(imageUrl),
        flags: MessageFlags.IsComponentsV2,
      });
      db.prepare(`UPDATE protectedRooms SET noticeMessageId = ? WHERE guildId = ? AND channelId = ?`).run(
        msg.id,
        guildId,
        channelId,
      );
      invalidateProtectedRoom(guildId, channelId);
    } catch (e) {
      logger.warn(`[PANEL] re-post after action switch failed: ${e}`);
    }
  }

  await interaction.update({
    components: [await buildProtectPanel(guildId, channelId)],
    flags: MessageFlags.IsComponentsV2,
  });
}

/** Open the modal that asks for the timeout duration in minutes. */
async function openTimeoutModal(
  interaction: ButtonInteraction,
  guildId: string,
  channelId: string,
) {
  const room = getProtectedRoom(guildId, channelId) as ProtectedRoomRow | null;
  const currentMin = room?.timeoutDuration ? Math.round(room.timeoutDuration / 60000) : 10;
  const modal = new ModalBuilder()
    .setCustomId(`panel:protect:timeout:modal:${channelId}`)
    .setTitle("Set Timeout Duration");
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("minutes")
        .setLabel("Timeout (นาที)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(6)
        .setValue(String(currentMin)),
    ),
  );
  await interaction.showModal(modal);
}

/** Turn the protected room off and delete its notice message. */
async function disableProtectRoom(
  interaction: ButtonInteraction,
  guildId: string,
  channelId: string,
) {
  const existing = db
    .prepare(`SELECT noticeMessageId, imageUrl FROM protectedRooms WHERE guildId = ? AND channelId = ?`)
    .get(guildId, channelId) as { noticeMessageId: string | null; imageUrl: string | null } | undefined;
  if (existing?.noticeMessageId) {
    const fetched = await interaction.client.channels.fetch(channelId).catch(() => null);
    const channel = panelChannel(fetched);
    if (channel) {
      try {
        await channel.messages.delete(existing.noticeMessageId);
      } catch {
        /* ignore */
      }
    }
  }
  db.prepare(`DELETE FROM protectedRooms WHERE guildId = ? AND channelId = ?`).run(guildId, channelId);
  invalidateProtectedRoom(guildId, channelId);
  if (existing?.imageUrl) deleteLocalPanelImage(existing.imageUrl);
  await interaction.update({
    components: [await buildProtectPanel(guildId)],
    flags: MessageFlags.IsComponentsV2,
  });
  await interaction.followUp({ content: "✅ Protected room ถูกปิดแล้ว", flags: MessageFlags.Ephemeral });
}

/** Delete the protected-room notice and post a fresh one. */
async function repostProtectNotice(
  interaction: ButtonInteraction,
  guildId: string,
  channelId: string,
) {
  const room = getProtectedRoom(guildId, channelId) as ProtectedRoomRow | null;
  if (!room) {
    await interaction.reply({ content: "❌ ไม่พบ protected room", flags: MessageFlags.Ephemeral });
    return;
  }
  const fetched = await interaction.client.channels.fetch(channelId).catch(() => null);
  const channel = panelChannel(fetched);
  if (!channel?.isSendable()) {
    await interaction.reply({ content: "❌ ไม่สามารถส่งข้อความได้", flags: MessageFlags.Ephemeral });
    return;
  }

  // delete old notice
  if (room.noticeMessageId) {
    try {
      await channel.messages.delete(room.noticeMessageId);
    } catch {
      /* ignore */
    }
  }
  const newId = await sendProtectNotice(channel, room.actionType, room.actionCount ?? 0, room.imageUrl);
  if (newId) {
    db.prepare(`UPDATE protectedRooms SET noticeMessageId = ? WHERE guildId = ? AND channelId = ?`).run(
      newId,
      guildId,
      channelId,
    );
    invalidateProtectedRoom(guildId, channelId);
  }
  await interaction.reply({
    content: newId ? "✅ Re-post สำเร็จ" : "❌ Re-post ไม่สำเร็จ",
    flags: MessageFlags.Ephemeral,
  });
}

/** Post a protected-room notice. Returns the message id, or null on failure. */
async function sendProtectNotice(
  channel: PanelMessageChannel,
  actionType: ProtectAction,
  actionCount: number,
  imageUrl: string | null,
): Promise<string | null> {
  if (!channel.isSendable()) return null;
  try {
    const msg = await channel.send({
      components: buildProtectRoomNoticeComponents(actionType, actionCount, imageUrl),
      files: panelImageFilesForPost(imageUrl),
      flags: MessageFlags.IsComponentsV2,
    });
    return msg.id;
  } catch {
    return null;
  }
}
