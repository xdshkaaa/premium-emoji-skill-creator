import { Bot } from "grammy";
import type { Api } from "grammy";
import { WriteLimiter } from "./globalLimiter.js";
import { config } from "../config.js";
import { recordWorkerOptin, getWorkerOptins } from "../db/workerRepo.js";

// Telegram's sticker-write quota is per bot token (~1.5 writes/min each), so
// throughput scales only by adding tokens. A worker can create packs only for
// users who have /start-ed it — Telegram rejects createNewStickerSet for
// strangers — hence the opt-in registry.
export interface PackWriter {
  api: Api;
  username: string;
  limiter: WriteLimiter;
  isMaster: boolean;
  busy: number;
}

let master: PackWriter | undefined;
const workers: PackWriter[] = [];

export async function initWriterPool(masterApi: Api, masterUsername: string): Promise<void> {
  master = {
    api: masterApi,
    username: masterUsername,
    limiter: new WriteLimiter("data/write-bucket.json"),
    isMaster: true,
    busy: 0,
  };
  for (const token of config.workerBotTokens) {
    try {
      const bot = new Bot(token);
      const me = await bot.api.getMe();
      bot.command("start", async (ctx) => {
        if (!ctx.from) return;
        recordWorkerOptin(ctx.from.id, me.username);
        await ctx.reply(
          `Готово! Я бот-помощник @${masterUsername}: теперь твои паки могут заливаться параллельно. Возвращайся в @${masterUsername}.`,
        );
      });
      bot.on("message", (ctx) =>
        ctx.reply(`Я только помогаю @${masterUsername} заливать паки. Пиши туда.`),
      );
      // Long polling per worker: needed to catch /start opt-ins. Not awaited.
      bot.start().catch((err) => console.error(`Worker @${me.username} polling died:`, err));
      workers.push({
        api: bot.api,
        username: me.username,
        limiter: new WriteLimiter(`data/write-bucket-${me.username}.json`),
        isMaster: false,
        busy: 0,
      });
      console.log(`Worker bot @${me.username} ready.`);
    } catch (err) {
      console.error("Worker bot init failed (bad token?):", err);
    }
  }
}

/**
 * Picks the least-loaded writer available to this user (master + workers the
 * user has opted into) and reserves it until release() is called.
 */
export function acquireWriter(userId: number): { writer: PackWriter; release: () => void } {
  if (!master) throw new Error("Writer pool not initialized");
  const opted = new Set(getWorkerOptins(userId));
  const eligible = [master, ...workers.filter((w) => opted.has(w.username))];
  eligible.sort((a, b) => a.busy - b.busy || a.limiter.estimateMs(1) - b.limiter.estimateMs(1));
  const writer = eligible[0]!;
  writer.busy++;
  let released = false;
  return {
    writer,
    release: () => {
      if (released) return;
      released = true;
      writer.busy--;
    },
  };
}

/** Worker usernames this user has NOT opted into yet (for the speed-up hint). */
export function unusedWorkersFor(userId: number): string[] {
  const opted = new Set(getWorkerOptins(userId));
  return workers.filter((w) => !opted.has(w.username)).map((w) => w.username);
}
