import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSetName, buildPackTitle } from "./packCreate.js";

test("generateSetName strips old _by_ suffix and non-alnum chars", () => {
  const name = generateSetName("Cool Pack!!_by_oldbot", "ff00aa", "mybot");
  assert.ok(name.endsWith("_by_mybot"));
  assert.ok(/^[a-z][a-z0-9_]*$/.test(name));
  assert.ok(!name.includes("__"));
  assert.ok(name.length <= 64);
});

test("generateSetName clamps to 64 chars total", () => {
  const longSource = "a".repeat(200);
  const name = generateSetName(longSource, "ff00aa", "mybot");
  assert.ok(name.length <= 64);
  assert.ok(name.endsWith("_by_mybot"));
});

test("generateSetName starts with a letter even for numeric source", () => {
  const name = generateSetName("12345", "ff00aa", "mybot");
  assert.ok(/^[a-z]/.test(name));
});

test("generateSetName attempt suffix differs across retries", () => {
  const a = generateSetName("pack", "ff00aa", "mybot", 0);
  const b = generateSetName("pack", "ff00aa", "mybot", 1);
  assert.notEqual(a, b);
  assert.ok(b.length <= 64);
});

test("buildPackTitle clamps to 64 chars and includes hex + bot", () => {
  const title = buildPackTitle("A".repeat(100), "ff00aa", "mybot");
  assert.ok(title.length <= 64);
  assert.ok(title.includes("#ff00aa"));
  assert.ok(title.includes("@mybot"));
});
