interface PendingHex {
  kind: "hex";
  token: string;
  expiresAt: number;
}

interface PendingRecolor {
  kind: "recolor";
  expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const pending = new Map<number, PendingHex | PendingRecolor>();

export function setPending(userId: number, token: string): void {
  pending.set(userId, { kind: "hex", token, expiresAt: Date.now() + TTL_MS });
}

export function takePendingHex(userId: number): string | null {
  const entry = pending.get(userId);
  if (!entry || entry.kind !== "hex") return null;
  pending.delete(userId);
  if (entry.expiresAt < Date.now()) return null;
  return entry.token;
}

/** Marks that the next pack link from this user should go straight to the color menu. */
export function setPendingRecolor(userId: number): void {
  pending.set(userId, { kind: "recolor", expiresAt: Date.now() + TTL_MS });
}

export function takePendingRecolor(userId: number): boolean {
  const entry = pending.get(userId);
  if (!entry || entry.kind !== "recolor") return false;
  pending.delete(userId);
  return entry.expiresAt >= Date.now();
}

export function clearPending(userId: number): void {
  pending.delete(userId);
}
