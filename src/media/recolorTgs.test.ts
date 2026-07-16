import { test } from "node:test";
import assert from "node:assert/strict";
import { recolorLottieJson } from "./recolorTgs.js";

const hsl = { h: 0, s: 1, l: 0.5 }; // target red

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
