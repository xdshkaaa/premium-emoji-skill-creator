import sharp from "sharp";
import type { TintSpec } from "./color.js";
import { tintRgbaInPlace, tintRgbaGradientInPlace } from "./color.js";

export async function recolorStaticSticker(buf: Buffer, spec: TintSpec): Promise<Buffer> {
  const image = sharp(buf).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  if (spec.kind === "solid") {
    tintRgbaInPlace(data, spec.hsl, 4);
  } else {
    tintRgbaGradientInPlace(data, spec.stops, info.width, info.height, 4);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .webp()
    .toBuffer();
}
