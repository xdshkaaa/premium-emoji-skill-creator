import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const FLOOD_POLL_MS = 5_000;
const MAX_FLOOD_WAIT_MS = 6 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sticker-set writes (createNewStickerSet/addStickerToSet) sit behind their
// own undocumented server-side token bucket. Prod lessons baked in
// (2026-07-17, retry_after values observed: 37s, 115s≈3×38, 226s≈6×38 — the
// server refills ~1 token/38-40s and retry_after is deficit × that interval):
// - the client refill interval must exceed the server's ~38s one; 25s and
//   even 37s spacing both re-tripped 429s, so the base is 40s — the tightest
//   margin that stays above the server refill, do not lower it;
// - the process starts with ONE token, not a full burst — a restart can't see
//   how drained the server-side bucket already is, and a full-burst start
//   right after a redeploy earned an instant 226s flood;
// - a real 429 means the server bucket is empty, so penalize() doubles the
//   refill interval and cuts capacity so no burst fires while it recovers.
const WRITE_BUCKET_CAPACITY = 5;
const PENALIZED_CAPACITY = 3;
const BASE_REFILL_INTERVAL_MS = 40_000;
const MAX_REFILL_INTERVAL_MS = 120_000;
// A 429 penalty is not forever: every clean 10 minutes halves the interval
// back toward base (one noon flood must not slow evening packs).
const PENALTY_DECAY_MS = 10 * 60_000;
const PACE_POLL_MS = 5_000;

/** Persists the bucket across restarts so a redeploy neither bursts into a
 * drained server quota nor forgets tokens accumulated while idle. */
export interface BucketStore {
  load(): string | undefined;
  save(serialized: string): void;
}

export class StickerWriteBucket {
  private capacity = WRITE_BUCKET_CAPACITY;
  private refillIntervalMs = BASE_REFILL_INTERVAL_MS;
  private tokens = 1;
  private lastRefillAt: number;
  private lastPenaltyAt: number;

  constructor(
    private readonly nowFn: () => number = Date.now,
    private readonly store?: BucketStore,
  ) {
    this.lastRefillAt = this.nowFn();
    this.lastPenaltyAt = this.lastRefillAt;
    const serialized = this.store?.load();
    if (!serialized) return;
    try {
      const s = JSON.parse(serialized) as Record<string, number>;
      if (
        typeof s.tokens === "number" &&
        typeof s.refillIntervalMs === "number" &&
        typeof s.lastRefillAt === "number"
      ) {
        this.tokens = Math.min(WRITE_BUCKET_CAPACITY, Math.max(0, s.tokens));
        this.refillIntervalMs = Math.min(
          MAX_REFILL_INTERVAL_MS,
          Math.max(BASE_REFILL_INTERVAL_MS, s.refillIntervalMs),
        );
        this.capacity = this.refillIntervalMs > BASE_REFILL_INTERVAL_MS
          ? PENALIZED_CAPACITY
          : WRITE_BUCKET_CAPACITY;
        this.lastRefillAt = Math.min(this.lastRefillAt, s.lastRefillAt);
        this.lastPenaltyAt = Math.min(this.lastPenaltyAt, s.lastPenaltyAt ?? this.lastRefillAt);
      }
    } catch {
      // corrupt state file — keep conservative defaults
    }
  }

  private persist(): void {
    this.store?.save(
      JSON.stringify({
        tokens: this.tokens,
        refillIntervalMs: this.refillIntervalMs,
        lastRefillAt: this.lastRefillAt,
        lastPenaltyAt: this.lastPenaltyAt,
      }),
    );
  }

  private refill(): void {
    const now = this.nowFn();
    while (
      this.refillIntervalMs > BASE_REFILL_INTERVAL_MS &&
      now - this.lastPenaltyAt >= PENALTY_DECAY_MS
    ) {
      this.refillIntervalMs = Math.max(BASE_REFILL_INTERVAL_MS, this.refillIntervalMs / 2);
      this.lastPenaltyAt += PENALTY_DECAY_MS;
      if (this.refillIntervalMs === BASE_REFILL_INTERVAL_MS) {
        this.capacity = WRITE_BUCKET_CAPACITY;
      }
    }
    this.tokens = Math.min(
      this.capacity,
      this.tokens + (now - this.lastRefillAt) / this.refillIntervalMs,
    );
    this.lastRefillAt = now;
  }

  /**
   * Reserves one write slot. When the bucket is empty, waits for the next
   * token in cancellable 5s chunks, reporting seconds left via onPace.
   */
  async reserve(
    checkCancel?: () => void,
    onPace?: (secondsLeft: number) => void,
  ): Promise<void> {
    for (;;) {
      checkCancel?.();
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        this.persist();
        return;
      }
      const leftMs = (1 - this.tokens) * this.refillIntervalMs;
      onPace?.(Math.ceil(leftMs / 1000));
      await sleep(Math.min(PACE_POLL_MS, leftMs));
    }
  }

  /** Backstop for a real 429: drain the bucket, slow refill, forbid bursts. */
  penalize(): void {
    this.refill();
    this.tokens = 0;
    this.capacity = Math.min(this.capacity, PENALIZED_CAPACITY);
    this.refillIntervalMs = Math.min(this.refillIntervalMs * 2, MAX_REFILL_INTERVAL_MS);
    this.lastPenaltyAt = this.nowFn();
    this.persist();
  }

  /** Estimates how long `count` writes will take at the current bucket state. */
  estimateMs(count: number): number {
    this.refill();
    const paced = Math.max(0, count - Math.floor(this.tokens));
    return paced * this.refillIntervalMs;
  }
}

function fileStore(path: string): BucketStore {
  return {
    load() {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    },
    save(serialized: string) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, serialized);
      } catch (err) {
        console.error("Failed to persist write-bucket state:", err);
      }
    },
  };
}

/**
 * Per-writer (per bot token) rate limiter: a proactive token bucket plus a
 * reactive flood gate. Telegram's sticker-set write quota is per bot token,
 * not per end-user (confirmed in prod 2026-07-17): one limiter instance
 * covers ALL users' jobs going through that bot.
 */
export class WriteLimiter {
  private floodUntil = 0;
  private readonly bucket: StickerWriteBucket;

  constructor(stateFilePath?: string) {
    this.bucket = new StickerWriteBucket(
      Date.now,
      stateFilePath ? fileStore(stateFilePath) : undefined,
    );
  }

  /** Raises this writer's flood gate: every job on this bot waits it out together. */
  raiseFlood(retryAfterSec: number): void {
    this.floodUntil = Math.max(this.floodUntil, Date.now() + retryAfterSec * 1000 + 1000);
    this.bucket.penalize();
  }

  async waitFlood(
    checkCancel?: () => void,
    onWait?: (secondsLeft: number) => void,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() < this.floodUntil) {
      if (Date.now() - start > MAX_FLOOD_WAIT_MS) {
        throw new Error(`Flood wait exceeded ${MAX_FLOOD_WAIT_MS / 1000}s budget`);
      }
      checkCancel?.();
      const leftMs = this.floodUntil - Date.now();
      onWait?.(Math.ceil(leftMs / 1000));
      await sleep(Math.min(FLOOD_POLL_MS, leftMs));
    }
    checkCancel?.();
  }

  /** Reserves one sticker-set write slot from this writer's token bucket. */
  reserve(checkCancel?: () => void, onPace?: (secondsLeft: number) => void): Promise<void> {
    return this.bucket.reserve(checkCancel, onPace);
  }

  /** Estimates how long `count` writes will take at the current bucket state. */
  estimateMs(count: number): number {
    return this.bucket.estimateMs(count);
  }
}
