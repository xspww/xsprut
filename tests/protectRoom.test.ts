import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import {
  PROTECT_ACTION_META,
  buildProtectRoomNoticeComponents,
} from "../src/lib/protectRoom";

function json(components: ReturnType<typeof buildProtectRoomNoticeComponents>) {
  return JSON.stringify(components.map((c) => c.toJSON()));
}

describe("PROTECT_ACTION_META", () => {
  it("maps each action to its counter label and required permission", () => {
    assert.equal(PROTECT_ACTION_META.ban.countLabel, "Bans");
    assert.equal(PROTECT_ACTION_META.ban.permission, PermissionFlagsBits.BanMembers);
    assert.equal(PROTECT_ACTION_META.timeout.countLabel, "Timeouts");
    assert.equal(PROTECT_ACTION_META.timeout.permission, PermissionFlagsBits.ModerateMembers);
  });

  it("describes the consequence for each action", () => {
    assert.match(PROTECT_ACTION_META.ban.description, /permanent ban/i);
    assert.match(PROTECT_ACTION_META.timeout.description, /timeout/i);
  });
});

describe("buildProtectRoomNoticeComponents", () => {
  it("renders the warning header and the counter pill (no banner)", () => {
    const out = json(buildProtectRoomNoticeComponents("ban", 7, null));
    assert.match(out, /DO NOT SEND MESSAGES IN THIS CHANNEL/);
    assert.match(out, /Bans: 7/);
  });

  it("uses the action-specific label for timeouts", () => {
    const out = json(buildProtectRoomNoticeComponents("timeout", 3, null));
    assert.match(out, /Timeouts: 3/);
  });

  it("renders a banner gallery when an https image url is given", () => {
    const url = "https://example.com/banner.png";
    const out = json(buildProtectRoomNoticeComponents("ban", 0, url));
    assert.match(out, /example\.com\/banner\.png/);
  });
});
