import fetch from "node-fetch";
import db from "../lib/db";
import { client } from "../lib/client";
import {
  getRobloxVersion,
  getRobloxVersionDetails,
} from "../lib/robloxVersion";
import { setWeaoRbxversionSnapshot } from "../lib/weaoVersions";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";



import { getVoiceConnection } from "@discordjs/voice";
import { joinBotVoiceChannel } from "../lib/voiceManager";
import logger from "../lib/logger";
import {
  EMBED_REFRESH_INTERVAL_DEFAULT_MS,
  EMBED_SCHEDULER_TICK_MS,
} from "../lib/constants";
import { interpolateV2Content, sendV2Message } from "../lib/v2Message";
import {
  getChannelState,
  getExecutorLastState,
  invalidateExecutorLastState,
  getExecutorAlerts,
  invalidateExecutorAlerts,
} from "../lib/dbCache";

const WEAO_EXPLOITS_URL = "https://whatexpsare.online/api/status/exploits";
const CHECK_INTERVAL_MS = 60_000;

type ExecutorStatusConfig = {
  guildId: string;
  categoryId: string;
  executorName: string;
  displayName: string;
  voiceChannelId: string | null;
};

export type WeaoExploit = {
  title?: string;
  version?: string;
  updateStatus?: boolean;
  updatedDate?: string;
  websitelink?: string;
  rbxversion?: string;
  // WEAO nests the long-form description under `slug.fullDescription`
  slug?: {
    fullDescription?: string;
    logo?: string;
    owner?: string;
    screenshots?: string[];
  };
  // WEAO also exposes a short reason the exploit was detected/patched
  detectionReason?: string;
  // Optional changelog or notes returned by the WEAO API
  changelog?: string;
  notes?: string;
  description?: string;
  // Some APIs may provide a URL to detailed changelog
  changelogUrl?: string;
};

let monitoring = false;

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

function createChannelName(displayName: string) {
  // Channel names are plain — no emoji/prefix decorations or status markers.
  return displayName;
}

const MONTH_TO_MM: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

/**
 * Extract the "last banwave" date from the WEAO `detectionReason` field and
 * format it as DD/MM/YYYY. WEAO provides free text such as
 * "Last banwave: June 1st", "Last banwave: March 6-18th" or "Last banwave: May 26",
 * so the month + day(s) are parsed and the current year is assumed (the API
 * does not include a year). Returns null when the reason is not about a banwave,
 * or the raw text when the date cannot be parsed.
 */
export function formatLastBanwave(detectionReason?: string): string | null {
  if (!detectionReason) return null;
  const text = detectionReason.trim();
  if (!/\bbanwave\b/i.test(text)) return null;

  const match = text.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b\s*(\d{1,2})(?:st|nd|rd|th)?(?:\s*(?:-|–|—|to)\s*(\d{1,2})(?:st|nd|rd|th)?)?/i,
  );
  if (!match) return text;

  const month = MONTH_TO_MM[match[1].toLowerCase()];
  const day1 = match[2].padStart(2, "0");
  const day2 = match[3] ? match[3].padStart(2, "0") : null;
  const year = new Date().getFullYear();

  return day2 ? `${day1}-${day2}/${month}/${year}` : `${day1}/${month}/${year}`;
}

// Shared resilient retry loop: exponential backoff with FULL JITTER (delay
// uniformly random in [0, base * 2^(n-1))). Rethrows the last error once all
// attempts are exhausted — callers decide whether to swallow it or abort.
const RETRY_BASE_DELAY_MS = 400;

export async function withRetry<T>(
  task: (attempt: number) => Promise<T>,
  opts: { attempts?: number; label: string },
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await task(attempt);
    } catch (e: any) {
      lastError = e;
      logger.warn(`Attempt ${attempt} ${opts.label} failed:`, e?.message || e);
      if (attempt < attempts) {
        const base = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        const delay = Math.floor(Math.random() * base);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

export async function fetchExecutorData(): Promise<WeaoExploit[]> {
  // Throws on total failure (after all attempts) so the monitoring tick aborts
  // instead of processing an empty exploit list (which would false-flag every
  // tracked executor as PATCHED). The monitoring loop logs the thrown error.
  return withRetry(async () => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(WEAO_EXPLOITS_URL, {
        headers: { "User-Agent": "RobloxUpdateTracker/1.0" },
        signal: controller.signal as any,
      });
      if (!response.ok) {
        throw new Error(`WEAO API returned HTTP ${response.status}`);
      }
      const data = (await response.json()) as WeaoExploit[];
      // Publish the rbxversion snapshot for LIVE fallback (Tier-1, no extra
      // request — see lib/weaoVersions.ts).
      setWeaoRbxversionSnapshot(data.map((e) => e.rbxversion));
      return data;
    } finally {
      clearTimeout(id); // always clear, even on non-ok responses
    }
  }, { attempts: 3, label: "to fetch WEAO exploits" });
}

