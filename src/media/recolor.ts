import type { EmojiFormat } from "../db/repo.js";
import type { TintSpec } from "./color.js";
import { gradientHslAt } from "./color.js";
import { recolorStaticSticker } from "./recolorStatic.js";
import { recolorTgs } from "./recolorTgs.js";
import { recolorWebmSticker } from "./recolorWebm.js";
import { ffmpegAvailable } from "./ffmpeg.js";

export class MediaError extends Error {
  constructor(public code: "ffmpeg_missing" | "too_large" | "decode_failed", message: string) {
    super(message);
  }
}

export async function recolorSticker(buf: Buffer, format: EmojiFormat, spec: TintSpec): Promise<Buffer> {
  if (format === "static") return recolorStaticSticker(buf, spec);
  if (format === "animated") return recolorTgs(buf, spec);

  // video: per-frame gradients are too costly, tint with the mid-spectrum color
  if (!ffmpegAvailable()) {
    throw new MediaError("ffmpeg_missing", "ffmpeg not available; skipping video emoji");
  }
  const hsl = spec.kind === "solid" ? spec.hsl : gradientHslAt(spec.stops, 0.5);
  return recolorWebmSticker(buf, hsl);
}
