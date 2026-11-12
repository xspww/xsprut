import {
  MessageFlags,
  type ContainerBuilder,
  type ModalSubmitInteraction,
} from "discord.js";
import db from "../db";
import logger from "../logger";
import { getProtectedRoom, invalidateProtectedRoom } from "../dbCache";
import {
  getVerificationConfig,
  updatePanelMessageId,
  type VerificationConfig,
} from "../verifyManager";
import { deleteLocalPanelImage, panelImageFilesForPost } from "../panelImage";
import { buildProtectRoomNoticeComponents, type ProtectAction } from "../protectRoom";
import { buildProtectPanel, buildVerifyPublicContainer, buildVerifyPanel } from "./builders";
import { deny, isAdmin, panelChannel, type ProtectedRoomRow } from "./shared";

/** The panel's modals: the verification editor and the protected-room forms. */

export async function handlePanelModal(interaction: ModalSubmitInteraction) {
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

  if (customId === "panel:verify:edit:modal") {
    await saveVerifyEditModal(interaction, guildId);
    return;
  }
  if (customId.startsWith("panel:protect:edit:modal:")) {
    await saveProtectBannerModal(interaction, guildId, customId.split(":")[4]);
    return;
  }
  if (customId.startsWith("panel:protect:timeout:modal:")) {
    await saveProtectTimeoutModal(interaction, guildId, customId.split(":")[4]);
    return;
  }

  await interaction.reply({ content: "❌ Modal ไม่รู้จัก", flags: MessageFlags.Ephemeral });
}

/** The verification editor — title, description, success message and banner. */
async function saveVerifyEditModal(interaction: ModalSubmitInteraction, guildId: string) {
  const cfg = getVerificationConfig(guildId);
  if (!cfg) {
    await interaction.reply({ content: "❌ ยังไม่ได้ตั้งค่า", flags: MessageFlags.Ephemeral });
    return;
  }

  const title = interaction.fields.getTextInputValue("title").trim();
  const description = interaction.fields.getTextInputValue("description").trim();
  const success = interaction.fields.getTextInputValue("success").trim();
  const bannerRaw = interaction.fields.getTextInputValue("banner").trim();
  const unverifiedRaw = interaction.fields.getTextInputValue("unverified").trim();

  if (!title) {
    await interaction.reply({ content: "❌ Title ห้ามว่าง", flags: MessageFlags.Ephemeral });
    return;
  }

  // Resolve banner
  const nextImage = await resolveBannerValue(interaction, bannerRaw, cfg.imageUrl);
  if (nextImage === undefined) return;

  // Resolve unverified role
  const nextUnverified = await resolveUnverifiedRoleValue(
    interaction,
    unverifiedRaw,
    cfg.unverifiedRoleId,
  );
  if (nextUnverified === undefined) return;

  // Save config (reuse saveVerificationConfig)
  const { saveVerificationConfig } = await import("../verifyManager.js");
  saveVerificationConfig({
    guildId,
    channelId: cfg.channelId,
    verifiedRoleId: cfg.verifiedRoleId,
    unverifiedRoleId: nextUnverified,
    embedTitle: title,
    embedDescription: description || cfg.embedDescription,
    successMessage: success || cfg.successMessage,
    imageUrl: nextImage,
    verificationMode: cfg.verificationMode,
    createdAt: cfg.createdAt,
  });

  // Rebuild + update the public panel message
  await refreshPublicVerifyMessage(interaction, guildId, cfg, {
    title,
    description: description || cfg.embedDescription,
    imageUrl: nextImage,
  });

  if (cfg.imageUrl && cfg.imageUrl !== nextImage) {
    deleteLocalPanelImage(cfg.imageUrl);
  }

  await editPanelMessage(interaction, [buildVerifyPanel(guildId)]);
  await interaction.reply({ content: "✅ Verification config อัปเดตแล้ว", flags: MessageFlags.Ephemeral });
}

/**
 * Resolve the banner field to a URL or null.
 *
 * Returns undefined when the value was rejected — the reply has been sent.
 */
async function resolveBannerValue(
  interaction: ModalSubmitInteraction,
  bannerRaw: string,
  current: string | null,
): Promise<string | null | undefined> {
  if (bannerRaw.toLowerCase() === "clear") return null;
  if (!bannerRaw) return current;
  if (!/^https?:\/\//i.test(bannerRaw)) {
    await interaction.reply({
      content: "❌ Banner ต้องเป็น URL (https://...) หรือ 'clear'",
      flags: MessageFlags.Ephemeral,
    });
    return undefined;
  }
  return bannerRaw;
}

/**
 * Resolve the unverified-role field to a role id or null.
 *
 * Returns undefined when the value was rejected — the reply has been sent.
 */
async function resolveUnverifiedRoleValue(
  interaction: ModalSubmitInteraction,
  unverifiedRaw: string,
  current: string | null,
): Promise<string | null | undefined> {
  if (unverifiedRaw.toLowerCase() === "clear") return null;
  if (!unverifiedRaw) return current;
  if (!/^\d{15,20}$/.test(unverifiedRaw)) {
    await interaction.reply({
      content: "❌ Unverified role ต้องเป็น role ID (ตัวเลข) หรือ 'clear'",
      flags: MessageFlags.Ephemeral,
    });
    return undefined;
  }
  return unverifiedRaw;
}

/**
 * Repaint the public verification message.
 *
 * A changed banner cannot be added to an existing message, so the message is
 * re-posted instead of edited.
 */
