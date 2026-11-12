import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import db from "../db";
import { getProtectedRoom } from "../dbCache";
import { getVerificationConfig, type VerificationMode } from "../verifyManager";
import { panelImageDisplayUrl } from "../panelImage";
import { PROTECT_ACTION_META, type ProtectAction } from "../protectRoom";
import type { ProtectedRoomRow } from "./shared";

/** The containers and modals the panel renders. */

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
    new TextDisplayBuilder().setContent("-# Powered by xspww"),
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
    : `Verified: <@&${cfg.verifiedRoleId}>\nUnverified: ไม่ได้ตั้ง`;
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
  container.addSeparatorComponents(new SeparatorBuilder());

  addVerifySelectors(container, cfg.verificationMode);

  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel:back").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel:refresh:verify").setLabel("🔄 Refresh").setStyle(ButtonStyle.Secondary),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("-# Powered by xspww"),
  );
  return container;
}

/** The mode, role and channel pickers of the verification panel. */
function addVerifySelectors(container: ContainerBuilder, mode: VerificationMode) {
  // Mode selector
  const modeSelect = new StringSelectMenuBuilder()
    .setCustomId("panel:verify:mode")
    .setPlaceholder("Verification mode");
  modeSelect.addOptions(
    new StringSelectMenuOptionBuilder().setLabel("🔐 Captcha (image code)").setValue("captcha").setDefault(mode === "captcha"),
    new StringSelectMenuOptionBuilder().setLabel("🔑 Code (invite + code)").setValue("code").setDefault(mode === "code"),
  );
  container.addActionRowComponents(
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modeSelect),
  );

  // Verified role selector
  const verifiedRoleSelect = new RoleSelectMenuBuilder()
    .setCustomId("panel:verify:role:verified")
    .setPlaceholder("Verified role")
    .setMinValues(1)
    .setMaxValues(1);
  container.addActionRowComponents(
    new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(verifiedRoleSelect),
  );

  // Panel channel selector
  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId("panel:verify:channel")
    .setPlaceholder("Panel channel")
    .setMinValues(1)
    .setMaxValues(1)
    .setChannelTypes([0]);
  container.addActionRowComponents(
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(channelSelect),
  );
}

// ─── Protected Room panel ────────────────────────────────────────────────────
export async function buildProtectPanel(guildId: string, channelId?: string | null) {
  const container = new ContainerBuilder().setAccentColor(0xef4444);

  // List protected rooms in this guild (for the channel selector)
  const rooms = db
    .prepare(`SELECT channelId FROM protectedRooms WHERE guildId = ?`)
    .all(guildId) as { channelId: string }[];

  // Fetch channel names for nicer labels (best-effort)
  const nameMap = await fetchChannelNames(guildId);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("# 🔒 Protected Room"),
  );

  if (rooms.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("ยังไม่มี protected room — ใช้ `/protectroom setup` ใน channel ที่ต้องการ"),
    );
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("panel:back").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
      ),
    );
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("-# Powered by xspww"));
    return container;
  }

  addProtectRoomSelector(container, rooms, nameMap, channelId);

  // If a valid channelId is selected, show details + actions
  const selectedId = channelId ?? null;
  const room = selectedId ? (getProtectedRoom(guildId, selectedId) as ProtectedRoomRow | null) : null;
  if (!room || !selectedId) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("เลือก channel จาก dropdown ด้านบน หรือใช้ `/protectroom setup`"),
    );
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("panel:back").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("panel:refresh:protect").setLabel("🔄 Refresh").setStyle(ButtonStyle.Secondary),
      ),
    );
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("-# Powered by xspww"));
    return container;
  }

  addProtectRoomDetails(container, room, selectedId);
  return container;
}

/** The channel names of a guild, for nicer select-menu labels. */
async function fetchChannelNames(guildId: string): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();
  try {
    const { client } = await import("../client.js");
    const guild = await client.guilds.fetch(guildId);
    const channels = await guild.channels.fetch();
    for (const [id, ch] of channels) {
      if (ch?.name) nameMap.set(id, ch.name);
    }
  } catch {
    // ignore — fall back to channelId
  }
  return nameMap;
}

/** The dropdown that picks which protected room to show. */
function addProtectRoomSelector(
  container: ContainerBuilder,
  rooms: { channelId: string }[],
  nameMap: Map<string, string>,
  channelId?: string | null,
) {
  const select = new StringSelectMenuBuilder()
    .setCustomId("panel:protect:select")
    .setPlaceholder("เลือก protected room channel");
  const shown = rooms.slice(0, 25);
  for (const r of shown) {
    const name = nameMap.get(r.channelId) ?? r.channelId;
    select.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(`#${name}`.slice(0, 100))
        .setValue(r.channelId)
        .setDefault(r.channelId === channelId),
    );
  }
  if (rooms.length > 25) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`⚠️ แสดง 25/${rooms.length} channels (Discord จำกัด 25 ต่อ select menu)`),
    );
  }
  container.addActionRowComponents(
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
  );
}

/** The details and action buttons of the selected protected room. */
function addProtectRoomDetails(
  container: ContainerBuilder,
  room: ProtectedRoomRow,
  channelId: string,
) {
  const meta = PROTECT_ACTION_META[room.actionType as ProtectAction];
  const bannerLine = room.imageUrl ? "🖼️ มี banner" : "🖼️ ไม่มี banner";
  container.addTextDisplayComponents(
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
      new ButtonBuilder().setCustomId(`panel:protect:disable:${channelId}`).setLabel("⛔ Disable").setStyle(ButtonStyle.Danger),
    ),
  );
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel:back").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`panel:refresh:protect:${channelId}`).setLabel("🔄 Refresh").setStyle(ButtonStyle.Secondary),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("-# Powered by xspww"),
  );
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

  const protectedCount = countRows(`SELECT COUNT(*) AS c FROM protectedRooms WHERE guildId = ?`, guildId);
  const alertCount = countRows(`SELECT COUNT(*) AS c FROM alerts WHERE guildId = ?`, guildId);
  const executorCount = countRows(
    `SELECT COUNT(*) AS c FROM executorStatusChannels WHERE guildId = ? AND enabled = 1`,
    guildId,
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${vLine}\n🔒 Protected Rooms: ${protectedCount}\n📡 Roblox Alerts: ${alertCount}\n🤖 Executor Status: ${executorCount} channels`,
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel:back").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("panel:refresh:status").setLabel("🔄 Refresh").setStyle(ButtonStyle.Secondary),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("-# Powered by xspww"),
  );
  return container;
}

/** Count the rows a `SELECT COUNT(*)` query returns. */
function countRows(sql: string, guildId: string): number {
  const row = db.prepare(sql).get(guildId) as { c: number } | undefined;
  return row?.c ?? 0;
}

// ─── Coming soon stub ────────────────────────────────────────────────────────
export function buildComingSoonPanel(title: string, hint?: string) {
  const container = new ContainerBuilder().setAccentColor(0x6b7280);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${title}`),
    new TextDisplayBuilder().setContent("🚧 กำลังพัฒนา"),
  );
  if (hint) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(hint),
    );
  }
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("panel:back").setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("-# Powered by xspww"),
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
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("unverified")
        .setLabel("Unverified role ID (หรือ 'clear')")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(30)
        .setValue(cfg?.unverifiedRoleId ?? ""),
    ),
  );
  return modal;
}
