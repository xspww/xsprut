import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type ButtonInteraction,
  type TextBasedChannel,
} from "discord.js";
import db from "./db";
import logger from "./logger";
import { getVerificationConfig, updatePanelMessageId, disableVerificationConfig, type VerificationMode } from "./verifyManager";
import { getProtectedRoom } from "./dbCache";
import { invalidateProtectedRoom } from "./dbCache";
import {
  buildProtectRoomNoticeComponents,
  PROTECT_ACTION_META,
  type ProtectAction,
} from "./protectRoom";
import {
  deleteLocalPanelImage,
  isLocalPanelImageMissing,
  panelImageDisplayUrl,
  panelImageFilesForPost,
  persistPanelImageFromUrl,
  resolvePanelImageInput,
} from "./panelImage";
import { invalidateAlerts } from "./dbCache";
import { getAlerts } from "./dbCache";

// ─── Permission helper ──────────────────────────────────────────────────────
export function isAdmin(interaction: { memberPermissions?: { has: (p: bigint) => boolean } | null }): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

export function deny(interaction: { reply: (opts: any) => Promise<any> }): Promise<any> {
  return interaction.reply({ content: "❌ ต้องเป็น Administrator ถึงใช้ได้", flags: MessageFlags.Ephemeral });
}

// ─── Main menu ──────────────────────────────────────────────────────────────
export function buildMainMenu() {
  const container = new ContainerBuilder().setAccentColor(0x5865f2);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("# 🎛️ Server Panel"),
    new TextDisplayBuilder().setContent("เลือกหมวดที่ต้องการตั้งค่า"),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel:verify").setLabel("🔐 Verification").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel:protect").setLabel("🔒 Protected Room").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel:alerts").setLabel("📡 Roblox Alerts").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel:executor").setLabel("🤖 Executor Status").setStyle(ButtonStyle.Secondary),
    ),
  );
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel:join").setLabel("👋 Join Alert").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel:config").setLabel("⚙️ General Config").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel:status").setLabel("📊 Status").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel:cleanup").setLabel("🧹 Cleanup").setStyle(ButtonStyle.Secondary),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("-# Powered by WEAO"),
  );
  return container;
}

// ─── Public verify panel container (shared with /verify setup) ───────────────
export function buildVerifyPublicContainer(opts: {
  embedTitle: string;
  embedDescription: string;
  mode: VerificationMode;
  imageUrl?: string | null;
}) {
  const container = new ContainerBuilder().setAccentColor(0x22c55e);
  const bannerUrl = panelImageDisplayUrl(opts.imageUrl);
  if (bannerUrl) {
    container
      .addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL(bannerUrl).setDescription("Verification banner"),
        ),
      )
      .addSeparatorComponents(new SeparatorBuilder());
  }
  container
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${opts.embedTitle}`),
      new TextDisplayBuilder().setContent(opts.embedDescription),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("verify_start")
          .setLabel(opts.mode === "code" ? "Enter code" : "Verify")
          .setStyle(ButtonStyle.Success)
          .setEmoji(opts.mode === "code" ? "🔑" : "✅"),
      ),
    );
  return container;
}

// ─── Verification panel ─────────────────────────────────────────────────────
export function buildVerifyPanel(guildId: string) {
  const cfg = getVerificationConfig(guildId);
  const container = new ContainerBuilder().setAccentColor(0x22c55e);

  if (!cfg) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# 🔐 Verification"),
      new TextDisplayBuilder().setContent("❌ ยังไม่ได้ตั้งค่า — ใช้ `/verify setup` หรือกดปุ่มด้านล่าง"),
    );
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("panel:back").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
      ),
    );
    return container;
  }

  const modeLine = cfg.verificationMode === "code" ? "🔑 Code (invite + code)" : "🔐 Captcha (image code)";
  const roleList = cfg.unverifiedRoleId
    ? `Verified: <@&${cfg.verifiedRoleId}>\nUnverified: <@&${cfg.unverifiedRoleId}>`
    : `Verified: <@&${cfg.verifiedRoleId}>`;
  const bannerLine = cfg.imageUrl ? "🖼️ มี banner" : "🖼️ ไม่มี banner";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("# 🔐 Verification"),
    new TextDisplayBuilder().setContent(
      `สถานะ: ✅ เปิดอยู่\nMode: ${modeLine}\n${roleList}\nChannel: <#${cfg.channelId}>\n${bannerLine}\nTitle: ${cfg.embedTitle}`,
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel:verify:edit").setLabel("✏️ Edit").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("panel:verify:repost").setLabel("🔄 Re-post").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel:verify:disable").setLabel("⛔ Disable").setStyle(ButtonStyle.Danger),
    ),
  );
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel:back").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel:refresh").setLabel("🔄 Refresh").setStyle(ButtonStyle.Secondary),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("-# Powered by WEAO"),
  );
  return container;
}

