const FLOOD_POLL_MS = 5_000;
const MAX_FLOOD_WAIT_MS = 6 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface UserLimiterState {
  floodUntil: number;
  nextSlotAt: number;
}

const perUser = new Map<number, UserLimiterState>();

function stateFor(userId: number): UserLimiterState {
  let s = perUser.get(userId);
  if (!s) {
    s = { floodUntil: 0, nextSlotAt: 0 };
    perUser.set(userId, s);
  }
  return s;
}

/**
 * Raises the flood gate for one Telegram user. Sticker-set write methods
 * (createNewStickerSet/addStickerToSet) are rate-limited per user_id, not
 * per bot process — sharing one gate across all users needlessly serialized
 * unrelated jobs, so this is scoped per user instead.
 */
export function raiseGlobalFlood(userId: number, retryAfterSec: number): void {
  const s = stateFor(userId);
  s.floodUntil = Math.max(s.floodUntil, Date.now() + retryAfterSec * 1000 + 1000);
}

export async function waitGlobalFlood(
  userId: number,
  checkCancel?: () => void,
  onWait?: (secondsLeft: number) => void,
): Promise<void> {
  const s = stateFor(userId);
  const start = Date.now();
  while (Date.now() < s.floodUntil) {
    if (Date.now() - start > MAX_FLOOD_WAIT_MS) {
      throw new Error(`Flood wait exceeded ${MAX_FLOOD_WAIT_MS / 1000}s budget`);
    }
    checkCancel?.();
    const leftMs = s.floodUntil - Date.now();
    onWait?.(Math.ceil(leftMs / 1000));
    await sleep(Math.min(FLOOD_POLL_MS, leftMs));
  }
  checkCancel?.();
}

/** Reserves the next call slot for one user: staggers concurrent in-flight adds for that user's job. */
export async function reserveGlobalSlot(userId: number, spacingMs: number): Promise<void> {
  const s = stateFor(userId);
  const at = Math.max(Date.now(), s.nextSlotAt);
  s.nextSlotAt = at + spacingMs;
  const wait = at - Date.now();
  if (wait > 0) await sleep(wait);
}
