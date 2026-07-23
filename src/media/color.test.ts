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

test("tintPixel keeps black black, maps white to the target color itself", () => {
  const target = { h: 200, s: 0.8, l: 0.5 };
  const black = tintPixel(0, 0, 0, target);
  assert.deepEqual(black, { r: 0, g: 0, b: 0 });
  const white = tintPixel(255, 255, 255, target);
  const expected = hslToRgb(target);
  assert.ok(Math.abs(white.r - expected.r) <= 1);
  assert.ok(Math.abs(white.g - expected.g) <= 1);
  assert.ok(Math.abs(white.b - expected.b) <= 1);
});

test("tintPixel nearly preserves lightness of dark pixels", () => {
  const target = { h: 10, s: 0.9, l: 0.5 };
  const src = { r: 40, g: 50, b: 45 }; // l ≈ 0.18
  const srcHsl = rgbToHsl(src.r, src.g, src.b);
  const tinted = tintPixel(src.r, src.g, src.b, target);
  const tintedHsl = rgbToHsl(tinted.r, tinted.g, tinted.b);
  assert.ok(Math.abs(tintedHsl.l - srcHsl.l) < 0.04);
});

test("tintPixel lightness mapping is monotone", () => {
  const target = { h: 340, s: 0.8, l: 0.45 };
  let prev = -1;
  for (let v = 0; v <= 255; v += 5) {
    const { l } = rgbToHsl(...Object.values(tintPixel(v, v, v, target)) as [number, number, number]);
    assert.ok(l >= prev - 0.01, `non-monotone at v=${v}`);
    prev = l;
  }
});

test("tintPixel with black target maps everything to black", () => {
  const target = { h: 0, s: 0, l: 0 };
  assert.deepEqual(tintPixel(255, 255, 255, target), { r: 0, g: 0, b: 0 });
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
