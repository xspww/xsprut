import { randomInt } from "node:crypto";
import db from "../lib/db";

// ─── In-memory Captcha Sessions ────────────────────────────────────────────

type CaptchaSession = {
  code: string;
  expiresAt: number;
};

const captchaSessions = new Map<string, CaptchaSession>();

const CAPTCHA_TTL_MS = 3 * 60 * 1000; // 3 minutes

// Sessions are only deleted on validation, so users who click "Verify" and
// never submit would otherwise leave entries in the map forever. Sweep expired
// sessions every minute to keep the map bounded.
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of captchaSessions) {
    if (now > session.expiresAt) {
      captchaSessions.delete(userId);
    }
  }
}, 60_000).unref();

export function createCaptchaSession(userId: string): string {
  // Use a cryptographically secure RNG so the 4-digit code is truly random
  // (Math.random is a predictable PRNG).
  const code = String(randomInt(0, 10000)).padStart(4, "0");
  captchaSessions.set(userId, {
    code,
    expiresAt: Date.now() + CAPTCHA_TTL_MS,
  });
  return code;
}

export function validateCaptchaSession(userId: string, input: string): "correct" | "wrong" | "expired" | "not_found" {
  const session = captchaSessions.get(userId);
  if (!session) return "not_found";
  if (Date.now() > session.expiresAt) {
    captchaSessions.delete(userId);
    return "expired";
  }
  if (input.trim() !== session.code) return "wrong";
  captchaSessions.delete(userId);
  return "correct";
}

// ─── Database helpers ────────────────────────────────────────────────────────

export type VerificationConfig = {
  guildId: string;
  channelId: string;
  verifiedRoleId: string;
  unverifiedRoleId: string | null;
  embedTitle: string;
  embedDescription: string;
  successMessage: string;
  enabled: number;
  createdAt: number;
};

export function getVerificationConfig(guildId: string): VerificationConfig | null {
  return (
    db
      .prepare(`SELECT * FROM verificationConfig WHERE guildId = ? AND enabled = 1`)
      .get(guildId) as VerificationConfig | undefined
  ) ?? null;
}

export function saveVerificationConfig(cfg: Omit<VerificationConfig, "enabled">) {
  db.prepare(
    `INSERT INTO verificationConfig (guildId, channelId, verifiedRoleId, unverifiedRoleId, embedTitle, embedDescription, successMessage, enabled, createdAt)
     VALUES (@guildId, @channelId, @verifiedRoleId, @unverifiedRoleId, @embedTitle, @embedDescription, @successMessage, 1, @createdAt)
     ON CONFLICT(guildId) DO UPDATE SET
       channelId = excluded.channelId,
       verifiedRoleId = excluded.verifiedRoleId,
       unverifiedRoleId = excluded.unverifiedRoleId,
       embedTitle = excluded.embedTitle,
       embedDescription = excluded.embedDescription,
       successMessage = excluded.successMessage,
       enabled = 1,
       createdAt = excluded.createdAt`,
  ).run(cfg);
}

export function disableVerificationConfig(guildId: string) {
  db.prepare(`UPDATE verificationConfig SET enabled = 0 WHERE guildId = ?`).run(guildId);
}