async function fetchRobloxLiveVersion(): Promise<string> {
  const hash = await getRobloxVersion("LIVE");
  return hash || "N/A";
}

// ─── Executor Update Alert ─────────────────────────────────────────────────

/**
 * Build the Components v2 container for an executor update alert.
 * Mirrors the legacy embed: green accent, title/description, version info,
 * date, detection info and footer. When a logo URL is available it is shown
 * as the executor's thumbnail (Section accessory, right side).
 */
export function createExecutorUpdateContainer(opts: {
  displayName: string;
  verDisplay: string;
  robloxVersion: string;
  banwaveText?: string | null;
  nowUnix: number;
  logoUrl?: string | null;
}): ContainerBuilder {
  const headerText = new TextDisplayBuilder().setContent(
    `### An exploit update has been detected!\n\n**${opts.displayName}** has been updated for **Windows**!`,
  );

  // Detection info row is optional — only shown when the executor was caught
  // in a banwave (WEAO's detectionReason mentions "Last banwave: <date>").
  const banwaveRow = opts.banwaveText ? `\n**Last banwave:** \`${opts.banwaveText}\`` : "";

  const detailsText = new TextDisplayBuilder().setContent(
    `**New Version:** \`${opts.verDisplay}\`\n` +
      `**Roblox Version:** \`${opts.robloxVersion}\`\n` +
      `**Date:** <t:${opts.nowUnix}:F>` +
      banwaveRow,
  );

  const footerText = new TextDisplayBuilder().setContent("Powered by Diff Team");

  const container = new ContainerBuilder().setAccentColor(0x22c55e);

  if (opts.logoUrl) {
    // Header + details in a Section with the executor's logo as thumbnail.
    container.addSectionComponents(
      new SectionBuilder()
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(opts.logoUrl))
        .addTextDisplayComponents(headerText, detailsText),
    );
  } else {
    container.addTextDisplayComponents(headerText, detailsText);
  }

  container.addSeparatorComponents(new SeparatorBuilder());

  return container.addTextDisplayComponents(footerText);
}

export async function sendExecutorUpdateAlert(
  exploit: WeaoExploit,
  robloxVersion: string,
  targetExecutorName?: string,
  guildId?: string, // optional: restrict alerts to a specific guild (used by /test)
) {
  const searchName = normalizeName(targetExecutorName || exploit.title || "");
  if (!searchName) return;

  // Served from the DB cache (invalidated by /ex track add|remove|edit).
  const alertChannels = getExecutorAlerts(searchName, guildId);
  if (alertChannels.length === 0) return;

  const nowUnix = Math.floor(Date.now() / 1000);
  const verDisplay = exploit.version?.trim() || "N/A";
  const banwaveText = formatLastBanwave(exploit.detectionReason);

  for (const { channelId, displayName, customContent } of alertChannels) {
    const container = createExecutorUpdateContainer({
      displayName,
      verDisplay,
      robloxVersion,
      banwaveText,
      nowUnix,
      logoUrl: exploit.slug?.logo,
    });

    // Prepare custom content with placeholder support (same tokens as alerts)
    const messageContent = interpolateV2Content(customContent, {
      hash: verDisplay,
      channel: robloxVersion,
      version: verDisplay,
      date: `<t:${nowUnix}:F>`,
    });

    // Send the Components v2 alert to the channel
    try {
      const ch = await client.channels.fetch(channelId);
      if (ch?.isTextBased()) {
        const sent = await sendV2Message(ch, [container], messageContent);
        if (sent) {
          const guildName = "guild" in ch && ch.guild ? ch.guild.name : "Unknown guild";
          const channelName = "name" in ch ? `#${ch.name}` : channelId;
          logger.info(`Executor update [${displayName}] -> ${guildName} ${channelName}`);
        }
      }
    } catch (e: any) {
      if (e?.code === 10003) {
        logger.warn(`Channel ${channelId} not found — removing from executorAlerts`);
        db.prepare(`DELETE FROM executorAlerts WHERE channelId = ?`).run(channelId);
        invalidateExecutorAlerts();
      } else {
        logger.error(`Failed to send executor alert to ${channelId}:`, e);
      }
    }
  }
}

// ─── Chat Channel Status (Text Channel Rename) ────────────────────────────

type ChatStatusConfig = {
  guildId: string;
  categoryId: string;
  executorName: string;
  displayName: string;
  channelId: string | null;
};

