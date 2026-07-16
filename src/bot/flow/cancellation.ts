const cancelled = new Set<number>();
const active = new Set<number>();

export function startRun(userId: number): void {
  active.add(userId);
  cancelled.delete(userId);
}

export function endRun(userId: number): void {
  active.delete(userId);
  cancelled.delete(userId);
}

export function isRunning(userId: number): boolean {
  return active.has(userId);
}

export function requestCancel(userId: number): void {
  cancelled.add(userId);
}

export function isCancelled(userId: number): boolean {
  return cancelled.has(userId);
}

export class CancelledError extends Error {
  constructor() {
    super("CANCELLED");
  }
}

export function throwIfCancelled(userId: number): void {
  if (isCancelled(userId)) throw new CancelledError();
}
