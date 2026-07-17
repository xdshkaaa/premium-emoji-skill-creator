const FLOOD_POLL_MS = 5_000;
const MAX_FLOOD_WAIT_MS = 6 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let floodUntil = 0;
let nextSlotAt = 0;

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

/** Reserves the next process-wide call slot: paces starts across ALL concurrent jobs/users. */
export async function reserveGlobalSlot(spacingMs: number): Promise<void> {
  const at = Math.max(Date.now(), nextSlotAt);
  nextSlotAt = at + spacingMs;
  const wait = at - Date.now();
  if (wait > 0) await sleep(wait);
}