function updateChatChannelId(cfg: ChatStatusConfig, channelId: string) {
  db.prepare(
    `UPDATE executorChatStatusChannels SET channelId = ?, updatedAt = ?
     WHERE guildId = ? AND executorName = ?`,
  ).run(channelId, Date.now(), cfg.guildId, cfg.executorName);
}

async function findOrCreateTextChannel(cfg: ChatStatusConfig) {
  const guild = await client.guilds.fetch(cfg.guildId);
  const channels = await guild.channels.fetch();

  if (cfg.channelId) {
    const existing = channels.get(cfg.channelId);
    if (existing?.type === ChannelType.GuildText) return existing;

    // Channel was created previously but has been deleted from Discord!
    logger.info(`Text channel ${cfg.channelId} was deleted by user — self-healing chat status config for ${cfg.executorName}`);
    db.prepare(`UPDATE executorChatStatusChannels SET channelId = NULL WHERE guildId = ? AND executorName = ?`).run(cfg.guildId, cfg.executorName);
  }

  const category = channels.get(cfg.categoryId);
  if (category?.type !== ChannelType.GuildCategory) {
    throw new Error(`Category ${cfg.categoryId} was not found.`);
  }

  const baseName = normalizeName(cfg.displayName);
  const existing = channels.find(
    (ch) =>
      ch?.type === ChannelType.GuildText &&
      ch.parentId === cfg.categoryId &&
      normalizeName(ch.name.split("・").pop() ?? ch.name) === baseName,
  );
  if (existing?.type === ChannelType.GuildText) {
    updateChatChannelId(cfg, existing.id);
    return existing;
  }

  const botMember = await guild.members.fetchMe();
  if (!category.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error("Bot is missing Manage Channels permission.");
  }

  const created = await guild.channels.create({
    name: createChannelName(cfg.displayName),
    type: ChannelType.GuildText,
    parent: cfg.categoryId,
  });

  updateChatChannelId(cfg, created.id);
  return created;
}

export async function updateExecutorChatStatusChannels() {
  const rows = db
    .prepare(
      `SELECT guildId, categoryId, executorName, displayName, channelId
       FROM executorChatStatusChannels WHERE enabled = 1`,
    )
    .all() as ChatStatusConfig[];

  for (const row of rows) {
    try {
      const ch = await findOrCreateTextChannel(row);
      if (!ch) continue;
      const nextName = createChannelName(row.displayName);
      if (ch.name !== nextName) {
        await ch.setName(nextName, "Roblox executor status changed");
      }
    } catch (e: any) {
      logger.error(`Failed to update chat channel for ${row.executorName}:`, e);
    }
  }
}

// ─── Voice Channel Status ─────────────────────────────────────────────────

function getVoiceConfigs() {
  return db
    .prepare(
      `SELECT guildId, categoryId, executorName, displayName, voiceChannelId
       FROM executorStatusChannels WHERE enabled = 1`,
    )
    .all() as ExecutorStatusConfig[];
}

function updateVoiceChannelId(config: ExecutorStatusConfig, voiceChannelId: string) {
  db.prepare(
    `UPDATE executorStatusChannels SET voiceChannelId = ?, updatedAt = ?
     WHERE guildId = ? AND executorName = ?`,
  ).run(voiceChannelId, Date.now(), config.guildId, config.executorName);
}

async function findOrCreateVoiceChannel(cfg: ExecutorStatusConfig) {
  const guild = await client.guilds.fetch(cfg.guildId);
  const channels = await guild.channels.fetch();

  if (cfg.voiceChannelId) {
    const existing = channels.get(cfg.voiceChannelId);
    if (existing?.type === ChannelType.GuildVoice) return existing;

    logger.info(`Voice channel ${cfg.voiceChannelId} was deleted by user — self-healing voice status config for ${cfg.executorName}`);
    db.prepare(`UPDATE executorStatusChannels SET voiceChannelId = NULL WHERE guildId = ? AND executorName = ?`).run(cfg.guildId, cfg.executorName);
  }

  const category = channels.get(cfg.categoryId);
  if (category?.type !== ChannelType.GuildCategory) {
    throw new Error(`Category ${cfg.categoryId} was not found.`);
  }

  const baseName = normalizeName(cfg.displayName);
  const existing = channels.find(
    (ch) =>
      ch?.type === ChannelType.GuildVoice &&
      ch.parentId === cfg.categoryId &&
      normalizeName(ch.name.split("・").pop() ?? ch.name) === baseName,
  );
  if (existing?.type === ChannelType.GuildVoice) {
    updateVoiceChannelId(cfg, existing.id);
    return existing;
  }

  const botMember = await guild.members.fetchMe();
  if (!category.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error("Bot is missing Manage Channels permission.");
  }

  const created = await guild.channels.create({
    name: createChannelName(cfg.displayName),
    type: ChannelType.GuildVoice,
    parent: cfg.categoryId,
  });

  updateVoiceChannelId(cfg, created.id);
  return created;
}

