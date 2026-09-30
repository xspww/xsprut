import { Client, Events } from "discord.js";
import config from "./config";
import logger from "./logger";

/**
 * Error Handling & Logging — notifies the developer the moment something goes
 * wrong so the bot never dies silently.
 *
 * All fatal/recoverable errors are pushed to a Discord webhook
 * (`ERROR_WEBHOOK_URL`). Sends are throttled (at most one per 5s) and repeated
 * errors inside the throttle window are coalesced into one message, so a
 * burst of failures (network outage, rate-limit storm) can never flood the
 * dev channel with hundreds of identical pings.
 */

const MIN_SEND_INTERVAL_MS = 5_000;
const MAX_QUEUED = 20;

let lastSendAt = 0;
let queued: string[] = [];
let flushTimer: NodeJS.Timeout | null = null;

function formatError(title: string, error: unknown, context?: string): string {
  const err = error instanceof Error ? error : new Error(String(error));
  const lines = [
    `🚨 **${title}**`,
    `**เวลา:** <t:${Math.floor(Date.now() / 1000)}:f>`,
  ];
  if (context) lines.push(`**บริบท:** ${context}`);
  lines.push(`**Error:** \`${err.name}: ${err.message}\``);
  if (err.stack) {
    const stack = err.stack.split("\n").slice(0, 12).join("\n");
    lines.push(`**Stack:**\n\`\`\`\n${stack}\n\`\`\``);
  }
  return lines.join("\n").slice(0, 1990); // stay under Discord's 2000-char limit
}

async function sendWebhook(content: string): Promise<void> {
  const url = config.ERROR_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      // e.g. the URL was deleted in Discord, or the webhook got rate-limited —
      // surface it instead of silently dropping developer notifications.
      logger.warn(`Error webhook responded HTTP ${res.status}`);
    }
  } catch (e) {
    logger.warn("Failed to send error webhook:", e);
  }
}

function flushQueue(): void {
  flushTimer = null;
  if (queued.length === 0) return;
  const batch = queued.splice(0, queued.length).join("\n\n---\n\n");
  lastSendAt = Date.now();
  void sendWebhook(batch.slice(0, 1990));
}

/**
 * Report an error to the developer webhook (throttled + coalesced).
 * Callers should already have logged the error themselves — this only handles
 * the Discord notification.
 */
export function reportError(title: string, error: unknown, context?: string): void {
  if (!config.ERROR_WEBHOOK_URL) return;

  const message = formatError(title, error, context);
  const now = Date.now();

  if (now - lastSendAt >= MIN_SEND_INTERVAL_MS && queued.length === 0) {
    // Throttle window is open and nothing is queued — send immediately.
    lastSendAt = now;
    void sendWebhook(message);
    return;
  }

  // Throttled — coalesce into the queue and flush when the window reopens.
  queued.push(message);
  if (queued.length > MAX_QUEUED) queued.shift(); // never let the queue grow unbounded
  if (!flushTimer) {
    const wait = Math.max(0, MIN_SEND_INTERVAL_MS - (now - lastSendAt));
    flushTimer = setTimeout(flushQueue, wait);
    flushTimer.unref?.();
  }
}

/**
 * Attach the bot's own error/warn events. Run once during startup.
 * Process-level crash handlers live in src/index.ts (they keep the burst/exit
 * logic) and call reportError() themselves.
 */
export function initErrorHandler(client: Client): void {
  client.on(Events.Error, (error) => {
    logger.error("Discord client error:", error);
    reportError("Discord client error", error);
  });

  client.on(Events.Warn, (info) => {
    logger.warn(String(info));
  });

  client.on(Events.Invalidated, () => {
    logger.error("Discord session invalidated — bot must reconnect.");
    reportError(
      "Discord session invalidated",
      new Error("Session invalidated — token reset or bot logged in elsewhere"),
    );
  });
}
