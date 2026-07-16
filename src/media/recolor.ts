import type { EmojiFormat } from "../db/repo.js";
import type { Hsl } from "./color.js";
import { recolorStaticSticker } from "./recolorStatic.js";
import { recolorTgs } from "./recolorTgs.js";
import { recolorWebmSticker } from "./recolorWebm.js";
import { ffmpegAvailable } from "./ffmpeg.js";

export class MediaError extends Error {
  constructor(public code: "ffmpeg_missing" | "too_large" | "decode_failed", message: string) {
    super(message);
  }
}

export async function recolorSticker(buf: Buffer, format: EmojiFormat, hsl: Hsl): Promise<Buffer> {
  if (format === "static") return recolorStaticSticker(buf, hsl);
  if (format === "animated") return recolorTgs(buf, hsl);

  // video
  if (!ffmpegAvailable()) {
    throw new MediaError("ffmpeg_missing", "ffmpeg not available; skipping video emoji");
  }
  return recolorWebmSticker(buf, hsl);
}
