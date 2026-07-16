import sharp from "sharp";
import type { Hsl } from "./color.js";
import { tintRgbaInPlace } from "./color.js";

export async function recolorStaticSticker(buf: Buffer, hsl: Hsl): Promise<Buffer> {
  const image = sharp(buf).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  tintRgbaInPlace(data, hsl, 4);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .webp()
    .toBuffer();
}
