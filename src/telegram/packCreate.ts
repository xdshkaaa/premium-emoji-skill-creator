import type { Bot, InputFile } from "grammy";
import { GrammyError } from "grammy";
import type { MyContext } from "../bot/context.js";
import type { InputSticker } from "@grammyjs/types";
import { mapLimit } from "../utils/concurrency.js";
import { raiseGlobalFlood, waitGlobalFlood, reserveGlobalSlot } from "./globalLimiter.js";

const MAX_SET_NAME_LEN = 64;
const MAX_TITLE_LEN = 64;
const SET_CAP = 200;
// Telegram's real per-user sticker-set write bucket is stricter than 1/s once
// a pack runs long: 1100ms still triggers ~260-290s flood waits every few
// dozen items. Back off harder to stay under the bucket for the whole pack.
const ADD_THROTTLE_MS = 3000;
const ADD_CONCURRENCY = 1;
const API_TIMEOUT_MS = 25_000;

interface FloodGate {
  checkCancel?: () => void;
  onFloodWait?: (secondsLeft: number) => void;
}

function raiseFloodGate(_gate: FloodGate, retryAfterSec: number): void {
  raiseGlobalFlood(retryAfterSec);
}

async function waitFloodGate(gate: FloodGate): Promise<void> {
  await waitGlobalFlood(gate.checkCancel, gate.onFloodWait);
}

