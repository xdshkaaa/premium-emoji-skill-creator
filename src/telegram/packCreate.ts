import type { Bot, InputFile } from "grammy";
import { GrammyError } from "grammy";
import type { MyContext } from "../bot/context.js";
import type { InputSticker } from "@grammyjs/types";

const MAX_SET_NAME_LEN = 64;
const MAX_TITLE_LEN = 64;
const SET_CAP = 200;
const THROTTLE_MS = 1100;
const API_TIMEOUT_MS = 25_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export function buildPackTitle(sourceTitle: string, hex: string, botUsername: string): string {
  const suffix = ` (via @${botUsername})`;
  const colorPart = ` • #${hex.replace(/^#/, "")}`;
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
  hex: string;
  items: RecolorItem[];
  onProgress?: (done: number, total: number) => Promise<void> | void;
  onUploadProgress?: (done: number, total: number) => Promise<void> | void;
  onSetCreated?: (setName: string) => void;
  checkCancel?: () => void;
}

function toInputSticker(fileId: string, item: RecolorItem): InputSticker<InputFile> {
  return { sticker: fileId, format: item.format, emoji_list: [item.emoji] };
}

export async function createRecoloredPack(
  bot: Bot<MyContext>,
  params: CreateRecoloredPackParams,
): Promise<{ setName: string; title: string }> {
  const me = await withTimeout(bot.api.getMe(), "getMe");
  const botUsername = me.username;
  const items = params.items.slice(0, SET_CAP);

  let setName = generateSetName(params.sourceSetName, params.hex, botUsername);
  const title = buildPackTitle(params.sourceTitle, params.hex, botUsername);

  const uploadedFileIds: string[] = [];
  for (const item of items) {
    params.checkCancel?.();
    const uploaded = await uploadWithRetry(bot, params.userId, item);
    uploadedFileIds.push(uploaded.file_id);
    await params.onUploadProgress?.(uploadedFileIds.length, items.length);
    await sleep(THROTTLE_MS);
  }

  const first = items[0];
  if (!first) throw new Error("No items to create pack from");

  let attempt = 0;
  let rateLimitRetries = 0;
  let timeoutRetries = 0;
  for (;;) {
    try {
      await withTimeout(
        bot.api.createNewStickerSet(
          params.userId,
          setName,
          title,
          [toInputSticker(uploadedFileIds[0]!, first)],
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
      if (err instanceof GrammyError && err.error_code === 429 && rateLimitRetries < 3) {
        rateLimitRetries++;
        const retryAfter = (err.parameters?.retry_after ?? 1) * 1000 + 500;
        await sleep(retryAfter);
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
        await withTimeout(
          bot.api.createNewStickerSet(
            params.userId,
            setName,
            title,
            [toInputSticker(uploadedFileIds[0]!, first)],
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
  await sleep(THROTTLE_MS);

  for (let i = 1; i < items.length; i++) {
    params.checkCancel?.();
    const item = items[i]!;
    await addWithRetry(bot, params.userId, setName, uploadedFileIds[i]!, item);
    await params.onProgress?.(i + 1, items.length);
    await sleep(THROTTLE_MS);
  }

  return { setName, title };
}

async function uploadWithRetry(
  bot: Bot<MyContext>,
  userId: number,
  item: RecolorItem,
): Promise<{ file_id: string }> {
  const RATE_LIMIT_RETRIES = 3;
  for (let timeoutRetries = 0, rateLimitRetries = 0; ; ) {
    try {
      return await withTimeout(
        bot.api.uploadStickerFile(userId, item.format, item.input),
        "uploadStickerFile",
      );
    } catch (err) {
      if (err instanceof ApiTimeoutError && timeoutRetries < 2) {
        timeoutRetries++;
        continue;
      }
      if (err instanceof GrammyError && err.error_code === 429 && rateLimitRetries < RATE_LIMIT_RETRIES) {
        rateLimitRetries++;
        const retryAfter = (err.parameters?.retry_after ?? 1) * 1000 + 500;
        await sleep(retryAfter);
        return await withTimeout(
          bot.api.uploadStickerFile(userId, item.format, item.input),
          "uploadStickerFile",
        );
      }
      throw err;
    }
  }
}

async function addWithRetry(
  bot: Bot<MyContext>,
  userId: number,
  setName: string,
  fileId: string,
  item: RecolorItem,
): Promise<void> {
  const RATE_LIMIT_RETRIES = 3;
  for (let timeoutRetries = 0, rateLimitRetries = 0; ; ) {
    try {
      await withTimeout(
        bot.api.addStickerToSet(userId, setName, toInputSticker(fileId, item)),
        "addStickerToSet",
      );
      return;
    } catch (err) {
      if (err instanceof ApiTimeoutError && timeoutRetries < 2) {
        timeoutRetries++;
        continue;
      }
      if (err instanceof GrammyError && err.error_code === 429 && rateLimitRetries < RATE_LIMIT_RETRIES) {
        rateLimitRetries++;
        const retryAfter = (err.parameters?.retry_after ?? 1) * 1000 + 500;
        await sleep(retryAfter);
        await withTimeout(
          bot.api.addStickerToSet(userId, setName, toInputSticker(fileId, item)),
          "addStickerToSet",
        );
        return;
      }
      throw err;
    }
  }
}
