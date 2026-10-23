import { createHash, randomBytes, randomInt } from "node:crypto";
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

// ─── Invite-bound verification codes ────────────────────────────────────────
//
// `?inv` creates a 1-use invite. In Code mode it also creates one code for that
// invite. The code is shown to the inviter, who sends it to the person they
// invited; that person enters it on the verification panel. Codes are bound to
// a single invite, expire with it (30 minutes), and are single-use.

export const INVITE_CODE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// 32 characters = exactly 5 bits per character. `byte & 31` therefore maps a
// uniformly random byte to a uniformly random character with no modulo bias.
// Visually ambiguous characters (0/O, 1/I) are omitted so the code can be read
// over voice or typed by hand without mistakes.
const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INVITE_CODE_LENGTH = 11; // XXXX-XXX-XXXX
const INVITE_CODE_HASH_PREFIX = "xsprut-invite-code-v1:";

/**
 * Generate a cryptographically random code in the form `XXXX-XXX-XXXX`.
 *
 * Uses `crypto.randomBytes` (the same CSPRNG family wallets use), not
 * `Math.random`. 11 characters from a 32-character alphabet = 55 bits of
 * entropy — far beyond brute-forcing through Discord interactions.
 */
export function generateInviteCode(): string {
  const bytes = randomBytes(INVITE_CODE_LENGTH);
  let raw = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    raw += INVITE_CODE_ALPHABET[bytes[i] & 31];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 7)}-${raw.slice(7)}`;
}

/**
 * Normalise user input to the canonical `XXXX-XXX-XXXX` form.
 *
 * Accepts lowercase, spaces, and missing/extra separators. Returns null when
 * the input cannot possibly be a code (wrong length or an excluded character).
 */
export function normalizeInviteCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== INVITE_CODE_LENGTH) return null;
  for (const ch of raw) {
    if (!INVITE_CODE_ALPHABET.includes(ch)) return null;
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 7)}-${raw.slice(7)}`;
}

function hashInviteCode(canonicalCode: string): string {
  return createHash("sha256")
    .update(INVITE_CODE_HASH_PREFIX + canonicalCode)
    .digest("hex");
}

export type InviteVerificationCode = {
  codeHash: string;
  guildId: string;
  channelId: string;
  inviterId: string;
  inviteCode: string;
  createdAt: number;
  expiresAt: number;
  usedBy: string | null;
  usedAt: number | null;
};

export type InviteCodeStatus = "correct" | "not_found" | "expired" | "used" | "wrong_guild";

export type InviteCodeValidation =
  | { status: "correct"; record: InviteVerificationCode }
  | { status: Exclude<InviteCodeStatus, "correct"> };

/** Remove rows whose invite has expired. Cheap; safe to call often. */
export function purgeExpiredInviteCodes(now: number = Date.now()): void {
  db.prepare(`DELETE FROM inviteVerificationCodes WHERE expiresAt < ?`).run(now);
}

/**
 * Create exactly one verification code for an invite.
 *
 * Throws if the invite already has a code (the DB also enforces this with a
 * UNIQUE constraint), so `1 invite = 1 code` cannot be violated by a race.
 * Returns the plaintext code — this is the only time it exists; only its hash
 * is stored.
 */
export function createInviteVerificationCode(input: {
  guildId: string;
  channelId: string;
  inviterId: string;
  inviteCode: string;
  now?: number;
}): { code: string; expiresAt: number } {
  const now = input.now ?? Date.now();
  purgeExpiredInviteCodes(now);

  const existing = db
    .prepare(`SELECT 1 FROM inviteVerificationCodes WHERE inviteCode = ?`)
    .get(input.inviteCode);
  if (existing) {
    throw new Error("This invite already has a verification code");
  }

  const expiresAt = now + INVITE_CODE_TTL_MS;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO inviteVerificationCodes
       (codeHash, guildId, channelId, inviterId, inviteCode, createdAt, expiresAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  // A hash collision is astronomically unlikely (2^-256), but retrying is
  // cheaper than making the caller handle a failed invite.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode();
    const result = insert.run(
      hashInviteCode(code),
      input.guildId,
      input.channelId,
      input.inviterId,
      input.inviteCode,
      now,
      expiresAt,
    );
    if (result.changes === 1) {
      return { code, expiresAt };
    }
  }

  throw new Error("Could not allocate a unique verification code");
}

/**
 * Check a submitted code without consuming it.
 *
 * The guild check prevents a code generated in server A from verifying someone
 * in server B. Expired codes are deleted on sight.
 *
 * NOTE: lookup is by `codeHash` only. `inviteCode` enforces "one code per
 * invite" at creation time, but redemption does not prove the member joined
 * through that invite; that would need guildMemberAdd + invite-use tracking.
 * Treat a code as a one-time bearer voucher.
 */
