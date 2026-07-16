import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeHex, hexToRgb, rgbToHsl, hslToRgb, tintPixel, tintRgbaInPlace } from "./color.js";

test("normalizeHex accepts with/without # and lowercases", () => {
  assert.equal(normalizeHex("#FF00aa"), "#ff00aa");
  assert.equal(normalizeHex("ff00aa"), "#ff00aa");
});

test("normalizeHex rejects invalid input", () => {
  assert.equal(normalizeHex("not-a-color"), null);
  assert.equal(normalizeHex("#fff"), null);
});

test("rgbToHsl/hslToRgb round-trip", () => {
  const rgb = { r: 200, g: 50, b: 90 };
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const back = hslToRgb(hsl);
  assert.ok(Math.abs(back.r - rgb.r) <= 1);
  assert.ok(Math.abs(back.g - rgb.g) <= 1);
  assert.ok(Math.abs(back.b - rgb.b) <= 1);
});

test("tintPixel keeps black black and white white", () => {
  const target = { h: 200, s: 0.8, l: 0.5 };
  const black = tintPixel(0, 0, 0, target);
  assert.deepEqual(black, { r: 0, g: 0, b: 0 });
  const white = tintPixel(255, 255, 255, target);
  assert.deepEqual(white, { r: 255, g: 255, b: 255 });
});

test("tintPixel preserves lightness of source pixel", () => {
  const target = { h: 10, s: 0.9, l: 0.5 };
  const src = { r: 100, g: 150, b: 120 };
  const srcHsl = rgbToHsl(src.r, src.g, src.b);
  const tinted = tintPixel(src.r, src.g, src.b, target);
  const tintedHsl = rgbToHsl(tinted.r, tinted.g, tinted.b);
  assert.ok(Math.abs(tintedHsl.l - srcHsl.l) < 0.02);
});

test("tintRgbaInPlace leaves alpha channel untouched", () => {
  const data = new Uint8Array([10, 20, 30, 128, 200, 210, 220, 55]);
  tintRgbaInPlace(data, { h: 300, s: 0.6, l: 0.5 }, 4);
  assert.equal(data[3], 128);
  assert.equal(data[7], 55);
});

test("hexToRgb throws on invalid hex", () => {
  assert.throws(() => hexToRgb("zzzzzz"));
});