// ─── Main Update Loop ─────────────────────────────────────────────────────

export async function updateExecutorStatusChannels() {
  const exploits = await fetchExecutorData();
  const statusMap = new Map<string, WeaoExploit>();
  for (const e of exploits) {
    if (e.title) statusMap.set(normalizeName(e.title), e);
  }

  // Check version updates for text alerts
  let robloxVersion: string | null = null;
  for (const exploit of exploits) {
    if (!exploit.title) continue;

    const last = getExecutorLastState(exploit.title);

    const currentVersion = exploit.version?.trim() || null;
    const currentStatus = exploit.updateStatus ? "WORKING" : "PATCHED";

    // Deduplication check: only alert if updateStatus is true AND version exists AND lastAlertedVersion != currentVersion
    if (
      exploit.updateStatus &&
      currentVersion &&
      (!last || last.lastAlertedVersion !== currentVersion)
    ) {
      if (!robloxVersion) robloxVersion = await fetchRobloxLiveVersion();
      await sendExecutorUpdateAlert(exploit, robloxVersion, exploit.title);

      db.prepare(
        `INSERT INTO executorLastState (title, version, status, lastAlertedVersion, updatedAt) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(title) DO UPDATE SET version = excluded.version, status = excluded.status, lastAlertedVersion = excluded.lastAlertedVersion, updatedAt = excluded.updatedAt`,
      ).run(exploit.title, currentVersion, currentStatus, currentVersion, Date.now());
    } else {
      db.prepare(
        `INSERT INTO executorLastState (title, version, status, updatedAt) VALUES (?, ?, ?, ?)
         ON CONFLICT(title) DO UPDATE SET version = excluded.version, status = excluded.status, updatedAt = excluded.updatedAt`,
      ).run(exploit.title, currentVersion, currentStatus, Date.now());
    }
    // The cache now holds stale data for this executor — drop it.
    invalidateExecutorLastState(exploit.title);
  }

  // Update voice channels
  const voiceConfigs = getVoiceConfigs();
  for (const cfg of voiceConfigs) {
    try {
      const ch = await findOrCreateVoiceChannel(cfg);
      const nextName = createChannelName(cfg.displayName);
      if (ch.name !== nextName) {
        await ch.setName(nextName, "Roblox executor status changed");
      }
    } catch (error) {
      logger.error(`Failed to update voice channel for ${cfg.executorName}:`, error);
    }
  }

  // Update chat status embeds (per-executor)
  await updateExecutorChatStatusChannels();

  // Embed Status messages are refreshed by startEmbedStatusScheduler()
  // according to each row's intervalMs — do NOT call forceRefreshEmbeds() here.

  // Update bot online voice status
  await updateBotVoiceChannels();

  // Update bot chat status (Roblox version)
  await updateBotChatChannels();
}

// ─── Embed Status Channels ──────────────────────────────────────────────

type EmbedStatusConfig = {
  guildId: string;
  channelId: string;
  messageId: string | null;
  executorName: string;
  displayName: string;
  customContent: string;
  intervalMs: number;
};

export async function updateExecutorEmbedStatusChannels(
  statusMap: Map<string, WeaoExploit>,
  robloxLiveVersion?: string | null,
) {
  const rawRows = db
    .prepare(
      `SELECT guildId, channelId, messageId, executorName, displayName, customContent, intervalMs
       FROM executorEmbedStatusChannels WHERE enabled = 1`,
    )
    .all() as (Omit<EmbedStatusConfig, "intervalMs"> & { intervalMs?: number | null })[];

  // Normalize intervalMs to a safe default for older rows and cast to proper type
  const rows: EmbedStatusConfig[] = rawRows.map((r) => {
    const interval = r.intervalMs && r.intervalMs > 0 ? r.intervalMs : EMBED_REFRESH_INTERVAL_DEFAULT_MS;
    return { ...r, intervalMs: interval };
  });

  if (rows.length === 0) return;

  await applyEmbedStatusRows(rows, statusMap, robloxLiveVersion);
}

/**
 * Render + edit/send a specific set of embed status rows.
 * Used both by the global update path and the per-row scheduler.
 */
