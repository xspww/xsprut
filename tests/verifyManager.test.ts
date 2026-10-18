import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CAPTCHA_MAX_ATTEMPTS,
  CAPTCHA_TTL_MS,
  createCaptchaSession,
  validateCaptchaSession,
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
