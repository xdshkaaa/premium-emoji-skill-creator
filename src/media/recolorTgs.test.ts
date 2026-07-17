import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import { recolorLottieJson, recolorTgs } from "./recolorTgs.js";
import { gradientHslAt } from "./color.js";

const hsl = { kind: "solid" as const, hsl: { h: 0, s: 1, l: 0.5 } }; // target red

test("recolors static solid fill (0..1 scale)", () => {
  const anim = {
    layers: [
      {
        shapes: [{ ty: "fl", c: { a: 0, k: [0, 0, 1, 1] } }],
      },
    ],
  };
  const out = recolorLottieJson(anim as any, hsl);
  const shape = (out["layers"] as any[])[0].shapes[0];
  const [r, g, b, a] = shape.c.k;
  assert.ok(r > g && r > b, "red should dominate");
  assert.equal(a, 1, "alpha untouched");
});

test("recolors static solid fill (0..255 scale)", () => {
  const anim = {
    shapes: [{ ty: "st", c: { a: 0, k: [10, 20, 200] } }],
  };
  const out = recolorLottieJson(anim as any, hsl);
  const shape = (out["shapes"] as any[])[0];
  const [r, g, b] = shape.c.k;
  assert.ok(r > g && r > b);
  assert.ok(r > 1, "should stay in 0..255 scale");
});

test("recolors animated keyframes (s and e)", () => {
  const anim = {
    shapes: [
      {
        ty: "fl",
        c: {
          a: 1,
          k: [
            { t: 0, s: [0, 0, 1, 1], e: [0, 1, 0, 1] },
            { t: 10, s: [0, 1, 0, 1] },
          ],
        },
      },
    ],
  };
  const out = recolorLottieJson(anim as any, hsl);
  const kf = (out["shapes"] as any[])[0].c.k;
  assert.ok(kf[0].s[0] > kf[0].s[1]);
  assert.ok(kf[0].e[0] > kf[0].e[1]);
});

test("recolors gradient stops but leaves offsets alone, ignores alpha stops", () => {
  const anim = {
    shapes: [
      {
        ty: "gf",
        g: {
          p: 2,
          k: { a: 0, k: [0, 0, 0, 1, 1, 0, 1, 0, /* alpha stops */ 0, 1, 1, 1] },
        },
      },
    ],
  };
  const out = recolorLottieJson(anim as any, hsl);
  const g = (out["shapes"] as any[])[0].g;
  const arr = g.k.k;
  assert.equal(arr[0], 0, "offset 1 untouched");
  assert.equal(arr[4], 1, "offset 2 untouched");
  assert.ok(arr[1] > arr[2] && arr[1] > arr[3], "stop 1 tinted red-dominant");
  assert.deepEqual(arr.slice(8), [0, 1, 1, 1], "alpha stops untouched");
});

test("does not mutate input", () => {
  const anim = { shapes: [{ ty: "fl", c: { a: 0, k: [0, 0, 1, 1] } }] };
  const before = JSON.stringify(anim);
  recolorLottieJson(anim, hsl);
  assert.equal(JSON.stringify(anim), before);
});

test("gradient spec: first shape gets first stop's hue, last gets last", () => {
  // three gray fills → lightness preserved, hue from spectrum position
  const anim = {
    layers: [
      { shapes: [{ ty: "fl", c: { a: 0, k: [0.5, 0.5, 0.5, 1] } }] },
      { shapes: [{ ty: "fl", c: { a: 0, k: [0.5, 0.5, 0.5, 1] } }] },
      { shapes: [{ ty: "fl", c: { a: 0, k: [0.5, 0.5, 0.5, 1] } }] },
    ],
  };
  const spec = {
    kind: "gradient" as const,
    stops: [
      { h: 0, s: 1, l: 0.5 }, // red
      { h: 240, s: 1, l: 0.5 }, // blue
    ],
  };
  const out = recolorLottieJson(anim as any, spec);
  const layers = out["layers"] as any[];
  const first = layers[0].shapes[0].c.k;
  const last = layers[2].shapes[0].c.k;
  assert.ok(first[0] > first[2], "first shape red-dominant");
  assert.ok(last[2] > last[0], "last shape blue-dominant");
});

test("gradientHslAt: edges and midpoint", () => {
  const stops = [
    { h: 0, s: 1, l: 0.5 },
    { h: 240, s: 1, l: 0.5 },
  ];
  assert.equal(Math.round(gradientHslAt(stops, 0).h), 0);
  assert.equal(Math.round(gradientHslAt(stops, 1).h), 240);
  const mid = gradientHslAt(stops, 0.5);
  assert.ok(mid.h > 0 && mid.h < 360, "midpoint is a valid hue");
  assert.equal(Math.round(gradientHslAt(stops, -5).h), 0, "t clamped low");
  assert.equal(Math.round(gradientHslAt(stops, 5).h), 240, "t clamped high");
});

test("oversized tgs: strips nm/mn names and passes instead of throwing", async () => {
  // one real fill + fat layer names that alone push gzip over 64KB
  const noise = () => Array.from({ length: 400 }, () => Math.random().toString(36)).join("");
  const anim = {
    layers: Array.from({ length: 60 }, () => ({
      nm: noise(),
      mn: noise(),
      shapes: [{ ty: "fl", nm: noise(), c: { a: 0, k: [0.5, 0.5, 0.5, 1] } }],
    })),
  };
  const buf = gzipSync(Buffer.from(JSON.stringify(anim)));
  const out = await recolorTgs(buf, hsl);
  assert.ok(out.byteLength <= 64 * 1024, "rescued under 64KB");
  const rescued = JSON.parse(gunzipSync(out).toString("utf8"));
  assert.equal(rescued.layers[0].nm, undefined, "names stripped");
  const k = rescued.layers[0].shapes[0].c.k;
  assert.ok(k[0] > k[2], "still recolored to red");
});
