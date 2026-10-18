import { randomInt } from "node:crypto";
import db from "../lib/db";

// ─── In-memory Captcha Sessions ────────────────────────────────────────────

type CaptchaSession = {
  code: string;
  expiresAt: number;
  attempts: number;
};

const captchaSessions = new Map<string, CaptchaSession>();

export const CAPTCHA_TTL_MS = 3 * 60 * 1000; // 3 minutes
// A 4-digit code is only 10,000 possibilities, so unlimited guesses inside the
// TTL window are brute-forceable. After this many wrong guesses the session is
// destroyed and the user must request a fresh code.
export const CAPTCHA_MAX_ATTEMPTS = 3;

export type CaptchaResult =
  | "correct"
  | "wrong"
  | "expired"
  | "not_found"
  | "locked";

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
    attempts: 0,
  });
  return code;
}

/**
 * Validate a submitted code.
 *
 * `now` is injectable so tests can exercise expiry without waiting.
 * Wrong guesses are counted: once `CAPTCHA_MAX_ATTEMPTS` is reached the session
 * is destroyed (`"locked"`) and the user must start over with a new code.
 */
export function validateCaptchaSession(
  userId: string,
  input: string,
  now: number = Date.now(),
): CaptchaResult {
  const session = captchaSessions.get(userId);
  if (!session) return "not_found";
  if (now > session.expiresAt) {
    captchaSessions.delete(userId);
    return "expired";
  }
  if (input.trim() !== session.code) {
    session.attempts += 1;
    if (session.attempts >= CAPTCHA_MAX_ATTEMPTS) {
      captchaSessions.delete(userId);
      return "locked";
    }
    return "wrong";
  }
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
  imageUrl: string | null;
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
    `INSERT INTO verificationConfig (guildId, channelId, verifiedRoleId, unverifiedRoleId, embedTitle, embedDescription, successMessage, imageUrl, enabled, createdAt)
     VALUES (@guildId, @channelId, @verifiedRoleId, @unverifiedRoleId, @embedTitle, @embedDescription, @successMessage, @imageUrl, 1, @createdAt)
     ON CONFLICT(guildId) DO UPDATE SET
       channelId = excluded.channelId,
       verifiedRoleId = excluded.verifiedRoleId,
       unverifiedRoleId = excluded.unverifiedRoleId,
       embedTitle = excluded.embedTitle,
       embedDescription = excluded.embedDescription,
       successMessage = excluded.successMessage,
       imageUrl = excluded.imageUrl,
       enabled = 1,
       createdAt = excluded.createdAt`,
  ).run(cfg);
}

export function disableVerificationConfig(guildId: string) {
  db.prepare(`UPDATE verificationConfig SET enabled = 0 WHERE guildId = ?`).run(guildId);
}
