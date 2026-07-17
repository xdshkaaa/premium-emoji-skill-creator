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
  assert.equal(bucket.estimateMs(2), 40_000);
});

test("reserve consumes a token; refill restores over time up to capacity", async () => {
  const clock = fakeClock();
  const bucket = new StickerWriteBucket(clock.now);
  await bucket.reserve();
  assert.equal(bucket.estimateMs(1), 40_000);
  clock.advance(80_000);
  assert.equal(bucket.estimateMs(2), 0);
  clock.advance(60 * 60_000);
  assert.equal(bucket.estimateMs(5), 0);
  assert.equal(bucket.estimateMs(6), 40_000);
});

test("penalize drains tokens, doubles refill interval, cuts capacity to 3", () => {
  const clock = fakeClock();
  const bucket = new StickerWriteBucket(clock.now);
  bucket.penalize();
  assert.equal(bucket.estimateMs(1), 80_000);
  clock.advance(9 * 60_000); // inside the decay window: penalty still active
  assert.equal(bucket.estimateMs(3), 0);
  assert.equal(bucket.estimateMs(4), 80_000);
});

test("repeated penalize caps refill interval at 120s", () => {
  const clock = fakeClock();
  const bucket = new StickerWriteBucket(clock.now);
  bucket.penalize();
  bucket.penalize();
  assert.equal(bucket.estimateMs(1), 120_000);
  bucket.penalize();
  assert.equal(bucket.estimateMs(1), 120_000);
});

test("penalty decays back to base after clean stretches", () => {
  const clock = fakeClock();
  const bucket = new StickerWriteBucket(clock.now);
  bucket.penalize();
  bucket.penalize(); // 120s
  clock.advance(10 * 60_000);
  assert.equal(bucket.estimateMs(6), 3 * 60_000); // halved to 60s, capacity still 3
  clock.advance(10 * 60_000);
  // fully recovered: base interval, full capacity of 5
  assert.equal(bucket.estimateMs(5), 0);
  assert.equal(bucket.estimateMs(6), 40_000);
});

test("state round-trips through a store", async () => {
  const clock = fakeClock();
  let saved: string | undefined;
  const store = {
    load: () => saved,
    save: (s: string) => {
      saved = s;
    },
  };
  const first = new StickerWriteBucket(clock.now, store);
  clock.advance(60 * 60_000); // fill up to capacity 5
  await first.reserve();
  first.penalize();
  const second = new StickerWriteBucket(clock.now, store);
  assert.equal(second.estimateMs(1), 80_000); // penalty survived the "restart"
});

test("without a stored state cold start is conservative", () => {
  const clock = fakeClock();
  const store = { load: () => undefined, save: () => {} };
  const bucket = new StickerWriteBucket(clock.now, store);
  assert.equal(bucket.estimateMs(1), 0);
  assert.equal(bucket.estimateMs(2), 40_000);
});
