interface PendingHex {
  kind: "hex";
  token: string;
  expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const pending = new Map<number, PendingHex>();

export function setPending(userId: number, token: string): void {
  pending.set(userId, { kind: "hex", token, expiresAt: Date.now() + TTL_MS });
}

export function takePendingHex(userId: number): string | null {
  const entry = pending.get(userId);
  if (!entry) return null;
  pending.delete(userId);
  if (entry.expiresAt < Date.now()) return null;
  return entry.token;
}

export function clearPending(userId: number): void {
  pending.delete(userId);
}
