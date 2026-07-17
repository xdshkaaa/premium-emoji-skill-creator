import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Bot } from "grammy";
import type { MyContext } from "../bot/context.js";
import { config } from "../config.js";

const CACHE_DIR = "data/cache";
const CACHE_MAX_FILES = 2000;
let cacheDirReady = false;

export async function downloadTgFile(bot: Bot<MyContext>, fileId: string): Promise<Buffer> {
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) throw new Error(`No file_path for file_id ${fileId}`);
  const url = `https://api.telegram.org/file/bot${config.BOT_TOKEN}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download file ${fileId}: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function ensureCacheDir(): void {
  if (cacheDirReady) return;
  mkdirSync(CACHE_DIR, { recursive: true });
  cacheDirReady = true;
}

function pruneCache(): void {
  const files = readdirSync(CACHE_DIR).map((name) => {
    const path = join(CACHE_DIR, name);
    return { path, mtime: statSync(path).mtimeMs };
  });
  if (files.length <= CACHE_MAX_FILES) return;
  files.sort((a, b) => a.mtime - b.mtime);
  for (const file of files.slice(0, files.length - CACHE_MAX_FILES)) {
    unlinkSync(file.path);
  }
}

/** Same as downloadTgFile but with a disk cache keyed by file_unique_id, so
 *  re-recoloring the same pack in another color skips the download phase. */
export async function downloadTgFileCached(
  bot: Bot<MyContext>,
  fileId: string,
  fileUniqueId: string,
): Promise<Buffer> {
  ensureCacheDir();
  const path = join(CACHE_DIR, `${fileUniqueId.replace(/[^a-zA-Z0-9_-]/g, "_")}.bin`);
  try {
    return await readFile(path);
  } catch {
    // cache miss
  }
  const buf = await downloadTgFile(bot, fileId);
  try {
    await writeFile(path, buf);
    pruneCache();
  } catch (err) {
    console.warn("Sticker cache write failed:", err);
  }
  return buf;
}
