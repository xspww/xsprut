import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CAPTCHA_MAX_ATTEMPTS,
  CAPTCHA_TTL_MS,
  INVITE_CODE_TTL_MS,
  createCaptchaSession,
  validateCaptchaSession,
  generateInviteCode,
  normalizeInviteCode,
  createInviteVerificationCode,
  validateInviteCode,
  consumeInviteCode,
  releaseInviteCode,
  deleteInviteCodesForGuild,
  saveVerificationConfig,
  getVerificationConfig,
} from "../src/lib/verifyManager";

describe("captcha sessions", () => {
  it("creates a 4-digit numeric code", () => {
    const code = createCaptchaSession("user-format");
    assert.match(code, /^\d{4}$/);
  });

  it("accepts the correct code and consumes the session", () => {
    const code = createCaptchaSession("user-correct");
    assert.equal(validateCaptchaSession("user-correct", code), "correct");
    // Session is one-shot.
    assert.equal(validateCaptchaSession("user-correct", code), "not_found");
  });

  it("accepts surrounding whitespace in the input", () => {
    const code = createCaptchaSession("user-trim");
    assert.equal(validateCaptchaSession("user-trim", `  ${code}  `), "correct");
  });

  it("reports not_found for an unknown user", () => {
    assert.equal(validateCaptchaSession("user-nobody", "1234"), "not_found");
  });

  it("counts wrong attempts and locks the session", () => {
    const code = createCaptchaSession("user-brute");
    const wrong = code === "0000" ? "1111" : "0000";

    for (let i = 1; i < CAPTCHA_MAX_ATTEMPTS; i++) {
      assert.equal(validateCaptchaSession("user-brute", wrong), "wrong");
    }
    // The final allowed wrong guess locks (and destroys) the session.
    assert.equal(validateCaptchaSession("user-brute", wrong), "locked");
    assert.equal(validateCaptchaSession("user-brute", code), "not_found");
  });

  it("expires after the ttl using an injected clock", () => {
    const code = createCaptchaSession("user-expired");
    const future = Date.now() + CAPTCHA_TTL_MS + 1;
    assert.equal(validateCaptchaSession("user-expired", code, future), "expired");
  });

  it("rejects an expired session even with the right code", () => {
    const code = createCaptchaSession("user-expired-2");
    const stillValid = Date.now() + CAPTCHA_TTL_MS - 1_000;
    assert.equal(validateCaptchaSession("user-expired-2", code, stillValid), "correct");
  });
});

describe("invite verification codes", () => {
  it("generates XXXX-XXX-XXXX codes from the unambiguous alphabet", () => {
    assert.match(generateInviteCode(), /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("generates distinct codes", () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateInviteCode()));
    assert.equal(codes.size, 100);
  });

  it("normalises lowercase / separator-free input", () => {
    assert.equal(normalizeInviteCode("abcd efg hjkm"), "ABCD-EFG-HJKM");
    assert.equal(normalizeInviteCode("ABCDEFGHJKM"), "ABCD-EFG-HJKM");
    assert.equal(normalizeInviteCode("  abcd-efg-hjkm  "), "ABCD-EFG-HJKM");
  });

  it("rejects malformed input and excluded characters", () => {
    assert.equal(normalizeInviteCode("ABCD-EFG-HJK"), null); // too short
    assert.equal(normalizeInviteCode("ABCD-EFG-HJK0"), null); // 0 is not in the alphabet
    assert.equal(normalizeInviteCode("ABCD-EFG-HJKI"), null); // I is not in the alphabet
  });

  it("binds each invite to exactly one code", () => {
    createInviteVerificationCode({
      guildId: "g-one-code",
      channelId: "c1",
      inviterId: "i1",
      inviteCode: "invite-one-code",
    });

    assert.throws(
      () =>
        createInviteVerificationCode({
          guildId: "g-one-code",
          channelId: "c1",
          inviterId: "i1",
          inviteCode: "invite-one-code",
        }),
      /already has a verification code/,
    );
  });

  it("accepts a valid code and marks it used exactly once", () => {
    const { code } = createInviteVerificationCode({
      guildId: "g-consume",
      channelId: "c1",
      inviterId: "i1",
      inviteCode: "invite-consume",
    });

    const validation = validateInviteCode("g-consume", code);
    if (validation.status !== "correct") {
      assert.fail(`expected correct, got ${validation.status}`);
    }

    assert.equal(consumeInviteCode(validation.record.codeHash, "user-1"), true);
    assert.equal(consumeInviteCode(validation.record.codeHash, "user-2"), false);
    assert.equal(validateInviteCode("g-consume", code).status, "used");
  });

  it("rejects a code from another guild", () => {
    const { code } = createInviteVerificationCode({
      guildId: "g-owner",
      channelId: "c1",
      inviterId: "i1",
      inviteCode: "invite-wrong-guild",
    });

    assert.equal(validateInviteCode("g-other", code).status, "wrong_guild");
  });

  it("expires after 30 minutes using an injected clock", () => {
    const createdAt = 1_000_000;
    const { code, expiresAt } = createInviteVerificationCode({
      guildId: "g-expiry",
      channelId: "c1",
      inviterId: "i1",
      inviteCode: "invite-expiry",
      now: createdAt,
    });

    assert.equal(expiresAt, createdAt + INVITE_CODE_TTL_MS);
    assert.equal(validateInviteCode("g-expiry", code, expiresAt).status, "correct");
    assert.equal(validateInviteCode("g-expiry", code, expiresAt + 1).status, "expired");
  });

  it("rejects unknown codes", () => {
    assert.equal(validateInviteCode("g-unknown", "ABCD-EFG-HJKM").status, "not_found");
  });

  it("releases a consumed code when role assignment fails", () => {
    const { code } = createInviteVerificationCode({
      guildId: "g-release",
      channelId: "c1",
      inviterId: "i1",
      inviteCode: "invite-release",
    });

    const validation = validateInviteCode("g-release", code);
    if (validation.status !== "correct") {
      assert.fail(`expected correct, got ${validation.status}`);
    }

    assert.equal(consumeInviteCode(validation.record.codeHash, "user-1"), true);
    releaseInviteCode(validation.record.codeHash, "user-1");
    assert.equal(validateInviteCode("g-release", code).status, "correct");
    assert.equal(consumeInviteCode(validation.record.codeHash, "user-2"), true);
  });

  it("invalidates every code for a guild on request", () => {
    const { code } = createInviteVerificationCode({
      guildId: "g-delete",
      channelId: "c1",
      inviterId: "i1",
      inviteCode: "invite-delete",
    });

    deleteInviteCodesForGuild("g-delete");
    assert.equal(validateInviteCode("g-delete", code).status, "not_found");
  });
});

describe("verification config", () => {
  it("stores and reads the selected mode", () => {
    saveVerificationConfig({
      guildId: "g-mode",
      channelId: "c1",
      verifiedRoleId: "r1",
      unverifiedRoleId: null,
      embedTitle: "Verify",
      embedDescription: "Code mode",
      successMessage: "Welcome to {server}",
      imageUrl: null,
      verificationMode: "code",
      createdAt: 1,
    });

    assert.equal(getVerificationConfig("g-mode")?.verificationMode, "code");
  });
});
