import { test } from "node:test";
import assert from "node:assert/strict";
import { StickerWriteBucket } from "./globalLimiter.js";

function fakeClock(startMs = 0) {
  let now = startMs;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test("cold start holds a single token, not a full burst", () => {
  const clock = fakeClock();
  const bucket = new StickerWriteBucket(clock.now);
  assert.equal(bucket.estimateMs(1), 0);
  assert.equal(bucket.estimateMs(2), 25_000);
});

test("reserve consumes a token; refill restores over time up to capacity", async () => {
  const clock = fakeClock();
  const bucket = new StickerWriteBucket(clock.now);
  await bucket.reserve();
  assert.equal(bucket.estimateMs(1), 25_000);
  clock.advance(50_000);
  assert.equal(bucket.estimateMs(2), 0);
  clock.advance(60 * 60_000);
  assert.equal(bucket.estimateMs(8), 0);
  assert.equal(bucket.estimateMs(9), 25_000);
});

test("penalize drains tokens, doubles refill interval, cuts capacity to 3", () => {
  const clock = fakeClock();
  const bucket = new StickerWriteBucket(clock.now);
  bucket.penalize();
  assert.equal(bucket.estimateMs(1), 50_000);
  clock.advance(60 * 60_000);
  assert.equal(bucket.estimateMs(3), 0);
  assert.equal(bucket.estimateMs(4), 50_000);
});

test("repeated penalize caps refill interval at 120s", () => {
  const clock = fakeClock();
  const bucket = new StickerWriteBucket(clock.now);
  bucket.penalize();
  bucket.penalize();
  assert.equal(bucket.estimateMs(1), 100_000);
  bucket.penalize();
  assert.equal(bucket.estimateMs(1), 120_000);
  bucket.penalize();
  assert.equal(bucket.estimateMs(1), 120_000);
});
