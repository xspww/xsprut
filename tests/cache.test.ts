import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TTLCache } from "../src/lib/cache";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("TTLCache", () => {
  it("stores and returns values within the ttl", () => {
    const cache = new TTLCache<number, string>(1_000, 0);
    cache.set(1, "a");
    assert.equal(cache.get(1), "a");
    assert.equal(cache.has(1), true);
    assert.equal(cache.size, 1);
  });

  it("expires entries once their ttl passes", async () => {
    const cache = new TTLCache<number, string>(20, 0);
    cache.set(1, "a");
    await sleep(40);
    assert.equal(cache.get(1), undefined);
  });

  it("honours a per-entry ttl override", async () => {
    const cache = new TTLCache<number, string>(10_000, 0);
    cache.set(1, "a", 20);
    cache.set(2, "b", 10_000);
    await sleep(40);
    assert.equal(cache.get(1), undefined);
    assert.equal(cache.get(2), "b");
  });

  it("treats a non-positive ttl as a no-op set", () => {
    const cache = new TTLCache<number, string>(1_000, 0);
    cache.set(1, "a", 0);
    cache.set(2, "b", -5);
    assert.equal(cache.get(1), undefined);
    assert.equal(cache.get(2), undefined);
  });

  it("supports delete, clear and size", () => {
    const cache = new TTLCache<number, string>(1_000, 0);
    cache.set(1, "a");
    cache.set(2, "b");
    assert.equal(cache.delete(1), true);
    assert.equal(cache.delete(1), false);
    assert.equal(cache.size, 1);
    cache.clear();
    assert.equal(cache.size, 0);
  });

  it("sweep drops only expired entries", async () => {
    const cache = new TTLCache<number, string>(20, 0);
    cache.set(1, "a");
    cache.set(2, "b", 10_000);
    await sleep(40);
    cache.sweep();
    assert.equal(cache.size, 1);
    assert.equal(cache.get(2), "b");
  });
});
