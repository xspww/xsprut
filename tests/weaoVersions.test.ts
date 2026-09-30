import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getWEAORobloxVersion,
  setWeaoRbxversionSnapshot,
} from "../src/lib/weaoVersions";

describe("WEAO Tier-1 snapshot (getWEAORobloxVersion)", () => {
  it("returns null before any snapshot is published", () => {
    setWeaoRbxversionSnapshot([]);
    assert.equal(getWEAORobloxVersion(), null);
  });

  it("returns the majority hash", () => {
    setWeaoRbxversionSnapshot(["version-aaa", "version-bbb", "version-aaa"]);
    assert.equal(getWEAORobloxVersion(), "version-aaa");
  });

  it("ignores nulls and non-hash values", () => {
    setWeaoRbxversionSnapshot([
      "version-aaa",
      null,
      undefined,
      "stale-without-prefix",
      "version-bbb",
      "version-bbb",
    ]);
    assert.equal(getWEAORobloxVersion(), "version-bbb");
  });

  it("returns null when nothing hash-like was published", () => {
    setWeaoRbxversionSnapshot([null, undefined, "garbage"]);
    assert.equal(getWEAORobloxVersion(), null);
  });
});