// ─── Protected Room panel ────────────────────────────────────────────────────
export function buildProtectPanel(guildId: string, channelId?: string | null) {
  const container = new ContainerBuilder().setAccentColor(0xef4444);

  // If no channelId provided, show hint
  if (!channelId) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# 🔒 Protected Room"),
      new TextDisplayBuilder().setContent("⚠️ ต้องรันใน channel ที่เป็น protected room หรือระบุ channel ผ่าน slash command `/protectroom`"),
    );
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("panel:back").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
      ),
    );
    return container;
  }

  const room = getProtectedRoom(guildId, channelId) as any;
  if (!room) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("# 🔒 Protected Room"),
      new TextDisplayBuilder().setContent(`Channel <#${channelId}> ไม่ได้ตั้งเป็น protected room\nใช้ \`/protectroom setup\` ก่อน`),
    );
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("panel:back").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
      ),
    );
    return container;
  }

  const meta = PROTECT_ACTION_META[room.actionType as ProtectAction];
  const bannerLine = room.imageUrl ? "🖼️ มี banner" : "🖼️ ไม่มี banner";
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("# 🔒 Protected Room"),
    new TextDisplayBuilder().setContent(
      `Channel: <#${channelId}>\nAction: ${meta.displayName}\nTimeout: ${room.timeoutDuration ? room.timeoutDuration / 60000 + " นาที" : "-"}\nPunished: ${room.actionCount ?? 0}\n${bannerLine}`,
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  const otherAction: ProtectAction = room.actionType === "ban" ? "timeout" : "ban";
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`panel:protect:edit:${channelId}`).setLabel("✏️ Edit Banner").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`panel:protect:action:${channelId}`).setLabel(`Switch to ${PROTECT_ACTION_META[otherAction].displayName}`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`panel:protect:timeout:${channelId}`).setLabel("⏱️ Timeout").setStyle(ButtonStyle.Secondary),
    ),
  );
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`panel:protect:repost:${channelId}`).setLabel("🔄 Re-post").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel:back").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel:refresh").setLabel("🔄 Refresh").setStyle(ButtonStyle.Secondary),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("-# Powered by WEAO"),
  );
  return container;
}

// ─── Status panel (overview) ─────────────────────────────────────────────────
export function buildStatusPanel(guildId: string) {
  const container = new ContainerBuilder().setAccentColor(0x3b82f6);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("# 📊 Server Status"),
  );

  const vcfg = getVerificationConfig(guildId);
  const vLine = vcfg
    ? `🔐 Verification: ✅ เปิด (${vcfg.verificationMode})`
    : "🔐 Verification: ❌ ปิด";

  const protectedCount = (db.prepare(`SELECT COUNT(*) AS c FROM protectedRooms WHERE guildId = ?`).get(guildId) as any)?.c ?? 0;
  const alertCount = (db.prepare(`SELECT COUNT(*) AS c FROM alerts WHERE guildId = ?`).get(guildId) as any)?.c ?? 0;
  const executorCount = (db.prepare(`SELECT COUNT(*) AS c FROM executorStatusChannels WHERE guildId = ? AND enabled = 1`).get(guildId) as any)?.c ?? 0;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${vLine}\n🔒 Protected Rooms: ${protectedCount}\n📡 Roblox Alerts: ${alertCount}\n🤖 Executor Status: ${executorCount} channels`,
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel:back").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel:refresh").setLabel("🔄 Refresh").setStyle(ButtonStyle.Secondary),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("-# Powered by WEAO"),
  );
  return container;
}

// ─── Coming soon stub ────────────────────────────────────────────────────────
export function buildComingSoonPanel(title: string) {
  const container = new ContainerBuilder().setAccentColor(0x6b7280);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${title}`),
    new TextDisplayBuilder().setContent("🚧 กำลังพัฒนา — ใช้ slash command ไปก่อนนะครับ"),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel:back").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("-# Powered by WEAO"),
  );
  return container;
}

