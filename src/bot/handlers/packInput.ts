import type { Bot } from "grammy";
import type { MyContext } from "../context.js";
import { extractAddEmojiSetName } from "../../telegram/extract.js";
import { resolveEmojiSet } from "../../telegram/stickers.js";
import { retryPublish } from "../flow/buildSkill.js";
import { requestCancel, isRunning } from "../flow/cancellation.js";
import { stagePack } from "../flow/recolorStore.js";
import { handlePendingHexMessage } from "./recolor.js";
import { upsertUser } from "../../db/repo.js";
import { packChoiceKeyboard } from "../keyboards.js";
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

    if (await handlePendingHexMessage(ctx)) return;

    const setName = extractAddEmojiSetName(ctx.message.text);
    if (setName) {
      const resolved = await resolveEmojiSet(bot, setName);
      if (!resolved.ok) {
        if (resolved.reason === "not_found") {
          await ctx.reply(`${E.warn} <b>Ссылка не ведёт на реальный пак эмодзи.</b> Проверь и пришли ещё раз.`, HTML);
        } else {
          await ctx.reply(
            `${E.warn} Это обычный стикерпак, а не пак <b>ПРЕМИУМ-эмодзи</b>. Нужна ссылка вида https://t.me/addemoji/...`,
            HTML,
          );
        }
        return;
      }
      const token = stagePack({
        userId: ctx.from.id,
        setName: resolved.setName,
        packTitle: resolved.title,
        stickers: resolved.stickers,
      });
      await ctx.reply(
        `${E.box} Пак «<b>${resolved.title}</b>» — ${resolved.stickers.length} эмодзи. Что делаем?`,
        { ...HTML, reply_markup: packChoiceKeyboard(token) },
      );
      return;
    }

    await ctx.reply(
      `${E.eyes} Принимаю только ссылки на пак вида https://t.me/addemoji/ИмяПака. Одиночные эмодзи не подходят: пришли ссылку на весь пак.`,
      HTML,
    );
  });
}
