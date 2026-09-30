import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatIntervalMs, parseIntervalToMs } from "../src/lib/constants";

describe("parseIntervalToMs", () => {
  it("parses unit durations", () => {
    assert.equal(parseIntervalToMs("30s"), 30_000);
    assert.equal(parseIntervalToMs("1m"), 60_000);
    assert.equal(parseIntervalToMs("5m"), 300_000);
    assert.equal(parseIntervalToMs("1h"), 3_600_000);
    assert.equal(parseIntervalToMs("1m30s"), 90_000);
  });

  it("treats a plain integer as seconds", () => {
    assert.equal(parseIntervalToMs("60"), 60_000);
  });

  it("rejects empty, zero and malformed input", () => {
    assert.equal(parseIntervalToMs(null), null);
    assert.equal(parseIntervalToMs(""), null);
    assert.equal(parseIntervalToMs("0"), null);
    assert.equal(parseIntervalToMs("abc"), null);
    assert.equal(parseIntervalToMs("1m foo"), null);
  });
});

describe("formatIntervalMs", () => {
  it("renders compact labels", () => {
    assert.equal(formatIntervalMs(30_000), "30s");
    assert.equal(formatIntervalMs(60_000), "1m");
    assert.equal(formatIntervalMs(90_000), "1m30s");
    assert.equal(formatIntervalMs(3_600_000), "1h");
  });
});
