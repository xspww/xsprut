import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ConfirmationTracker } from "../src/monitoring/confirmation";

describe("ConfirmationTracker", () => {
  it("confirms only after the required consecutive sightings", () => {
    const tracker = new ConfirmationTracker(2);
    assert.equal(tracker.confirm("LIVE", "hash-a"), false);
    assert.equal(tracker.count("LIVE"), 1);
    assert.equal(tracker.confirm("LIVE", "hash-a"), true);
    assert.equal(tracker.count("LIVE"), 0);
  });

  it("requires three ticks when configured with 3", () => {
    const tracker = new ConfirmationTracker(3);
    assert.equal(tracker.confirm("LIVE", "a"), false);
    assert.equal(tracker.confirm("LIVE", "a"), false);
    assert.equal(tracker.confirm("LIVE", "a"), true);
  });

  it("never confirms A-B-A-B jitter", () => {
    const tracker = new ConfirmationTracker(2);
    assert.equal(tracker.confirm("LIVE", "a"), false);
    assert.equal(tracker.confirm("LIVE", "b"), false);
    assert.equal(tracker.confirm("LIVE", "a"), false);
    assert.equal(tracker.confirm("LIVE", "b"), false);
  });

  it("tracks each key independently", () => {
    const tracker = new ConfirmationTracker(2);
    tracker.confirm("LIVE", "a");
    tracker.confirm("ZBeta", "b");
    assert.equal(tracker.confirm("LIVE", "a"), true);
    assert.equal(tracker.confirm("ZBeta", "b"), true);
  });

  it("confirms immediately when required is 1", () => {
    const tracker = new ConfirmationTracker(1);
    assert.equal(tracker.confirm("LIVE", "a"), true);
    assert.equal(tracker.count("LIVE"), 0);
  });

  it("clear and reset drop pending sightings", () => {
    const tracker = new ConfirmationTracker(2);
    tracker.confirm("LIVE", "a");
    tracker.clear("LIVE");
    assert.equal(tracker.count("LIVE"), 0);
    assert.equal(tracker.confirm("LIVE", "a"), false);

    tracker.confirm("ZBeta", "b");
    tracker.reset();
    assert.equal(tracker.count("ZBeta"), 0);
  });

  it("rejects an invalid required count", () => {
    assert.throws(() => new ConfirmationTracker(0));
    assert.throws(() => new ConfirmationTracker(1.5));
  });
});
