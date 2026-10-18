/**
 * Consecutive-sighting confirmation for the update monitor.
 *
 * Roblox's channel endpoints (and the WEAO fallback) can flap: the same tick
 * may report A, then B, then A again while an edge or a stale cache settles.
 * Trusting a single observation produces false "revert" alerts — the exact bug
 * that spammed 13 alerts in ~40 minutes on 2026-09-10.
 *
 * Rule: a new hash must be observed on `required` consecutive ticks before it
 * is trusted. Any different hash in between resets the counter, so A-B-A-B
 * never confirms.
 *
 * Kept pure (no DB, no logging, no timers) so the logic is unit-testable in
 * isolation — see tests/confirmation.test.ts.
 */
export class ConfirmationTracker {
  private readonly required: number;
  private readonly pending = new Map<string, { hash: string; count: number }>();

  constructor(required: number) {
    if (!Number.isInteger(required) || required < 1) {
      throw new Error("ConfirmationTracker requires an integer >= 1");
    }
    this.required = required;
  }

  /**
   * Record one sighting of `hash` for `key`.
   * Returns true only once `required` consecutive sightings have been seen
   * (the counter is then cleared), false otherwise.
   */
  confirm(key: string, hash: string): boolean {
    if (this.required === 1) {
      this.pending.delete(key);
      return true;
    }

    const pending = this.pending.get(key);
    if (!pending || pending.hash !== hash) {
      this.pending.set(key, { hash, count: 1 });
      return false;
    }
    if (pending.count + 1 < this.required) {
      pending.count += 1;
      return false;
    }
    this.pending.delete(key);
    return true;
  }

  /** How many consecutive sightings `key` currently has (0 = none). */
  count(key: string): number {
    return this.pending.get(key)?.count ?? 0;
  }

  /** Drop the pending sighting for `key` (used when the channel is stable). */
  clear(key: string): void {
    this.pending.delete(key);
  }

  /** Drop every pending sighting. */
  reset(): void {
    this.pending.clear();
  }
}
