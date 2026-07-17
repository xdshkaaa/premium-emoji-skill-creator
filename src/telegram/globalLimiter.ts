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
// own undocumented server-side token bucket: a burst of ~10 goes through,
// then even 1/s trips a 429 after ~17 writes (retry_after 118-290s). Observed
// safe sustained rate is ~2-3 writes/min, so we pace below it proactively:
// capacity 8, one token per 25s. penalizeStickerWrites() shrinks the refill
// rate if a real 429 still slips through.
const WRITE_BUCKET_CAPACITY = 8;
const MAX_REFILL_INTERVAL_MS = 60_000;
const PACE_POLL_MS = 5_000;

let refillIntervalMs = 25_000;
let writeTokens = WRITE_BUCKET_CAPACITY;
let lastRefillAt = Date.now();

function refillWriteTokens(): void {
  const now = Date.now();
  writeTokens = Math.min(
    WRITE_BUCKET_CAPACITY,
    writeTokens + (now - lastRefillAt) / refillIntervalMs,
  );
  lastRefillAt = now;
}

/**
 * Reserves one sticker-set write slot from the process-wide token bucket.
 * When the bucket is empty, waits for the next token in cancellable 5s chunks,
 * reporting seconds left via onPace.
 */
export async function reserveStickerWrite(
  checkCancel?: () => void,
  onPace?: (secondsLeft: number) => void,
): Promise<void> {
  for (;;) {
    checkCancel?.();
    refillWriteTokens();
    if (writeTokens >= 1) {
      writeTokens -= 1;
      return;
    }
    const leftMs = (1 - writeTokens) * refillIntervalMs;
    onPace?.(Math.ceil(leftMs / 1000));
    await sleep(Math.min(PACE_POLL_MS, leftMs));
  }
}

/** Backstop for a real 429: drain the bucket and slow the refill rate. */
export function penalizeStickerWrites(_retryAfterSec: number): void {
  refillWriteTokens();
  writeTokens = 0;
  refillIntervalMs = Math.min(refillIntervalMs * 1.5, MAX_REFILL_INTERVAL_MS);
}

/** Estimates how long `count` sticker-set writes will take at the current bucket state. */
export function estimateStickerWriteMs(count: number): number {
  refillWriteTokens();
  const paced = Math.max(0, count - Math.floor(writeTokens));
  return paced * refillIntervalMs;
}
