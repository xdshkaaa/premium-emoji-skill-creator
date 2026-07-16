import type { Bot } from "grammy";
import { GrammyError } from "grammy";
import type { MyContext } from "../bot/context.js";
import type { Sticker } from "grammy/types";

export interface ResolvedSet {
  ok: true;
  setName: string;
  title: string;
  stickers: Sticker[];
}

export interface ResolvedSetError {
  ok: false;
  reason: "not_found" | "not_custom_emoji";
}

export async function resolveEmojiSet(
  bot: Bot<MyContext>,
  setName: string,
): Promise<ResolvedSet | ResolvedSetError> {
  try {
    const set = await bot.api.getStickerSet(setName);
    if (set.sticker_type !== "custom_emoji") {
      return { ok: false, reason: "not_custom_emoji" };
    }
    return { ok: true, setName: set.name, title: set.title, stickers: set.stickers };
  } catch (err) {
    if (err instanceof GrammyError) {
      return { ok: false, reason: "not_found" };
    }
    throw err;
  }
}

const CHUNK_SIZE = 200;

export async function resolveCustomEmojiStickers(
  bot: Bot<MyContext>,
  customEmojiIds: string[],
): Promise<Sticker[]> {
  const results: Sticker[] = [];
  for (let i = 0; i < customEmojiIds.length; i += CHUNK_SIZE) {
    const chunk = customEmojiIds.slice(i, i + CHUNK_SIZE);
    const stickers = await bot.api.getCustomEmojiStickers(chunk);
    results.push(...stickers);
  }
  return results;
}

export function stickerFormat(s: Sticker): "static" | "animated" | "video" {
  if (s.is_video) return "video";
  if (s.is_animated) return "animated";
  return "static";
}
