import { randomBytes } from "node:crypto";
import type { Sticker } from "grammy/types";

export interface StagedPack {
  userId: number;
  setName: string | null;
  packTitle: string;
  stickers: Sticker[];
}

export interface StagedColorChoice extends StagedPack {
  hex: string;
  mode: "manual" | "ai";
}

const TTL_MS = 30 * 60 * 1000;
const CAP = 200;

interface Entry<T> {
  value: T;
  expiresAt: number;
}

function makeStore<T>() {
  const store = new Map<string, Entry<T>>();

  function prune(): void {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt < now) store.delete(key);
    }
    while (store.size > CAP) {
      const oldestKey = store.keys().next().value;
      if (oldestKey === undefined) break;
      store.delete(oldestKey);
    }
  }

  function stage(value: T): string {
    prune();
    const token = randomBytes(4).toString("hex");
    store.set(token, { value, expiresAt: Date.now() + TTL_MS });
    return token;
  }

  function get(token: string): T | undefined {
    const entry = store.get(token);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      store.delete(token);
      return undefined;
    }
    return entry.value;
  }

  return { stage, get };
}

const packStore = makeStore<StagedPack>();
const choiceStore = makeStore<StagedColorChoice>();

export function stagePack(pack: StagedPack): string {
  return packStore.stage(pack);
}

export function getStagedPack(token: string): StagedPack | undefined {
  return packStore.get(token);
}

export function stageColorChoice(choice: StagedColorChoice): string {
  return choiceStore.stage(choice);
}

export function getStagedColorChoice(token: string): StagedColorChoice | undefined {
  return choiceStore.get(token);
}
