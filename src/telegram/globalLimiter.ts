const FLOOD_POLL_MS = 5_000;
const MAX_FLOOD_WAIT_MS = 6 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Telegram's sticker-set write quota (createNewStickerSet/addStickerToSet)
// is per bot token, not per end-user: a 429 for one user's job was observed
// blocking every other user's job at the same time. Confirmed in prod
// 2026-07-17 — do not re-split this per user again without new evidence.
let floodUntil = 0;

/** Raises the process-wide flood gate: every caller (any user, any job) waits it out together. */
export function raiseGlobalFlood(retryAfterSec: number): void {
  floodUntil = Math.max(floodUntil, Date.now() + retryAfterSec * 1000 + 1000);
}

export async function waitGlobalFlood(
  checkCancel?: () => void,
  onWait?: (secondsLeft: number) => void,
): Promise<void> {
  const start = Date.now();
  while (Date.now() < floodUntil) {
    if (Date.now() - start > MAX_FLOOD_WAIT_MS) {
      throw new Error(`Flood wait exceeded ${MAX_FLOOD_WAIT_MS / 1000}s budget`);
    }
    checkCancel?.();
    const leftMs = floodUntil - Date.now();
    onWait?.(Math.ceil(leftMs / 1000));
    await sleep(Math.min(FLOOD_POLL_MS, leftMs));
  }
  checkCancel?.();
}

// Sticker-set writes (createNewStickerSet/addStickerToSet) sit behind their
// own undocumented server-side token bucket. Prod lessons baked in
// (2026-07-17, retry_after values observed: 37s, 115s≈3×38, 226s≈6×38 — the
// server refills ~1 token/38-40s and retry_after is deficit × that interval):
// - the client refill interval must exceed the server's ~40s one; 25s and
//   even 37s spacing both re-tripped 429s, so the base is 45s;
// - the process starts with ONE token, not a full burst — a restart can't see
//   how drained the server-side bucket already is, and a full-burst start
//   right after a redeploy earned an instant 226s flood;
// - a real 429 means the server bucket is empty, so penalize() doubles the
//   refill interval and cuts capacity so no burst fires while it recovers.
const WRITE_BUCKET_CAPACITY = 5;
const PENALIZED_CAPACITY = 3;
const MAX_REFILL_INTERVAL_MS = 120_000;
const PACE_POLL_MS = 5_000;

export class StickerWriteBucket {
  private capacity = WRITE_BUCKET_CAPACITY;
  private refillIntervalMs = 45_000;
  private tokens = 1;
  private lastRefillAt: number;

  constructor(private readonly nowFn: () => number = Date.now) {
    this.lastRefillAt = this.nowFn();
  }

  private refill(): void {
    const now = this.nowFn();
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
  }

  /** Estimates how long `count` writes will take at the current bucket state. */
  estimateMs(count: number): number {
    this.refill();
    const paced = Math.max(0, count - Math.floor(this.tokens));
    return paced * this.refillIntervalMs;
  }
}

const writeBucket = new StickerWriteBucket();

/** Reserves one sticker-set write slot from the process-wide token bucket. */
export async function reserveStickerWrite(
  checkCancel?: () => void,
  onPace?: (secondsLeft: number) => void,
): Promise<void> {
  return writeBucket.reserve(checkCancel, onPace);
}

/** Backstop for a real 429: drain the bucket and slow the refill rate. */
export function penalizeStickerWrites(_retryAfterSec: number): void {
  writeBucket.penalize();
}

/** Estimates how long `count` sticker-set writes will take at the current bucket state. */
export function estimateStickerWriteMs(count: number): number {
  return writeBucket.estimateMs(count);
}
