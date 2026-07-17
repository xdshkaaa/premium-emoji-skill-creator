export interface Hsl {
  h: number; // 0..360
  s: number; // 0..1
  l: number; // 0..1
}

export type TintSpec = { kind: "solid"; hsl: Hsl } | { kind: "gradient"; stops: Hsl[] };

export function normalizeHex(input: string): string | null {
  const trimmed = input.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(trimmed)) return null;
  return `#${trimmed.toLowerCase()}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHex(hex);
  if (!normalized) throw new Error(`Invalid hex color: ${hex}`);
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return { r, g, b };
}

export function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case rn:
      h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
      break;
    case gn:
      h = ((bn - rn) / d + 2) * 60;
      break;
    default:
      h = ((rn - gn) / d + 4) * 60;
  }
  return { h, s, l };
}

function hueToRgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

export function hslToRgb(hsl: Hsl): { r: number; g: number; b: number } {
  const { s, l } = hsl;
  const h = hsl.h / 360;

  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hueToRgb(p, q, h + 1 / 3);
  const g = hueToRgb(p, q, h);
  const b = hueToRgb(p, q, h - 1 / 3);
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

/** Tints one pixel: keeps original lightness, replaces hue+saturation with the target's. */
export function tintPixel(
  r: number,
  g: number,
  b: number,
  target: Hsl,
): { r: number; g: number; b: number } {
  const { l } = rgbToHsl(r, g, b);
  return hslToRgb({ h: target.h, s: target.s, l });
}

/** In-place tint of an RGBA(or RGB) buffer. `channels` is 3 or 4; alpha (if present) is untouched. */
export function tintRgbaInPlace(data: Uint8Array | Buffer, targetHsl: Hsl, channels: 3 | 4 = 4): void {
  for (let i = 0; i + channels <= data.length; i += channels) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const tinted = tintPixel(r, g, b, targetHsl);
    data[i] = tinted.r;
    data[i + 1] = tinted.g;
    data[i + 2] = tinted.b;
  }
}

export function hexToHsl(hex: string): Hsl {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsl(r, g, b);
}

/** Target hue/sat at position t (0..1) along the stop spectrum. Lerps in RGB
 *  space between adjacent stops so hue never wraps the long way around. */
export function gradientHslAt(stops: Hsl[], t: number): Hsl {
  if (stops.length === 0) throw new Error("gradientHslAt: no stops");
  if (stops.length === 1) return stops[0]!;
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (stops.length - 1);
  const i = Math.min(Math.floor(scaled), stops.length - 2);
  const f = scaled - i;
  const a = hslToRgb(stops[i]!);
  const b = hslToRgb(stops[i + 1]!);
  return rgbToHsl(
    a.r + (b.r - a.r) * f,
    a.g + (b.g - a.g) * f,
    a.b + (b.b - a.b) * f,
  );
}

/** In-place vertical-gradient tint of an RGBA buffer: target hue/sat comes from
 *  the row's position in the spectrum, pixel lightness is preserved. */
export function tintRgbaGradientInPlace(
  data: Uint8Array | Buffer,
  stops: Hsl[],
  width: number,
  height: number,
  channels: 3 | 4 = 4,
): void {
  for (let y = 0; y < height; y++) {
    const target = gradientHslAt(stops, height > 1 ? y / (height - 1) : 0.5);
    const rowStart = y * width * channels;
    for (let x = 0; x < width; x++) {
      const i = rowStart + x * channels;
      if (i + channels > data.length) return;
      const tinted = tintPixel(data[i]!, data[i + 1]!, data[i + 2]!, target);
      data[i] = tinted.r;
      data[i + 1] = tinted.g;
      data[i + 2] = tinted.b;
    }
  }
}
