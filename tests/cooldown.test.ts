import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkCooldown,
  formatCooldown,
  getCooldownRemainingMs,
  setCooldown,
} from "../src/lib/cooldown";

describe("cooldown", () => {
  it("starts a cooldown on the first check and blocks the second", () => {
    const key = "cooldown-test:first";
    assert.equal(checkCooldown(key, 60_000), 0);
    const remaining = checkCooldown(key, 60_000);
    assert.ok(remaining > 0);
    assert.ok(remaining <= 60_000);
  });

  it("reports remaining ms and zero once expired", async () => {
    const key = "cooldown-test:remaining";
    setCooldown(key, 20);
    assert.ok(getCooldownRemainingMs(key) > 0);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(getCooldownRemainingMs(key), 0);
  });

  it("ignores a non-positive duration", () => {
    const key = "cooldown-test:zero";
    setCooldown(key, 0);
    assert.equal(getCooldownRemainingMs(key), 0);
    assert.equal(checkCooldown(key, 0), 0);
    assert.equal(checkCooldown(key, 0), 0);
  });

  it("formats remaining time as whole seconds", () => {
    assert.equal(formatCooldown(1), "1s");
    assert.equal(formatCooldown(999), "1s");
    assert.equal(formatCooldown(1_000), "1s");
    assert.equal(formatCooldown(1_500), "2s");
  });
});