class ApiTimeoutError extends Error {
  constructor(label: string) {
    super(`Telegram API call timed out: ${label}`);
    this.name = "ApiTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, label: string, ms = API_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ApiTimeoutError(label)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function slugifyBase(source: string): string {
  let s = source.toLowerCase();
  s = s.replace(/_by_[a-z0-9_]*$/, "");
  s = s.replace(/[^a-z0-9_]/g, "_");
  s = s.replace(/_+/g, "_");
  s = s.replace(/^_+|_+$/g, "");
  if (!s || !/^[a-z]/.test(s)) s = `p${s}`;
  return s;
}

export function generateSetName(
  source: string,
  hex: string,
  botUsername: string,
  attempt = 0,
): string {
  const hexPart = hex.replace(/^#/, "");
  const suffix = `_by_${botUsername}`;
  const attemptPart = attempt > 0 ? `_${attempt + 1}` : "";
  const base = slugifyBase(source);
  const budget = MAX_SET_NAME_LEN - suffix.length - hexPart.length - 1 - attemptPart.length;
  const trimmedBase = base.slice(0, Math.max(1, budget));
  let name = `${trimmedBase}_${hexPart}${attemptPart}${suffix}`;
  if (name.length > MAX_SET_NAME_LEN) {
    name = name.slice(0, MAX_SET_NAME_LEN);
  }
  return name;
}

export function buildPackTitle(
  sourceTitle: string,
  hex: string,
  botUsername: string,
  colorLabel?: string,
): string {
  const suffix = ` (via @${botUsername})`;
  const colorPart = colorLabel ? ` • ${colorLabel}` : ` • #${hex.replace(/^#/, "")}`;
  const budget = MAX_TITLE_LEN - suffix.length - colorPart.length;
  const trimmedTitle = sourceTitle.slice(0, Math.max(1, budget));
  return `${trimmedTitle}${colorPart}${suffix}`.slice(0, MAX_TITLE_LEN);
}

export interface RecolorItem {
  input: InputFile;
  emoji: string;
  format: "static" | "animated" | "video";
}

export interface CreateRecoloredPackParams {
  userId: number;
  sourceSetName: string;
  sourceTitle: string;
  /** Slug-safe color tag for the set name: bare hex for solid, preset id for gradients. */
  hex: string;
  /** Human label for the pack title (e.g. "🌅 Закат"); falls back to #hex. */
  colorLabel?: string;
  items: RecolorItem[];
  onProgress?: (done: number, total: number) => Promise<void> | void;
  onSetCreated?: (setName: string) => void;
  checkCancel?: () => void;
  onFloodWait?: (secondsLeft: number) => void;
}

function toInputSticker(item: RecolorItem): InputSticker<InputFile> {
  return { sticker: item.input, format: item.format, emoji_list: [item.emoji] };
}

export async function createRecoloredPack(
  bot: Bot<MyContext>,
  params: CreateRecoloredPackParams,
): Promise<{ setName: string; title: string; skipped: number }> {
  const me = await withTimeout(bot.api.getMe(), "getMe");
  const botUsername = me.username;
  const items = params.items.slice(0, SET_CAP);
  const gate: FloodGate = {
    checkCancel: params.checkCancel,
    onFloodWait: params.onFloodWait,
  };

  let setName = generateSetName(params.sourceSetName, params.hex, botUsername);
  const title = buildPackTitle(params.sourceTitle, params.hex, botUsername, params.colorLabel);

  let skipped = 0;
  const first = items[0];
  if (!first) throw new Error("No items to create pack from");

  let attempt = 0;
  let rateLimitRetries = 0;
  let timeoutRetries = 0;
  for (;;) {
    try {
      await waitFloodGate(gate);
      await reserveGlobalSlot(ADD_THROTTLE_MS);
      await withTimeout(
        bot.api.createNewStickerSet(
          params.userId,
          setName,
          title,
          [toInputSticker(first)],
          { sticker_type: "custom_emoji" },
        ),
        "createNewStickerSet",
      );
      break;
    } catch (err) {
      if (err instanceof ApiTimeoutError && timeoutRetries < 2) {
        timeoutRetries++;
        continue;
      }
      if (err instanceof GrammyError && err.error_code === 429 && rateLimitRetries < 4) {
        rateLimitRetries++;
        const retryAfter = err.parameters?.retry_after ?? 5;
        console.warn(`[create] rate limited, flood gate up for ${retryAfter}s`);
        raiseFloodGate(gate, retryAfter);
        continue;
      }
      const occupied = err instanceof GrammyError && /occupied|already/i.test(err.description);
      if (occupied && attempt < 5) {
        attempt++;
        setName = generateSetName(params.sourceSetName, params.hex, botUsername, attempt);
        continue;
      }
      if (occupied) {
        setName = generateSetName(
          `${params.sourceSetName}_${Math.random().toString(36).slice(2, 7)}`,
          params.hex,
          botUsername,
        );
        await reserveGlobalSlot(ADD_THROTTLE_MS);
        await withTimeout(
          bot.api.createNewStickerSet(
            params.userId,
            setName,
            title,
            [toInputSticker(first)],
            { sticker_type: "custom_emoji" },
          ),
          "createNewStickerSet",
        );
        break;
      }
      throw err;
    }
  }
  params.onSetCreated?.(setName);
  await params.onProgress?.(1, items.length);

  // Adds append to one set: keep ADD_CONCURRENCY = 1 to preserve emoji order.
  let addedCount = 1;
  await mapLimit(items.slice(1), ADD_CONCURRENCY, async (item) => {
    params.checkCancel?.();
    try {
      await addWithRetry(bot, params.userId, setName, item, gate);
      addedCount++;
    } catch (err) {
      skipped++;
      console.error(`addStickerToSet failed for ${item.emoji}:`, err);
    }
    await params.onProgress?.(addedCount, items.length);
  });

  return { setName, title, skipped };
}

async function addWithRetry(
  bot: Bot<MyContext>,
  userId: number,
  setName: string,
  item: RecolorItem,
  gate: FloodGate,
): Promise<void> {
  const FLOOD_WAITS = 4;
  for (let timeoutRetries = 0, floodWaits = 0; ; ) {
    try {
      await waitFloodGate(gate);
      await reserveGlobalSlot(ADD_THROTTLE_MS);
      await withTimeout(
        bot.api.addStickerToSet(userId, setName, toInputSticker(item)),
        "addStickerToSet",
      );
      return;
    } catch (err) {
      if (err instanceof ApiTimeoutError && timeoutRetries < 2) {
        timeoutRetries++;
        console.warn(`[add] ${item.emoji} timed out, retry ${timeoutRetries}/2`);
        continue;
      }
      if (err instanceof GrammyError && err.error_code === 429 && floodWaits < FLOOD_WAITS) {
        floodWaits++;
        const retryAfter = err.parameters?.retry_after ?? 5;
        console.warn(`[add] ${item.emoji} rate limited, flood gate up for ${retryAfter}s (wait ${floodWaits}/${FLOOD_WAITS})`);
        raiseFloodGate(gate, retryAfter);
        continue;
      }
      throw err;
    }
  }
}