async function refreshPublicVerifyMessage(
  interaction: ModalSubmitInteraction,
  guildId: string,
  cfg: VerificationConfig,
  next: { title: string; description: string; imageUrl: string | null },
) {
  const fetched = await interaction.client.channels.fetch(cfg.channelId).catch(() => null);
  const channel = panelChannel(fetched);
  if (!channel?.isSendable()) return;

  const bannerChanged = next.imageUrl !== cfg.imageUrl;
  const newContainer = buildVerifyPublicContainer({
    embedTitle: next.title,
    embedDescription: next.description,
    mode: cfg.verificationMode,
    imageUrl: next.imageUrl,
  });

  if (!cfg.panelMessageId) {
    const sent = await channel.send({
      components: [newContainer],
      files: panelImageFilesForPost(next.imageUrl),
      flags: MessageFlags.IsComponentsV2,
    });
    updatePanelMessageId(guildId, sent.id);
    return;
  }

  try {
    const msg = await channel.messages.fetch(cfg.panelMessageId);
    if (bannerChanged) {
      // banner changed → must delete + re-post (can't add/remove files on edit)
      try {
        await msg.delete();
      } catch {
        /* ignore */
      }
      const sent = await channel.send({
        components: [newContainer],
        files: panelImageFilesForPost(next.imageUrl),
        flags: MessageFlags.IsComponentsV2,
      });
      updatePanelMessageId(guildId, sent.id);
    } else {
      await msg.edit({ components: [newContainer], flags: MessageFlags.IsComponentsV2 });
    }
  } catch {
    // message gone → send new
    const sent = await channel.send({
      components: [newContainer],
      files: panelImageFilesForPost(next.imageUrl),
      flags: MessageFlags.IsComponentsV2,
    });
    updatePanelMessageId(guildId, sent.id);
  }
}

/** The protected-room banner editor. */
async function saveProtectBannerModal(
  interaction: ModalSubmitInteraction,
  guildId: string,
  channelId: string,
) {
  const bannerRaw = interaction.fields.getTextInputValue("banner").trim();
  const room = getProtectedRoom(guildId, channelId) as ProtectedRoomRow | null;
  if (!room) {
    await interaction.reply({ content: "❌ ไม่พบ protected room", flags: MessageFlags.Ephemeral });
    return;
  }

  const nextImage = await resolveBannerValue(interaction, bannerRaw, room.imageUrl);
  if (nextImage === undefined) return;

  db.prepare(`UPDATE protectedRooms SET imageUrl = ? WHERE guildId = ? AND channelId = ?`).run(
    nextImage,
    guildId,
    channelId,
  );
  invalidateProtectedRoom(guildId, channelId);

  if (room.imageUrl && room.imageUrl !== nextImage) {
    deleteLocalPanelImage(room.imageUrl);
  }

  // Re-post notice
  await repostProtectNotice(interaction, guildId, channelId, room, nextImage);

  await editPanelMessage(interaction, [await buildProtectPanel(guildId, channelId)]);
  await interaction.reply({ content: "✅ Banner อัปเดตแล้ว", flags: MessageFlags.Ephemeral });
}

/** The protected-room timeout editor. */
async function saveProtectTimeoutModal(
  interaction: ModalSubmitInteraction,
  guildId: string,
  channelId: string,
) {
  const raw = interaction.fields.getTextInputValue("minutes").trim();
  const minutes = parseInt(raw, 10);
  if (isNaN(minutes) || minutes < 1 || minutes > 10080) {
    await interaction.reply({ content: "❌ ใส่จำนวนนาที 1-10080", flags: MessageFlags.Ephemeral });
    return;
  }
  const ms = minutes * 60 * 1000;
  db.prepare(`UPDATE protectedRooms SET timeoutDuration = ? WHERE guildId = ? AND channelId = ?`).run(
    ms,
    guildId,
    channelId,
  );
  invalidateProtectedRoom(guildId, channelId);

  await editPanelMessage(interaction, [await buildProtectPanel(guildId, channelId)]);
  await interaction.reply({
    content: `✅ Timeout set to ${minutes} นาที`,
    flags: MessageFlags.Ephemeral,
  });
}

/** Delete the old notice of a protected room and post a fresh one. */
async function repostProtectNotice(
  interaction: ModalSubmitInteraction,
  guildId: string,
  channelId: string,
  room: ProtectedRoomRow,
  imageUrl: string | null,
) {
  const fetched = await interaction.client.channels.fetch(channelId).catch(() => null);
  const channel = panelChannel(fetched);
  if (!channel?.isSendable()) return;

  if (room.noticeMessageId) {
    try {
      await channel.messages.delete(room.noticeMessageId);
    } catch {
      /* ignore */
    }
  }
  try {
    const msg = await channel.send({
      components: buildProtectRoomNoticeComponents(
        room.actionType as ProtectAction,
        room.actionCount ?? 0,
        imageUrl,
      ),
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
    logger.warn(`[PANEL] re-post protect notice failed: ${e}`);
  }
}

/** Repaint the panel message behind the modal. Best-effort. */
async function editPanelMessage(
  interaction: ModalSubmitInteraction,
  components: ContainerBuilder[],
): Promise<void> {
  try {
    if (interaction.message) {
      await interaction.message.edit({ components, flags: MessageFlags.IsComponentsV2 });
    }
  } catch {
    /* ignore */
  }
}
