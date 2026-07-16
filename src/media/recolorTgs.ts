import { gunzipSync, gzipSync } from "node:zlib";
import type { Hsl } from "./color.js";
import { tintPixel } from "./color.js";

export class TgsTooLargeError extends Error {
  constructor(size: number) {
    super(`Recolored .tgs exceeds 64KB limit (${size} bytes)`);
  }
}

const TGS_MAX_BYTES = 64 * 1024;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Tints one flat [r,g,b] or [r,g,b,a] component array in place, scale-aware (0..1 vs 0..255). */
function tintComponents(components: number[], hsl: Hsl): void {
  const scaled = components.some((v) => v > 1);
  const r = (components[0] ?? 0) * (scaled ? 1 : 255);
  const g = (components[1] ?? 0) * (scaled ? 1 : 255);
  const b = (components[2] ?? 0) * (scaled ? 1 : 255);
  const tinted = tintPixel(r, g, b, hsl);
  components[0] = scaled ? tinted.r : tinted.r / 255;
  components[1] = scaled ? tinted.g : tinted.g / 255;
  components[2] = scaled ? tinted.b : tinted.b / 255;
}

/** Tints a flat gradient stop array [offset,r,g,b, offset,r,g,b, ...] for the first `stopCount` stops. */
function tintGradientArray(arr: number[], stopCount: number, hsl: Hsl): void {
  for (let i = 0; i < stopCount; i++) {
    const base = i * 4;
    if (base + 3 >= arr.length) break;
    const rgb = [arr[base + 1] ?? 0, arr[base + 2] ?? 0, arr[base + 3] ?? 0];
    tintComponents(rgb, hsl);
    arr[base + 1] = rgb[0]!;
    arr[base + 2] = rgb[1]!;
    arr[base + 3] = rgb[2]!;
  }
}

function recolorSolidColorProp(c: JsonValue, hsl: Hsl): void {
  if (!isObject(c)) return;
  if (c["a"] === 0 && Array.isArray(c["k"])) {
    const components = c["k"] as number[];
    tintComponents(components, hsl);
    return;
  }
  if (c["a"] === 1 && Array.isArray(c["k"])) {
    for (const keyframe of c["k"] as JsonValue[]) {
      if (!isObject(keyframe)) continue;
      if (Array.isArray(keyframe["s"])) tintComponents(keyframe["s"] as number[], hsl);
      if (Array.isArray(keyframe["e"])) tintComponents(keyframe["e"] as number[], hsl);
    }
  }
}

function recolorGradientProp(g: JsonValue, hsl: Hsl): void {
  if (!isObject(g)) return;
  const stopCountRaw = g["p"];
  const stopCount = typeof stopCountRaw === "number" ? stopCountRaw : 0;
  const k = g["k"];
  if (!isObject(k)) return;
  if (k["a"] === 0 && Array.isArray(k["k"])) {
    tintGradientArray(k["k"] as number[], stopCount, hsl);
    return;
  }
  if (k["a"] === 1 && Array.isArray(k["k"])) {
    for (const keyframe of k["k"] as JsonValue[]) {
      if (!isObject(keyframe)) continue;
      if (Array.isArray(keyframe["s"])) tintGradientArray(keyframe["s"] as number[], stopCount, hsl);
      if (Array.isArray(keyframe["e"])) tintGradientArray(keyframe["e"] as number[], stopCount, hsl);
    }
  }
}

function walk(node: JsonValue, hsl: Hsl): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, hsl);
    return;
  }
  if (!isObject(node)) return;

  const ty = node["ty"];
  if ((ty === "fl" || ty === "st") && node["c"] !== undefined) {
    recolorSolidColorProp(node["c"], hsl);
  }
  if ((ty === "gf" || ty === "gs") && node["g"] !== undefined) {
    recolorGradientProp(node["g"], hsl);
  }

  for (const value of Object.values(node)) {
    if (value !== undefined) walk(value, hsl);
  }
}

export function recolorLottieJson(anim: JsonObject, hsl: Hsl): JsonObject {
  const clone = JSON.parse(JSON.stringify(anim)) as JsonObject;
  walk(clone, hsl);
  return clone;
}

export async function recolorTgs(buf: Buffer, hsl: Hsl): Promise<Buffer> {
  const json = JSON.parse(gunzipSync(buf).toString("utf8")) as JsonObject;
  const recolored = recolorLottieJson(json, hsl);
  const out = gzipSync(Buffer.from(JSON.stringify(recolored)), { level: 9 });
  if (out.byteLength > TGS_MAX_BYTES) {
    throw new TgsTooLargeError(out.byteLength);
  }
  return out;
}
