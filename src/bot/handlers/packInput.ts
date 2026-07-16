import type { Bot } from "grammy";
import type { MyContext } from "../context.js";
import { extractAddEmojiSetName, extractCustomEmojiIds } from "../../telegram/extract.js";
import { resolveEmojiSet, resolveCustomEmojiStickers } from "../../telegram/stickers.js";
import { processPack, retryPublish, type PackPayload } from "../flow/buildSkill.js";
import { requestCancel, isRunning } from "../flow/cancellation.js";
import { upsertUser } from "../../db/repo.js";
import { E } from "../emoji.js";

const HTML = { parse_mode: "HTML" as const };

export function registerPackInputHandlers(bot: Bot<MyContext>): void {
  bot.callbackQuery(/^retry:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const skillId = Number(ctx.match![1]);
    await retryPublish(skillId, ctx);
  });

  bot.callbackQuery(/^cancel:(\d+)$/, async (ctx) => {
    const ownerId = Number(ctx.match![1]);
    if (ctx.from.id !== ownerId) {
      await ctx.answerCallbackQuery({ text: "Это не твой запуск.", show_alert: true });
      return;
    }
    if (!isRunning(ownerId)) {
      await ctx.answerCallbackQuery({ text: "Уже завершено." });
      return;
    }
    requestCancel(ownerId);
    await ctx.answerCallbackQuery({ text: "Отменяю…" });
  });

  bot.on("message", async (ctx, next) => {
    if (!ctx.from || !ctx.message.text) return next();
    if (ctx.message.text.startsWith("/")) return next();

    upsertUser(ctx.from.id, ctx.from.username ?? null);

    const setName = extractAddEmojiSetName(ctx.message.text);
    if (setName) {
      const resolved = await resolveEmojiSet(bot, setName);
      if (!resolved.ok) {
        if (resolved.reason === "not_found") {
          await ctx.reply(`${E.warn} Ссылка не ведёт на реальный пак эмодзи. Проверь и пришли ещё раз.`, HTML);
        } else {
          await ctx.reply(
            `${E.warn} Это обычный стикерпак, а не пак ПРЕМИУМ-эмодзи. Нужна ссылка вида https://t.me/addemoji/...`,
            HTML,
          );
        }
        return;
      }
      const payload: PackPayload = {
        setName: resolved.setName,
        packTitle: resolved.title,
        stickers: resolved.stickers,
      };
      await processPack(ctx, payload);
      return;
    }

    const customEmojiIds = extractCustomEmojiIds(ctx.message);
    if (customEmojiIds.length > 0) {
      const stickers = await resolveCustomEmojiStickers(bot, customEmojiIds);
      if (stickers.length === 0) {
        await ctx.reply(`${E.warn} Не смог распознать эти эмодзи. Пришли ссылку на пак вместо этого.`, HTML);
        return;
      }
      const payload: PackPayload = {
        setName: null,
        packTitle: "Эмодзи из сообщения",
        stickers,
      };
      await processPack(ctx, payload);
      return;
    }

    await ctx.reply(
      `${E.eyes} Пришли ссылку на пак вида https://t.me/addemoji/ИмяПака, или сообщение с премиум-эмодзи. /help — подробности.`,
      HTML,
    );
  });
}