// ─── Edit modal: Verification ────────────────────────────────────────────────
export function buildVerifyEditModal(cfg: ReturnType<typeof getVerificationConfig>) {
  const modal = new ModalBuilder()
    .setCustomId("panel:verify:edit:modal")
    .setTitle("Edit Verification Panel");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("title")
        .setLabel("Panel title")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
        .setValue(cfg?.embedTitle ?? "Verify yourself"),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("description")
        .setLabel("Panel description")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(500)
        .setValue(cfg?.embedDescription ?? ""),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("success")
        .setLabel("Success message ({server})")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(200)
        .setValue(cfg?.successMessage ?? "You're verified. Welcome to {server}!"),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("banner")
        .setLabel("Banner URL (หรือ 'clear')")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(500)
        .setValue(cfg?.imageUrl ?? ""),
    ),
  );
  return modal;
}

// ─── Button handler ──────────────────────────────────────────────────────────
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

  // Main menu
  if (customId === "panel:main" || customId === "panel:back") {
    await interaction.update({ components: [buildMainMenu()], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  // Refresh
  if (customId === "panel:refresh") {
    // Re-render based on... we don't track current view. Default to main.
    await interaction.update({ components: [buildMainMenu()], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  // Category navigation
  if (customId === "panel:verify") {
    await interaction.update({ components: [buildVerifyPanel(guildId)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  if (customId === "panel:protect") {
    const channelId = interaction.channelId;
    await interaction.update({ components: [buildProtectPanel(guildId, channelId)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  if (customId === "panel:status") {
    await interaction.update({ components: [buildStatusPanel(guildId)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  if (customId === "panel:alerts" || customId === "panel:executor" || customId === "panel:join" || customId === "panel:config" || customId === "panel:cleanup") {
    const titleMap: Record<string, string> = {
      "panel:alerts": "📡 Roblox Alerts",
      "panel:executor": "🤖 Executor Status",
      "panel:join": "👋 Join Alert",
      "panel:config": "⚙️ General Config",
      "panel:cleanup": "🧹 Cleanup",
    };
    await interaction.update({ components: [buildComingSoonPanel(titleMap[customId])], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  // Verify actions
  if (customId === "panel:verify:edit") {
    const cfg = getVerificationConfig(guildId);
    const modal = buildVerifyEditModal(cfg);
    await interaction.showModal(modal);
    return;
  }
  if (customId === "panel:verify:repost") {
    const cfg = getVerificationConfig(guildId);
    if (!cfg) {
      await interaction.reply({ content: "❌ ยังไม่ได้ตั้งค่า", flags: MessageFlags.Ephemeral });
      return;
    }
    const channel = await interaction.client.channels.fetch(cfg.channelId).catch(() => null);
    if (!channel?.isTextBased() || !channel.isSendable()) {
      await interaction.reply({ content: "❌ ไม่สามารถส่งข้อความได้", flags: MessageFlags.Ephemeral });
      return;
    }
    if (cfg.panelMessageId) {
      try { await (channel as any).messages.delete(cfg.panelMessageId); } catch { /* ignore */ }
    }
    const newContainer = buildVerifyPublicContainer({
      embedTitle: cfg.embedTitle,
      embedDescription: cfg.embedDescription,
      mode: cfg.verificationMode,
      imageUrl: cfg.imageUrl,
    });
    try {
      const sent = await (channel as any).send({
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
    return;
  }
  if (customId === "panel:verify:disable") {
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
    await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  if (customId === "panel:verify:disable:confirm") {
    disableVerificationConfig(guildId);
    // delete invite codes
    const { deleteInviteCodesForGuild } = await import("./verifyManager.js");
    deleteInviteCodesForGuild(guildId);
    await interaction.update({ components: [buildVerifyPanel(guildId)], flags: MessageFlags.IsComponentsV2 });
    await interaction.followUp({ content: "✅ Verification ถูกปิดแล้ว", flags: MessageFlags.Ephemeral });
    return;
  }

  // Protect actions
  if (customId.startsWith("panel:protect:edit:")) {
    const channelId = customId.split(":")[3];
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
    return;
  }
  if (customId.startsWith("panel:protect:action:")) {
    const channelId = customId.split(":")[3];
    const room = getProtectedRoom(guildId, channelId) as any;
    if (!room) {
      await interaction.reply({ content: "❌ ไม่พบ protected room", flags: MessageFlags.Ephemeral });
      return;
    }
    const newAction: ProtectAction = room.actionType === "ban" ? "timeout" : "ban";
    db.prepare(`UPDATE protectedRooms SET actionType = ? WHERE guildId = ? AND channelId = ?`).run(newAction, guildId, channelId);
    invalidateProtectedRoom(guildId, channelId);
    // Re-post notice with new action
    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased() && channel.isSendable()) {
      if (room.noticeMessageId) {
        try { await (channel as any).messages.delete(room.noticeMessageId); } catch { /* ignore */ }
      }
      try {
        const fresh = db.prepare(`SELECT actionCount, imageUrl FROM protectedRooms WHERE guildId = ? AND channelId = ?`).get(guildId, channelId) as any;
        const msg = await (channel as any).send({
          components: buildProtectRoomNoticeComponents(newAction, fresh?.actionCount ?? 0, fresh?.imageUrl ?? room.imageUrl),
          files: panelImageFilesForPost(fresh?.imageUrl ?? room.imageUrl),
          flags: MessageFlags.IsComponentsV2,
        });
        db.prepare(`UPDATE protectedRooms SET noticeMessageId = ? WHERE guildId = ? AND channelId = ?`).run(msg.id, guildId, channelId);
        invalidateProtectedRoom(guildId, channelId);
      } catch (e) {
        logger.warn(`[PANEL] re-post after action switch failed: ${e}`);
      }
    }
    await interaction.update({ components: [buildProtectPanel(guildId, channelId)], flags: MessageFlags.IsComponentsV2 } as any);
    return;
  }
  if (customId.startsWith("panel:protect:timeout:")) {
    const channelId = customId.split(":")[3];
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
          .setValue("10"),
      ),
    );
    await interaction.showModal(modal);
    return;
  }
  if (customId.startsWith("panel:protect:repost:")) {
    const channelId = customId.split(":")[3];
    const room = getProtectedRoom(guildId, channelId) as any;
    if (!room) {
      await interaction.reply({ content: "❌ ไม่พบ protected room", flags: MessageFlags.Ephemeral });
      return;
    }
    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !channel.isSendable()) {
      await interaction.reply({ content: "❌ ไม่สามารถส่งข้อความได้", flags: MessageFlags.Ephemeral });
      return;
    }
    // delete old notice
    if (room.noticeMessageId) {
      try { await (channel as any).messages.delete(room.noticeMessageId); } catch { /* ignore */ }
    }
    const newId = await (async () => {
      try {
        const msg = await (channel as any).send({
          components: buildProtectRoomNoticeComponents(room.actionType as ProtectAction, room.actionCount ?? 0, room.imageUrl),
          files: panelImageFilesForPost(room.imageUrl),
          flags: MessageFlags.IsComponentsV2,
        });
        return msg.id;
      } catch {
        return null;
      }
    })();
    if (newId) {
      db.prepare(`UPDATE protectedRooms SET noticeMessageId = ? WHERE guildId = ? AND channelId = ?`).run(newId, guildId, channelId);
      invalidateProtectedRoom(guildId, channelId);
    }
    await interaction.reply({ content: newId ? "✅ Re-post สำเร็จ" : "❌ Re-post ไม่สำเร็จ", flags: MessageFlags.Ephemeral });
    return;
  }

  // Unknown
  await interaction.reply({ content: "❌ ปุ่มไม่รู้จัก", flags: MessageFlags.Ephemeral });
}

// ─── Modal handler ───────────────────────────────────────────────────────────
export async function handlePanelModal(interaction: ModalSubmitInteraction) {
  if (!isAdmin(interaction)) {
    await deny(interaction as any);
    return;
  }
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "❌ ใช้ได้เฉพาะใน server", flags: MessageFlags.Ephemeral });
    return;
  }

  const customId = interaction.customId;

  if (customId === "panel:verify:edit:modal") {
    const cfg = getVerificationConfig(guildId);
    if (!cfg) {
      await interaction.reply({ content: "❌ ยังไม่ได้ตั้งค่า", flags: MessageFlags.Ephemeral });
      return;
    }
    const title = interaction.fields.getTextInputValue("title").trim();
    const description = interaction.fields.getTextInputValue("description").trim();
    const success = interaction.fields.getTextInputValue("success").trim();
    const bannerRaw = interaction.fields.getTextInputValue("banner").trim();

    if (!title) {
      await interaction.reply({ content: "❌ Title ห้ามว่าง", flags: MessageFlags.Ephemeral });
      return;
    }

    // Resolve banner
    let nextImage: string | null = cfg.imageUrl;
    const wantsClear = bannerRaw.toLowerCase() === "clear";
    if (wantsClear) {
      nextImage = null;
    } else if (bannerRaw) {
      // treat as URL
      if (!/^https?:\/\//i.test(bannerRaw)) {
        await interaction.reply({ content: "❌ Banner ต้องเป็น URL (https://...) หรือ 'clear'", flags: MessageFlags.Ephemeral });
        return;
      }
      nextImage = bannerRaw;
    }

    // Save config (reuse saveVerificationConfig)
    const { saveVerificationConfig, deleteInviteCodesForGuild } = await import("./verifyManager.js");
    // Need role info - keep existing
    saveVerificationConfig({
      guildId,
      channelId: cfg.channelId,
      verifiedRoleId: cfg.verifiedRoleId,
      unverifiedRoleId: cfg.unverifiedRoleId,
      embedTitle: title,
      embedDescription: description || cfg.embedDescription,
      successMessage: success || cfg.successMessage,
      imageUrl: nextImage,
      verificationMode: cfg.verificationMode,
      createdAt: cfg.createdAt,
    });

    // Invalidate invite codes if mode handling needed (none here, mode unchanged)

    // Rebuild + update the public panel message
    const channel = await interaction.client.channels.fetch(cfg.channelId).catch(() => null);
    if (channel?.isTextBased() && channel.isSendable()) {
      const bannerChanged = nextImage !== cfg.imageUrl;
      const newContainer = buildVerifyPublicContainer({
        embedTitle: title,
        embedDescription: description || cfg.embedDescription,
        mode: cfg.verificationMode,
        imageUrl: nextImage,
      });
      if (cfg.panelMessageId) {
        try {
          const msg = await (channel as any).messages.fetch(cfg.panelMessageId);
          if (bannerChanged) {
            // banner changed → must delete + re-post (can't add/remove files on edit)
            try { await msg.delete(); } catch { /* ignore */ }
            const sent = await (channel as any).send({
              components: [newContainer],
              files: panelImageFilesForPost(nextImage),
              flags: MessageFlags.IsComponentsV2,
            });
            updatePanelMessageId(guildId, sent.id);
          } else {
            await msg.edit({ components: [newContainer], flags: MessageFlags.IsComponentsV2 });
          }
        } catch {
          // message gone → send new
          const sent = await (channel as any).send({
            components: [newContainer],
            files: panelImageFilesForPost(nextImage),
            flags: MessageFlags.IsComponentsV2,
          });
          updatePanelMessageId(guildId, sent.id);
        }
      } else {
        const sent = await (channel as any).send({
          components: [newContainer],
          files: panelImageFilesForPost(nextImage),
          flags: MessageFlags.IsComponentsV2,
        });
        updatePanelMessageId(guildId, sent.id);
      }
    }

    if (cfg.imageUrl && cfg.imageUrl !== nextImage) {
      deleteLocalPanelImage(cfg.imageUrl);
    }

    try { await (interaction as any).update({ components: [buildVerifyPanel(guildId)], flags: MessageFlags.IsComponentsV2 }); } catch { /* ignore */ }
    await interaction.followUp({ content: "✅ Verification config อัปเดตแล้ว", flags: MessageFlags.Ephemeral });
    return;
  }

  if (customId.startsWith("panel:protect:edit:modal:")) {
    const channelId = customId.split(":")[4];
    const bannerRaw = interaction.fields.getTextInputValue("banner").trim();
    const room = getProtectedRoom(guildId, channelId) as any;
    if (!room) {
      await interaction.reply({ content: "❌ ไม่พบ protected room", flags: MessageFlags.Ephemeral });
      return;
    }

    let nextImage: string | null = room.imageUrl;
    const wantsClear = bannerRaw.toLowerCase() === "clear";
    if (wantsClear) {
      nextImage = null;
    } else if (bannerRaw) {
      if (!/^https?:\/\//i.test(bannerRaw)) {
        await interaction.reply({ content: "❌ Banner ต้องเป็น URL หรือ 'clear'", flags: MessageFlags.Ephemeral });
        return;
      }
      nextImage = bannerRaw;
    }

    db.prepare(`UPDATE protectedRooms SET imageUrl = ? WHERE guildId = ? AND channelId = ?`).run(nextImage, guildId, channelId);
    invalidateProtectedRoom(guildId, channelId);

    if (room.imageUrl && room.imageUrl !== nextImage) {
      deleteLocalPanelImage(room.imageUrl);
    }

    // Re-post notice
    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased() && channel.isSendable()) {
      if (room.noticeMessageId) {
        try { await (channel as any).messages.delete(room.noticeMessageId); } catch { /* ignore */ }
      }
      try {
        const msg = await (channel as any).send({
          components: buildProtectRoomNoticeComponents(room.actionType as ProtectAction, room.actionCount ?? 0, nextImage),
          files: panelImageFilesForPost(nextImage),
          flags: MessageFlags.IsComponentsV2,
        });
        db.prepare(`UPDATE protectedRooms SET noticeMessageId = ? WHERE guildId = ? AND channelId = ?`).run(msg.id, guildId, channelId);
        invalidateProtectedRoom(guildId, channelId);
      } catch (e) {
        logger.warn(`[PANEL] re-post protect notice failed: ${e}`);
      }
    }

    try { await (interaction as any).update({ components: [buildProtectPanel(guildId, channelId)], flags: MessageFlags.IsComponentsV2 }); } catch { /* ignore */ }
    await interaction.followUp({ content: "✅ Banner อัปเดตแล้ว", flags: MessageFlags.Ephemeral });
    return;
  }

  if (customId.startsWith("panel:protect:timeout:modal:")) {
    const channelId = customId.split(":")[4];
    const raw = interaction.fields.getTextInputValue("minutes").trim();
    const minutes = parseInt(raw, 10);
    if (isNaN(minutes) || minutes < 1 || minutes > 10080) {
      await interaction.reply({ content: "❌ ใส่จำนวนนาที 1-10080", flags: MessageFlags.Ephemeral });
      return;
    }
    const ms = minutes * 60 * 1000;
    db.prepare(`UPDATE protectedRooms SET timeoutDuration = ? WHERE guildId = ? AND channelId = ?`).run(ms, guildId, channelId);
    invalidateProtectedRoom(guildId, channelId);
    try { await (interaction as any).update({ components: [buildProtectPanel(guildId, channelId)], flags: MessageFlags.IsComponentsV2 }); } catch { /* ignore */ }
    await interaction.followUp({ content: `✅ Timeout set to ${minutes} นาที`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({ content: "❌ Modal ไม่รู้จัก", flags: MessageFlags.Ephemeral });
}