async function applyEmbedStatusRows(
  rows: EmbedStatusConfig[],
  statusMap: Map<string, WeaoExploit>,
  robloxLiveVersion?: string | null,
) {
  if (rows.length === 0) return;

  const rbxVer = robloxLiveVersion || (await fetchRobloxLiveVersion());

  for (const row of rows) {
    try {
      const searchKey = normalizeName(row.executorName);
      const exploit = statusMap.get(searchKey);

      const nowUnix = Math.floor(Date.now() / 1000);
      const isWorking = exploit?.updateStatus === true;
      const verDisplay = exploit?.version?.trim() || "N/A";
      const rbxVerDisplay = exploit?.rbxversion || rbxVer || "N/A";
      const websiteUrl = exploit?.websitelink?.trim();

      const accentColor = isWorking ? 0x22c55e : 0xef4444;

      // Largest heading (#) so the executor name renders big and bold —
      // applied to every executor since displayName is uppercased here.
      const headerText = `# ${row.displayName.toUpperCase()}`;
      const headerTextDisplay = new TextDisplayBuilder().setContent(headerText);

      const banwaveText = formatLastBanwave(exploit?.detectionReason);
      const productText = `**Product**\n• Version: \`${verDisplay}\`\n• Roblox Version: \`${rbxVerDisplay}\`\n• Status: ${isWorking ? "🟢 Working" : "🔴 Patched"}${banwaveText ? `\n• Last banwave: \`${banwaveText}\`` : ""}`;
      const productTextDisplay = new TextDisplayBuilder().setContent(productText);

      const timestampText = new TextDisplayBuilder().setContent(`Auto-updated. Last check: <t:${nowUnix}:R>`);

      const container = new ContainerBuilder().setAccentColor(accentColor);
      const logoUrl = exploit?.slug?.logo;

      if (logoUrl) {
        // Header + product info in a Section with the executor's logo as thumbnail.
        container.addSectionComponents(
          new SectionBuilder()
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(logoUrl))
            .addTextDisplayComponents(headerTextDisplay, productTextDisplay),
        );
        container.addSeparatorComponents(new SeparatorBuilder());
      } else {
        container
          .addTextDisplayComponents(headerTextDisplay)
          .addSeparatorComponents(new SeparatorBuilder())
          .addTextDisplayComponents(productTextDisplay)
          .addSeparatorComponents(new SeparatorBuilder());
      }

      if (websiteUrl && (websiteUrl.startsWith("http://") || websiteUrl.startsWith("https://"))) {
        const btn = new ButtonBuilder()
          .setLabel("Website")
          .setStyle(ButtonStyle.Link)
          .setURL(websiteUrl);
        container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(btn));
        container.addSeparatorComponents(new SeparatorBuilder());
      }

      container.addTextDisplayComponents(timestampText);



      const messageContent = row.customContent?.trim() || undefined;

      const ch = await client.channels.fetch(row.channelId);
      if (!ch?.isTextBased() || !ch.isSendable()) continue;

      let targetMsg = null;
      if (row.messageId) {
        try {
          targetMsg = await ch.messages.fetch(row.messageId);
        } catch {
          logger.info(`Components V2 message ${row.messageId} was deleted in channel ${row.channelId} — will recreate`);
        }
      }

      if (targetMsg) {
        // ComponentsV2 messages cannot use the legacy `content` field on edit.
        // If we have custom content, inject it as a TextDisplay component so Discord accepts the request.
        const isComponentsV2Edit = (targetMsg.flags?.bitfield ?? 0) & MessageFlags.IsComponentsV2;
        if (isComponentsV2Edit && messageContent) {
          const customTextDisplay = new TextDisplayBuilder().setContent(messageContent);
          await targetMsg.edit({
            components: [customTextDisplay, container],
            flags: MessageFlags.IsComponentsV2 as any,
          });
        } else if (isComponentsV2Edit) {
          await targetMsg.edit({
            components: [container],
            flags: MessageFlags.IsComponentsV2 as any,
          });
        } else {
          // Existing message is NOT ComponentsV2 — we can't switch a regular message to V2 via edit,
          // so delete the old message and send a fresh one.
          try {
            await targetMsg.delete();
          } catch {
            /* ignore */
          }
          const newMsg = await sendV2Message(ch, [container], messageContent);
          if (newMsg) {
            db.prepare(
              `UPDATE executorEmbedStatusChannels SET messageId = ?, updatedAt = ?
               WHERE guildId = ? AND channelId = ? AND executorName = ?`,
            ).run(newMsg.id, Date.now(), row.guildId, row.channelId, row.executorName);
          }
        }
      } else {
        const newMsg = await sendV2Message(ch, [container], messageContent);
        if (newMsg) {
          db.prepare(
            `UPDATE executorEmbedStatusChannels SET messageId = ?, updatedAt = ?
             WHERE guildId = ? AND channelId = ? AND executorName = ?`,
          ).run(newMsg.id, Date.now(), row.guildId, row.channelId, row.executorName);
        }
      }

    } catch (e: any) {
      if (e?.code === 10003) {
        logger.warn(`Channel ${row.channelId} not found — disabling embed status config`);
        db.prepare(`UPDATE executorEmbedStatusChannels SET enabled = 0 WHERE channelId = ?`).run(row.channelId);
      } else {
        logger.error(`Failed to update embed status for ${row.executorName} in ${row.channelId}:`, e);
      }
    }
  }
}


// ─── Embed Status Scheduler (per-row intervalMs) ─────────────────────────

let embedSchedulerTick: NodeJS.Timeout | null = null;
const lastEmbedRefreshAt = new Map<string, number>();

function embedRowKey(row: { guildId: string; channelId: string; executorName: string }) {
  return `${row.guildId}:${row.channelId}:${row.executorName.toLowerCase()}`;
}

/**
 * Serialize every embed refresh (forceRefreshEmbeds + scheduler ticks) so two
 * refreshes can never run at the same time. Without this, a force-refresh can
 * overlap with a scheduler tick (or two ticks can overlap when a fetch is slow)
 * and both read a row with messageId = NULL, each sending its own embed and
 * leaving a duplicate card in the channel.
 */
let embedRefreshChain: Promise<void> = Promise.resolve();

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = embedRefreshChain.then(fn);
  embedRefreshChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Force-refresh every enabled Embed Status row immediately.
 * Updates lastEmbedRefreshAt so the scheduler won't double-fire for the same window.
 */
export function forceRefreshEmbeds() {
  return runSerialized(async () => {
    const exploits = await fetchExecutorData();
    const statusMap = new Map<string, WeaoExploit>();
    for (const e of exploits) {
      if (e.title) statusMap.set(normalizeName(e.title), e);
    }

    await updateExecutorEmbedStatusChannels(statusMap);

    // Mark every enabled row as just-refreshed so the per-row scheduler waits.
    const now = Date.now();
    const rows = db
      .prepare(
        `SELECT guildId, channelId, executorName FROM executorEmbedStatusChannels WHERE enabled = 1`,
      )
      .all() as { guildId: string; channelId: string; executorName: string }[];
    for (const r of rows) {
      lastEmbedRefreshAt.set(embedRowKey(r), now);
    }
  });
}

let embedSchedulerRunning = false;

async function embedSchedulerLoop() {
  // Never let ticks overlap: if the previous tick (or its queued refresh) is
  // still in-flight, skip this one instead of queueing up more fetches.
  if (embedSchedulerRunning) return;
  embedSchedulerRunning = true;
  try {
    await runSerialized(async () => {
      try {
        const rows = db
          .prepare(
            `SELECT guildId, channelId, executorName, intervalMs FROM executorEmbedStatusChannels WHERE enabled = 1`,
          )
          .all() as { guildId: string; channelId: string; executorName: string; intervalMs: number | null }[];

        if (rows.length === 0) return;

        const now = Date.now();
        const due: typeof rows = [];
        const seenKeys = new Set<string>();

        for (const r of rows) {
          const key = embedRowKey(r);
          seenKeys.add(key);
          const interval = r.intervalMs && r.intervalMs > 0 ? r.intervalMs : EMBED_REFRESH_INTERVAL_DEFAULT_MS;
          const last = lastEmbedRefreshAt.get(key) ?? 0;
          if (now - last >= interval) due.push(r);
        }

        // Garbage-collect keys for rows that no longer exist
        for (const key of Array.from(lastEmbedRefreshAt.keys())) {
          if (!seenKeys.has(key)) lastEmbedRefreshAt.delete(key);
        }

        if (due.length === 0) return;

        const exploits = await fetchExecutorData();
        const statusMap = new Map<string, WeaoExploit>();
        for (const e of exploits) {
          if (e.title) statusMap.set(normalizeName(e.title), e);
        }

        // Refresh only the due rows by re-using the per-row update path
        for (const r of due) {
          const key = embedRowKey(r);
          try {
            await refreshSingleEmbedStatusRow(r, statusMap);
            lastEmbedRefreshAt.set(key, Date.now());
          } catch (e: any) {
            logger.error(`Embed scheduler failed for ${r.executorName} in ${r.channelId}:`, e);
          }
        }
      } catch (e) {
        logger.error("Embed scheduler tick failed:", e);
      }
    });
  } finally {
    embedSchedulerRunning = false;
  }
}

/**
 * Refresh a single Embed Status row (used by the per-row scheduler to avoid
 * re-editing every row when only a few are due).
 */
async function refreshSingleEmbedStatusRow(
  row: { guildId: string; channelId: string; executorName: string },
  statusMap: Map<string, WeaoExploit>,
) {
  const fullRow = db
    .prepare(
      `SELECT guildId, channelId, messageId, executorName, displayName, customContent, intervalMs
       FROM executorEmbedStatusChannels
       WHERE guildId = ? AND channelId = ? AND executorName = ? AND enabled = 1`,
    )
    .get(row.guildId, row.channelId, row.executorName) as EmbedStatusConfig | undefined;

  if (!fullRow) return;

  if (!fullRow.intervalMs || fullRow.intervalMs <= 0) {
    fullRow.intervalMs = EMBED_REFRESH_INTERVAL_DEFAULT_MS;
  }

  await applyEmbedStatusRows([fullRow], statusMap);
}

export function startEmbedStatusScheduler() {
  if (embedSchedulerTick) {
    logger.info("Embed status scheduler already running.");
    return;
  }

  embedSchedulerTick = setInterval(() => {
    void embedSchedulerLoop();
  }, EMBED_SCHEDULER_TICK_MS);
  logger.info(`Embed status scheduler started (tick every ${EMBED_SCHEDULER_TICK_MS / 1000}s).`);
}


// ─── Bot Online Voice Status ──────────────────────────────────────────────

type BotVoiceConfig = {
  guildId: string;
  categoryId: string;
  voiceChannelId: string | null;
  mode: string;
  displayName: string;
  robloxChannel: string;
  omitPrefix?: number | boolean;
};

type BotChatConfig = {
  guildId: string;
  categoryId: string | null;
  channelId: string | null;
  mode: string;
  displayName: string;
  robloxChannel: string;
  omitPrefix?: number | boolean;
};

/**
 * Resolve the display hash for each distinct Roblox channel ONCE per tick and
 * share it across all guild rows (previously every guild row awaited its own
 * fetch: N guilds = N requests per 60s tick).
 *
 * Reads the monitor's channelState first (refreshed every 10s, cached 9s) —
 * a state row only changes when the version actually changes, which is
 * exactly when a rename matters. A fresh fetch runs only for channels with
 * no recorded state yet (e.g. fresh DB), so the steady state makes ZERO
 * Roblox API calls from these ticks.
 */
async function resolveDisplayVersionsForRows(
  rows: { robloxChannel?: string | null }[],
): Promise<Map<string, string | null>> {
  const needed = new Set<string>();
  for (const row of rows) needed.add(row.robloxChannel || "LIVE");

  const resolved = new Map<string, string | null>();
  const missing: string[] = [];
  for (const channel of needed) {
    const state = getChannelState(channel);
    if (state?.currentVersion) resolved.set(channel, state.currentVersion);
    else missing.push(channel);
  }

  const fresh = await Promise.all(
    missing.map(async (channel) => {
      const details = await getRobloxVersionDetails(channel, { useCache: false });
      return [channel, details?.hash ?? null] as const;
    }),
  );
  for (const [channel, hash] of fresh) {
    if (hash) resolved.set(channel, hash);
  }
  return resolved;
}

async function findOrCreateBotVoiceChannel(cfg: BotVoiceConfig, targetName: string) {
  const guild = await client.guilds.fetch(cfg.guildId);
  const channels = await guild.channels.fetch();

  if (cfg.voiceChannelId) {
    const existing = channels.get(cfg.voiceChannelId);
    if (existing?.type === ChannelType.GuildVoice) return existing;

    // Channel was deleted from Discord by user
    logger.info(`Bot voice channel ${cfg.voiceChannelId} was deleted by user — self-healing bot voice config`);
    db.prepare(`UPDATE botVoiceChannels SET voiceChannelId = NULL WHERE guildId = ?`).run(cfg.guildId);
  }

  const category = channels.get(cfg.categoryId);
  if (category?.type !== ChannelType.GuildCategory) {
    throw new Error(`Category ${cfg.categoryId} was not found.`);
  }

  const botMember = await guild.members.fetchMe();
  if (!category.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error("Bot is missing Manage Channels permission.");
  }

  const created = await guild.channels.create({
    name: targetName,
    type: ChannelType.GuildVoice,
    parent: cfg.categoryId,
  });

  db.prepare(`UPDATE botVoiceChannels SET voiceChannelId = ?, updatedAt = ? WHERE guildId = ?`).run(created.id, Date.now(), cfg.guildId);
  return created;
}

export async function updateBotVoiceChannels() {
  const rows = db
    .prepare(
      `SELECT guildId, categoryId, voiceChannelId, mode, displayName, robloxChannel, omitPrefix
       FROM botVoiceChannels WHERE enabled = 1`,
    )
    .all() as BotVoiceConfig[];

  // One lookup per distinct Roblox channel per tick (not per guild).
  const versionsByChannel = rows.some((r) => r.mode === "roblox-version")
    ? await resolveDisplayVersionsForRows(rows)
    : new Map<string, string | null>();

  for (const row of rows) {
    try {
      let display = row.displayName || "Bot Online";
      if (row.mode === "roblox-version") {
        const robloxVer = versionsByChannel.get(row.robloxChannel || "LIVE");
        if (robloxVer) {
          display = robloxVer;
        }
      }

      const ch = await findOrCreateBotVoiceChannel(row, display);
      if (!ch) continue;

      if (ch.name !== display) {
        await ch.setName(display, "Bot online status update");
      }

      // Auto-join bot into the voice channel (24/7 Voice Join).
      try {
        const connection = getVoiceConnection(row.guildId);
        if (!connection || connection.joinConfig.channelId !== ch.id) {
          const ok = await joinBotVoiceChannel(row.guildId, ch.id);
          if (!ok) {
            logger.warn(`joinBotVoiceChannel returned false for guild ${row.guildId} / channel ${ch.id}`);
          }
        }
      } catch (e) {
        logger.error(`Failed to join voice channel ${ch.id}:`, e);
      }
    } catch (e: any) {
      logger.error(`Failed to update bot voice channel for guild ${row.guildId}:`, e);
    }
  }
}

// ─── Bot Chat Status (Roblox Version) ────────────────────────────────────

async function findOrCreateBotChatChannel(cfg: BotChatConfig, targetName: string) {
  const guild = await client.guilds.fetch(cfg.guildId);
  const channels = await guild.channels.fetch();

  if (cfg.channelId) {
    const existing = channels.get(cfg.channelId);
    if (existing?.type === ChannelType.GuildText) return existing;

    // Channel was deleted from Discord by user
    logger.info(`Bot chat channel ${cfg.channelId} was deleted by user — self-healing bot chat config`);
    db.prepare(`UPDATE botChatChannels SET channelId = NULL WHERE guildId = ?`).run(cfg.guildId);
  }

  const category = cfg.categoryId ? channels.get(cfg.categoryId) : undefined;
  if (cfg.categoryId && category?.type !== ChannelType.GuildCategory) {
    throw new Error(`Category ${cfg.categoryId} was not found.`);
  }

  const botMember = await guild.members.fetchMe();
  const parent = category as any;
  if (parent && !parent.permissionsFor?.(botMember)?.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error("Bot is missing Manage Channels permission.");
  }

  const created = await guild.channels.create({
    name: targetName,
    type: ChannelType.GuildText,
    parent: cfg.categoryId ?? undefined,
  });

  db.prepare(`UPDATE botChatChannels SET channelId = ?, updatedAt = ? WHERE guildId = ?`).run(created.id, Date.now(), cfg.guildId);
  return created;
}

export async function updateBotChatChannels() {
  const rows = db
    .prepare(
      `SELECT guildId, categoryId, channelId, mode, displayName, robloxChannel, omitPrefix
       FROM botChatChannels WHERE enabled = 1`,
    )
    .all() as BotChatConfig[];

  // One lookup per distinct Roblox channel per tick (not per guild).
  const versionsByChannel = rows.some((r) => r.mode === "roblox-version")
    ? await resolveDisplayVersionsForRows(rows)
    : new Map<string, string | null>();

  for (const row of rows) {
    try {
      let display = row.displayName || "Bot Online";
      if (row.mode === "roblox-version") {
        const robloxVer = versionsByChannel.get(row.robloxChannel || "LIVE");
        if (robloxVer) {
          display = robloxVer;
        }
      }

      const ch = await findOrCreateBotChatChannel(row, display);
      if (!ch) continue;

      if (ch.name !== display) {
        await ch.setName(display, "Roblox version status update");
      }
    } catch (e: any) {
      logger.error(`Failed to update bot chat channel for guild ${row.guildId}:`, e);
    }
  }
}


export function startExecutorStatusMonitoring() {
  if (monitoring) {
    logger.info("Executor status monitoring already running.");
    return;
  }

  monitoring = true;
  logger.info("Executor status monitoring running.");

  // Never let ticks overlap: when the network is slow a single cycle (WEAO
  // fetch + Discord REST calls) can outlast the 60s interval, and overlapping
  // cycles would flood Discord with duplicate renames/edits/voice joins.
  let loopRunning = false;

  async function check() {
    if (loopRunning) return;
    loopRunning = true;
    try {
      await updateExecutorStatusChannels();
    } catch (error) {
      logger.error("Error while checking executor statuses:", error);
    } finally {
      loopRunning = false;
    }
  }

  void check();
  setInterval(check, CHECK_INTERVAL_MS);

  // Per-row scheduler for Embed Status refresh intervals
  startEmbedStatusScheduler();
}