export function validateInviteCode(
  guildId: string,
  input: string,
  now: number = Date.now(),
): InviteCodeValidation {
  const canonical = normalizeInviteCode(input);
  if (!canonical) return { status: "not_found" };

  const record = db
    .prepare(`SELECT * FROM inviteVerificationCodes WHERE codeHash = ?`)
    .get(hashInviteCode(canonical)) as InviteVerificationCode | undefined;

  if (!record) return { status: "not_found" };
  if (record.guildId !== guildId) return { status: "wrong_guild" };
  if (record.usedBy) return { status: "used" };
  if (now > record.expiresAt) {
    try {
      db.prepare(`DELETE FROM inviteVerificationCodes WHERE codeHash = ?`).run(record.codeHash);
    } catch {
      // Expiry is still enforced by the return value even if cleanup fails.
    }
    return { status: "expired" };
  }

  return { status: "correct", record };
}

/**
 * Atomically consume a code for a user. Returns false when the code was
 * already used (or expired between validate and consume).
 */
export function consumeInviteCode(
  codeHash: string,
  userId: string,
  now: number = Date.now(),
): boolean {
  const result = db
    .prepare(
      `UPDATE inviteVerificationCodes
       SET usedBy = ?, usedAt = ?
       WHERE codeHash = ? AND usedBy IS NULL AND expiresAt >= ?`,
    )
    .run(userId, now, codeHash, now);
  return result.changes === 1;
}

/**
 * Undo a consume after a downstream failure (e.g. Discord rejected the role
 * grant), so the user is not locked out by a burned code.
 */
export function releaseInviteCode(codeHash: string, userId: string): void {
  db.prepare(
    `UPDATE inviteVerificationCodes
     SET usedBy = NULL, usedAt = NULL
     WHERE codeHash = ? AND usedBy = ?`,
  ).run(codeHash, userId);
}

/** Invalidate every outstanding code for a guild (disable / mode change). */
export function deleteInviteCodesForGuild(guildId: string): void {
  db.prepare(`DELETE FROM inviteVerificationCodes WHERE guildId = ?`).run(guildId);
}

// Expired rows are also purged on every create, but a timer keeps an idle
// database from retaining stale codes forever.
setInterval(() => {
  try {
    purgeExpiredInviteCodes();
  } catch {
    // DB may already be closed during shutdown/tests — nothing to do.
  }
}, 5 * 60_000).unref();

// ─── Database helpers ────────────────────────────────────────────────────────

export type VerificationMode = "captcha" | "code";

export type VerificationConfig = {
  guildId: string;
  channelId: string;
  verifiedRoleId: string;
  unverifiedRoleId: string | null;
  embedTitle: string;
  embedDescription: string;
  successMessage: string;
  imageUrl: string | null;
  verificationMode: VerificationMode;
  enabled: number;
  createdAt: number;
};

export function getVerificationConfig(guildId: string): VerificationConfig | null {
  const row = db
    .prepare(`SELECT * FROM verificationConfig WHERE guildId = ? AND enabled = 1`)
    .get(guildId) as VerificationConfig | undefined;
  if (!row) return null;
  // Rows written before Code mode existed (or by a future/unknown version)
  // must keep behaving as captcha panels, never as an invalid mode.
  return {
    ...row,
    verificationMode: row.verificationMode === "code" ? "code" : "captcha",
  };
}

export function saveVerificationConfig(cfg: Omit<VerificationConfig, "enabled">) {
  // Guard the stored value even if a future caller passes an unknown string.
  const verificationMode: VerificationMode = cfg.verificationMode === "code" ? "code" : "captcha";
  db.prepare(
    `INSERT INTO verificationConfig (guildId, channelId, verifiedRoleId, unverifiedRoleId, embedTitle, embedDescription, successMessage, imageUrl, verificationMode, enabled, createdAt)
     VALUES (@guildId, @channelId, @verifiedRoleId, @unverifiedRoleId, @embedTitle, @embedDescription, @successMessage, @imageUrl, @verificationMode, 1, @createdAt)
     ON CONFLICT(guildId) DO UPDATE SET
       channelId = excluded.channelId,
       verifiedRoleId = excluded.verifiedRoleId,
       unverifiedRoleId = excluded.unverifiedRoleId,
       embedTitle = excluded.embedTitle,
       embedDescription = excluded.embedDescription,
       successMessage = excluded.successMessage,
       imageUrl = excluded.imageUrl,
       verificationMode = excluded.verificationMode,
       enabled = 1,
       createdAt = excluded.createdAt`,
  ).run({ ...cfg, verificationMode });
}

export function disableVerificationConfig(guildId: string) {
  db.prepare(`UPDATE verificationConfig SET enabled = 0 WHERE guildId = ?`).run(guildId);
}
