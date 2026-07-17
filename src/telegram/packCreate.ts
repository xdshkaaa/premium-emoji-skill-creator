import type { InputFile } from "grammy";
import { GrammyError, HttpError } from "grammy";
import type { InputSticker } from "@grammyjs/types";
import type { PackWriter } from "./writerPool.js";

const MAX_SET_NAME_LEN = 64;
const MAX_TITLE_LEN = 64;
const SET_CAP = 200;
// Sticker-set writes are paced by the chosen writer's token bucket
// (WriteLimiter): reactive pacing — even batches of 5 per minute — kept
// tripping Telegram's write quota with 118-290s flood waits, so every
// create/add reserves a token first and 429s are only a backstop that also
// shrinks the bucket's refill rate.
const API_TIMEOUT_MS = 25_000;

interface FloodGate {
  checkCancel?: () => void;
  onFloodWait?: (secondsLeft: number) => void;
  onPace?: (secondsLeft: number) => void;
}

// Transient network failures (VPS DNS blips, EAI_AGAIN) killed whole jobs in
// prod — wait out the blip instead of failing the item.
const NET_RETRY_DELAY_MS = 15_000;
const NET_RETRIES = 3;

async function waitOutNetworkBlip(gate: FloodGate, label: string, attempt: number): Promise<void> {
  console.warn(`[net] ${label} network error, retry ${attempt}/${NET_RETRIES} in ${NET_RETRY_DELAY_MS / 1000}s`);
  gate.checkCancel?.();
  await new Promise((resolve) => setTimeout(resolve, NET_RETRY_DELAY_MS));
  gate.checkCancel?.();
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
  /** Fires while proactively waiting for a write token (normal pacing, not a 429). */
  onPace?: (secondsLeft: number) => void;
  /** Username shown in the human-readable pack title (the master bot's brand). */
  titleUsername: string;
}

function toInputSticker(item: RecolorItem): InputSticker<InputFile> {
  return { sticker: item.input, format: item.format, emoji_list: [item.emoji] };
}

export async function createRecoloredPack(
  writer: PackWriter,
  params: CreateRecoloredPackParams,
): Promise<{ setName: string; title: string; skipped: number }> {
  // Set names MUST end with _by_<creating bot>; the title keeps the master
  // bot's brand regardless of which worker does the writes.
  const botUsername = writer.username;
  const items = params.items.slice(0, SET_CAP);
  const gate: FloodGate = {
    checkCancel: params.checkCancel,
    onFloodWait: params.onFloodWait,
    onPace: params.onPace,
  };

  let setName = generateSetName(params.sourceSetName, params.hex, botUsername);
  const title = buildPackTitle(params.sourceTitle, params.hex, params.titleUsername, params.colorLabel);

  let skipped = 0;
  const first = items[0];
  if (!first) throw new Error("No items to create pack from");

  let attempt = 0;
  let rateLimitRetries = 0;
  let timeoutRetries = 0;
  let netRetries = 0;
  for (;;) {
    try {
      await writer.limiter.waitFlood(gate.checkCancel, gate.onFloodWait);
      await writer.limiter.reserve(gate.checkCancel, gate.onPace);
      await withTimeout(
        writer.api.createNewStickerSet(
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
      if (err instanceof HttpError && netRetries < NET_RETRIES) {
        netRetries++;
        await waitOutNetworkBlip(gate, "createNewStickerSet", netRetries);
        continue;
      }
      if (err instanceof GrammyError && err.error_code === 429 && rateLimitRetries < 4) {
        rateLimitRetries++;
        const retryAfter = err.parameters?.retry_after ?? 5;
        console.warn(`[create] @${botUsername} rate limited, flood gate up for ${retryAfter}s`);
        writer.limiter.raiseFlood(retryAfter);
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
        await writer.limiter.reserve(gate.checkCancel, gate.onPace);
        await withTimeout(
          writer.api.createNewStickerSet(
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

  // Sequential adds: the write bucket sets the pace anyway, and dispatch
  // order = final emoji order (concurrent adds shuffled it).
  let addedCount = 1;
  for (const item of items.slice(1)) {
    params.checkCancel?.();
    try {
      await addWithRetry(writer, params.userId, setName, item, gate);
      addedCount++;
    } catch (err) {
      skipped++;
      console.error(`addStickerToSet failed for ${item.emoji}:`, err);
    }
    await params.onProgress?.(addedCount, items.length);
  }

  return { setName, title, skipped };
}

async function addWithRetry(
  writer: PackWriter,
  userId: number,
  setName: string,
  item: RecolorItem,
  gate: FloodGate,
): Promise<void> {
  const FLOOD_WAITS = 4;
  for (let timeoutRetries = 0, floodWaits = 0, netRetries = 0; ; ) {
    try {
      await writer.limiter.waitFlood(gate.checkCancel, gate.onFloodWait);
      await writer.limiter.reserve(gate.checkCancel, gate.onPace);
      await withTimeout(
        writer.api.addStickerToSet(userId, setName, toInputSticker(item)),
        "addStickerToSet",
      );
      return;
    } catch (err) {
      if (err instanceof ApiTimeoutError && timeoutRetries < 2) {
        timeoutRetries++;
        console.warn(`[add] ${item.emoji} timed out, retry ${timeoutRetries}/2`);
        continue;
      }
      if (err instanceof HttpError && netRetries < NET_RETRIES) {
        netRetries++;
        await waitOutNetworkBlip(gate, `addStickerToSet ${item.emoji}`, netRetries);
        continue;
      }
      if (err instanceof GrammyError && err.error_code === 429 && floodWaits < FLOOD_WAITS) {
        floodWaits++;
        const retryAfter = err.parameters?.retry_after ?? 5;
        console.warn(`[add] @${writer.username} ${item.emoji} rate limited, flood gate up for ${retryAfter}s (wait ${floodWaits}/${FLOOD_WAITS})`);
        writer.limiter.raiseFlood(retryAfter);
        continue;
      }
      throw err;
    }
  }
}
