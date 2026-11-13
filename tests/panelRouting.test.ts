import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { protectButtonAction } from "../src/lib/panel";

/**
 * The protected-room buttons are routed by customId prefix. Two of them
 * overlap — "panel:protect:disable:" is a prefix of
 * "panel:protect:disable:confirm:" — so the routing has to check the more
 * specific one first.
 */
describe("protectButtonAction", () => {
  it("routes the banner editor to its modal", () => {
    assert.deepEqual(protectButtonAction("panel:protect:edit:123"), {
      kind: "edit",
      channelId: "123",
    });
  });

  it("routes the action switch", () => {
    assert.deepEqual(protectButtonAction("panel:protect:action:123"), {
      kind: "switch-action",
      channelId: "123",
    });
  });

  it("routes the timeout editor", () => {
    assert.deepEqual(protectButtonAction("panel:protect:timeout:123"), {
      kind: "timeout",
      channelId: "123",
    });
  });

  it("routes the re-post", () => {
    assert.deepEqual(protectButtonAction("panel:protect:repost:123"), {
      kind: "repost",
      channelId: "123",
    });
  });

  it("routes the disable button to the confirmation card", () => {
    assert.deepEqual(protectButtonAction("panel:protect:disable:123"), {
      kind: "disable",
      channelId: "123",
    });
  });

  it("routes the CONFIRM button to the actual disable, not back to the card", () => {
    // The regression this guards: "panel:protect:disable:confirm:123" also
    // starts with "panel:protect:disable:", so checking the shorter prefix
    // first made the confirm button re-show the card and never turn the
    // room off.
    assert.deepEqual(protectButtonAction("panel:protect:disable:confirm:123"), {
      kind: "disable-confirm",
      channelId: "123",
    });
  });

  it("ignores buttons of other panels", () => {
    assert.equal(protectButtonAction("panel:verify"), null);
    assert.equal(protectButtonAction("panel:refresh:protect:123"), null);
    assert.equal(protectButtonAction("verify_start"), null);
  });
});
