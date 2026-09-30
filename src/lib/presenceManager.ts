import { ActivityType } from "discord.js";
import { client } from "./client";
import db from "./db";

export const STATUS_ROTATION_DEFAULT_INTERVAL_MS = 60_000;
export const STATUS_ROTATION_MIN_INTERVAL_MS = 5_000;

const DEFAULT_STREAM_URL = "https://www.twitch.tv/roblox";

export interface BotStatusMessage {
  id: number;
  activityText: string;
  streamUrl: string;
  customStatus: string;
  intervalMs: number;
  enabled: boolean;
}

let rotation: BotStatusMessage[] = [];
let currentIndex = 0;
let rotationTimer: ReturnType<typeof setTimeout> | null = null;

function buildActivities(activityText: string, streamUrl: string, customStatus?: string) {
  const custom = customStatus?.trim() ?? "";

  return [
    {
      name: activityText,
      type: ActivityType.Streaming,
      url: streamUrl,
    },
    ...(custom
      ? [
          {
            name: "Custom Status",
            type: ActivityType.Custom,
            state: custom,
          },
        ]
      : []),
  ];
}

function applyPresence(message: Pick<BotStatusMessage, "activityText" | "streamUrl" | "customStatus">) {
  client.user?.setPresence({
    activities: buildActivities(message.activityText, message.streamUrl, message.customStatus),
  });
}

function loadRotation() {
  rotation = db
    .prepare(
      `SELECT id, activityText, streamUrl, customStatus, intervalMs, enabled
       FROM botStatusMessages
       WHERE enabled = 1
       ORDER BY id`,
    )
    .all() as BotStatusMessage[];
  if (currentIndex >= rotation.length) currentIndex = 0;
}

function stopRotationTimer() {
  if (rotationTimer) {
    clearTimeout(rotationTimer);
    rotationTimer = null;
  }
}

/** Schedule the next switch after the *current* message's own interval. */
function startRotationTimer() {
  stopRotationTimer();
  if (rotation.length === 0) return;

  const current = rotation[currentIndex];
  const intervalMs = Math.max(
    typeof current.intervalMs === "number" && current.intervalMs > 0
      ? current.intervalMs
      : STATUS_ROTATION_DEFAULT_INTERVAL_MS,
    STATUS_ROTATION_MIN_INTERVAL_MS,
  );

  rotationTimer = setTimeout(() => {
    rotationTimer = null;
    if (rotation.length === 0) return;
    currentIndex = (currentIndex + 1) % rotation.length;
    applyPresence(rotation[currentIndex]);
    startRotationTimer();
  }, intervalMs);
}

/**
 * Add one message to the bot's rotating presence. The newly added message is
 * shown immediately (so the add is visible), then the bot cycles through all
 * configured messages, showing each for its own intervalMs.
 */
export function addBotStatusMessage(
  activityText: string,
  streamUrl?: string,
  customStatus?: string,
  intervalMs?: number,
) {
  const url = streamUrl && streamUrl.trim().length > 0 ? streamUrl.trim() : DEFAULT_STREAM_URL;
  const custom = customStatus?.trim() ?? "";
  const interval =
    typeof intervalMs === "number" && Number.isFinite(intervalMs) && intervalMs > 0
      ? Math.max(intervalMs, STATUS_ROTATION_MIN_INTERVAL_MS)
      : STATUS_ROTATION_DEFAULT_INTERVAL_MS;

  const info = db
    .prepare(
      `INSERT INTO botStatusMessages (activityText, streamUrl, customStatus, intervalMs, enabled)
       VALUES (?, ?, ?, ?, 1)`,
    )
    .run(activityText, url, custom, interval);

  loadRotation();

  const newId = Number(info.lastInsertRowid);
  const newIndex = rotation.findIndex((m) => m.id === newId);
  currentIndex = newIndex >= 0 ? newIndex : 0;

  applyPresence(rotation[currentIndex]);
  startRotationTimer();
}

/**
 * Clear every configured status message and remove the bot's presence
 * entirely. The removal is permanent: on the next boot the bot stays
 * presence-less until /status add is used again.
 */
export function resetBotStatus() {
  stopRotationTimer();
  rotation = [];
  currentIndex = 0;

  db.prepare(`DELETE FROM botStatusMessages`).run();
  db.prepare(`DELETE FROM botStatus WHERE id = 1`).run();

  client.user?.setPresence({ activities: [] });
}

/** Load the configured rotation on boot and start cycling. */
export function loadBotStatusOnBoot() {
  loadRotation();

  if (rotation.length === 0) {
    // Nothing configured — keep the presence empty so a /status remove
    // stays removed across restarts (no fallback to a default status).
    client.user?.setPresence({ activities: [] });
    return;
  }

  currentIndex = 0;
  applyPresence(rotation[currentIndex]);
  startRotationTimer();
}

/** Re-apply the currently configured rotation immediately — used by /status refresh. */
export function refreshBotStatus() {
  loadBotStatusOnBoot();
}
