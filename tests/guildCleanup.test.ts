// NOTE: importing guildCleanup also loads lib/db (opens data.db) and the
// Discord client (no login). Every assertion below passes an explicit
// in-memory handle, so no test ever touches the production database.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  GUILD_TABLES,
  collectKickedGuilds,
  deleteGuildData,
} from "../src/lib/guildCleanup";

function seedDb(): Database.Database {
  const m = new Database(":memory:");
  for (const { table, guildColumn } of GUILD_TABLES) {
    m.exec(`CREATE TABLE ${table} (${guildColumn} TEXT)`);
  }
  return m;
}

describe("collectKickedGuilds", () => {
  it("returns guilds with data the bot is no longer in", () => {
    const m = seedDb();
    m.prepare("INSERT INTO alerts (guildId) VALUES ('a'), ('b'), ('c')").run();
    m.prepare("INSERT INTO protectedRooms (guildId) VALUES ('c')").run();

    assert.deepEqual(collectKickedGuilds(["a", "b"], m), ["c"]);
  });

  it("returns empty when the bot is still in every guild", () => {
    const m = seedDb();
    m.prepare("INSERT INTO alerts (guildId) VALUES ('a')").run();
    assert.deepEqual(collectKickedGuilds(["a"], m), []);
  });
});

describe("deleteGuildData", () => {
  it("wipes every per-guild table for the given guilds", () => {
    const m = seedDb();
    m.prepare("INSERT INTO alerts (guildId) VALUES ('gone'), ('stay')").run();
    m.prepare("INSERT INTO protectedRooms (guildId) VALUES ('gone')").run();

    const deleted = deleteGuildData(["gone"], m);

    assert.equal(deleted, 2);
    assert.equal(
      (m.prepare("SELECT COUNT(*) c FROM alerts").get() as { c: number }).c,
      1,
    );
    assert.equal(
      (m.prepare("SELECT COUNT(*) c FROM protectedRooms").get() as { c: number }).c,
      0,
    );
  });
});
