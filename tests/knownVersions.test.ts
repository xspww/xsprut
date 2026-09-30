import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { pruneKnownVersions } from "../src/lib/knownVersions";
import {
  KNOWN_VERSIONS_MAX_PER_CHANNEL,
  KNOWN_VERSIONS_RETENTION_MS,
} from "../src/lib/constants";

function seedDb(): Database.Database {
  const m = new Database(":memory:");
  m.exec(`CREATE TABLE knownVersions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL,
    robloxChannel TEXT NOT NULL,
    released BOOLEAN NOT NULL DEFAULT 0,
    detectedAt INTEGER NOT NULL,
    UNIQUE(hash, robloxChannel)
  )`);
  return m;
}

describe("pruneKnownVersions", () => {
  it("deletes rows older than the retention window", () => {
    const m = seedDb();
    const now = Date.now();
    const ins = m.prepare(
      "INSERT INTO knownVersions (hash, robloxChannel, detectedAt) VALUES (?, ?, ?)",
    );
    ins.run("old", "LIVE", now - KNOWN_VERSIONS_RETENTION_MS - 1000);
    ins.run("fresh", "LIVE", now);

    const { deleted } = pruneKnownVersions(m, now);

    assert.equal(deleted, 1);
    assert.equal(
      (m.prepare("SELECT COUNT(*) c FROM knownVersions").get() as { c: number }).c,
      1,
    );
    assert.ok(m.prepare("SELECT 1 FROM knownVersions WHERE hash = 'fresh'").get());
  });

  it("caps each channel at the newest N rows", () => {
    const m = seedDb();
    const now = Date.now();
    const ins = m.prepare(
      "INSERT INTO knownVersions (hash, robloxChannel, detectedAt) VALUES (?, ?, ?)",
    );
    const seed = m.transaction(() => {
      for (let i = 0; i < KNOWN_VERSIONS_MAX_PER_CHANNEL + 100; i++) {
        ins.run(`zb-${i}`, "ZBeta", now - (KNOWN_VERSIONS_MAX_PER_CHANNEL + 100 - i));
      }
    });
    seed();

    const { deleted } = pruneKnownVersions(m, now);

    assert.equal(deleted, 100);
    const { c } = m
      .prepare("SELECT COUNT(*) c FROM knownVersions WHERE robloxChannel = 'ZBeta'")
      .get() as { c: number };
    assert.equal(c, KNOWN_VERSIONS_MAX_PER_CHANNEL);
    // Newest survives, oldest of the batch is gone.
    assert.ok(m.prepare("SELECT 1 FROM knownVersions WHERE hash = 'zb-599'").get());
    assert.equal(
      m.prepare("SELECT 1 FROM knownVersions WHERE hash = 'zb-0'").get(),
      undefined,
    );
  });

  it("prunes per channel independently", () => {
    const m = seedDb();
    const now = Date.now();
    const ins = m.prepare(
      "INSERT INTO knownVersions (hash, robloxChannel, detectedAt) VALUES (?, ?, ?)",
    );
    ins.run("old-live", "LIVE", now - KNOWN_VERSIONS_RETENTION_MS - 1);
    ins.run("new-live", "LIVE", now);
    ins.run("new-zb", "ZBeta", now);

    const { deleted } = pruneKnownVersions(m, now);

    assert.equal(deleted, 1);
    assert.ok(m.prepare("SELECT 1 FROM knownVersions WHERE hash = 'new-live'").get());
    assert.ok(m.prepare("SELECT 1 FROM knownVersions WHERE hash = 'new-zb'").get());
  });

  it("is a no-op on an empty table", () => {
    const m = seedDb();
    assert.deepEqual(pruneKnownVersions(m), { deleted: 0 });
  });
});
