import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { downloadTgFileCached } from "./download.js";

test("downloadTgFileCached: cache hit skips Telegram entirely", async () => {
  const uniqueId = `test_cache_${Date.now()}`;
  mkdirSync("data/cache", { recursive: true });
  const path = `data/cache/${uniqueId}.bin`;
  writeFileSync(path, Buffer.from("cached-bytes"));
  try {
    const bot = {
      api: {
        getFile: () => {
          throw new Error("network must not be touched on cache hit");
        },
      },
    };
    const buf = await downloadTgFileCached(bot as never, "irrelevant", uniqueId);
    assert.equal(buf.toString(), "cached-bytes");
  } finally {
    rmSync(path, { force: true });
  }
});
