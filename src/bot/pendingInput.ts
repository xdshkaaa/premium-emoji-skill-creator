interface PendingHex {
  kind: "hex";
  token: string;
  expiresAt: number;
}

interface PendingRecolor {
  kind: "recolor";
  expiresAt: number;
}

interface PendingCollect {
  kind: "collect";
  ids: string[];
  chatId: number;
  statusMsgId: number | null;
  expiresAt: number;
}

/** Matches SET_CAP in packCreate: Telegram caps custom-emoji sets at 200. */
export const COLLECT_CAP = 200;

const TTL_MS = 10 * 60 * 1000;
const pending = new Map<number, PendingHex | PendingRecolor | PendingCollect>();

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

export interface CollectAddResult {
  total: number;
  added: number;
  capped: boolean;
  prevStatusMsgId: number | null;
}

/** Starts or extends a per-user emoji collection; refreshes TTL on every add. */
export function addToCollect(userId: number, chatId: number, newIds: string[]): CollectAddResult {
  const entry = pending.get(userId);
  const current =
    entry && entry.kind === "collect" && entry.expiresAt >= Date.now()
      ? entry
      : { kind: "collect" as const, ids: [], chatId, statusMsgId: null, expiresAt: 0 };
  const existing = new Set(current.ids);
  let added = 0;
  let capped = false;
  for (const id of newIds) {
    if (existing.has(id)) continue;
    if (current.ids.length >= COLLECT_CAP) {
      capped = true;
      break;
    }
    existing.add(id);
    current.ids.push(id);
    added++;
  }
  current.chatId = chatId;
  current.expiresAt = Date.now() + TTL_MS;
  pending.set(userId, current);
  return { total: current.ids.length, added, capped, prevStatusMsgId: current.statusMsgId };
}

export function setCollectStatusMsg(userId: number, msgId: number): void {
  const entry = pending.get(userId);
  if (entry && entry.kind === "collect") entry.statusMsgId = msgId;
}

export function takeCollect(userId: number): string[] | null {
  const entry = pending.get(userId);
  if (!entry || entry.kind !== "collect") return null;
  pending.delete(userId);
  if (entry.expiresAt < Date.now() || entry.ids.length === 0) return null;
  return entry.ids;
}

export function clearCollect(userId: number): void {
  const entry = pending.get(userId);
  if (entry && entry.kind === "collect") pending.delete(userId);
}

export function clearPending(userId: number): void {
  pending.delete(userId);
}
