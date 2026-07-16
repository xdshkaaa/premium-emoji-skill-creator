import { test } from "node:test";
import assert from "node:assert/strict";
import { parseColorResponse } from "./colorPick.js";

test("parses strict JSON", () => {
  const out = parseColorResponse('{"hex":"#ff00aa","reason":"vivid"}');
  assert.equal(out?.hex, "#ff00aa");
  assert.equal(out?.reason, "vivid");
});

test("parses JSON wrapped in markdown fences", () => {
  const out = parseColorResponse('```json\n{"hex":"#00ff00","reason":"green"}\n```');
  assert.equal(out?.hex, "#00ff00");
});

test("falls back to regex extraction on malformed JSON", () => {
  const out = parseColorResponse("the color should be #123abc for this pack");
  assert.equal(out?.hex, "#123abc");
});

test("returns null when no color found", () => {
  const out = parseColorResponse("I have no idea");
  assert.equal(out, null);
});
