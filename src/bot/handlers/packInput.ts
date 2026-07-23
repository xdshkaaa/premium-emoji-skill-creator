import type { Bot } from "grammy";
import type { MyContext } from "../context.js";
import { extractAddEmojiSetName, extractCustomEmojiIds, extractCustomEmojiIdList } from "../../telegram/extract.js";
import { resolveEmojiSet, resolveCustomEmojiStickers } from "../../telegram/stickers.js";
import { retryPublish } from "../flow/buildSkill.js";
import { requestCancel, isRunning } from "../flow/cancellation.js";
import { stagePack } from "../flow/recolorStore.js";
import { handlePendingHexMessage } from "./recolor.js";
import {
  takePendingRecolor,
  addToCollect,
  setCollectStatusMsg,
  takeCollect,
  clearCollect,
  COLLECT_CAP,
} from "../pendingInput.js";
import { upsertUser } from "../../db/repo.js";
import { packChoiceKeyboard, colorMenuKeyboard, collectKeyboard, backToMenuKeyboard } from "../keyboards.js";
import { config } from "../../config.js";
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

  bot.callbackQuery("col:reset", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    clearCollect(ctx.from.id);
    await ctx.editMessageText(
      `${E.eyes} Список очищен. Пришли эмодзи заново или ссылку на пак.`,
      { ...HTML, reply_markup: backToMenuKeyboard() },
    );
  });

  bot.callbackQuery("col:done", async (ctx) => {
    if (!ctx.from) return;
    const ids = takeCollect(ctx.from.id);
    if (!ids) {
      await ctx.answerCallbackQuery({ text: "Список пуст или устарел — пришли эмодзи заново.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    const stickers = await resolveCustomEmojiStickers(bot, ids);
    if (stickers.length === 0) {
      await ctx.editMessageText(
        `${E.warn} Ни один ID не удалось распознать. Проверь и пришли заново.`,
        { ...HTML, reply_markup: backToMenuKeyboard() },
      );
      return;
    }
    const token = stagePack({
      userId: ctx.from.id,
      setName: null,
      packTitle: "Свои эмодзи",
      stickers,
    });
    await ctx.editMessageText(
      `${E.brush} Найдено <b>${stickers.length}</b> из ${ids.length} эмодзи. Выбери цвет:`,
      { ...HTML, reply_markup: colorMenuKeyboard(token, !!config.AI_API_KEY) },
    );
  });

  bot.on("message", async (ctx, next) => {
    if (!ctx.from) return next();
    const emojiIds = extractCustomEmojiIds(ctx.message);
    if (!ctx.message.text && emojiIds.length === 0) return next();
    if (ctx.message.text?.startsWith("/")) return next();

    upsertUser(ctx.from.id, ctx.from.username ?? null);

    if (await handlePendingHexMessage(ctx)) return;

    const setName = extractAddEmojiSetName(ctx.message.text);
    if (setName) {
      clearCollect(ctx.from.id);
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
      if (takePendingRecolor(ctx.from.id)) {
        await ctx.reply(`${E.brush} Выбери цвет для пака «<b>${resolved.title}</b>»:`, {
          ...HTML,
          reply_markup: colorMenuKeyboard(token, !!config.AI_API_KEY),
        });
        return;
      }
      await ctx.reply(
        `${E.box} Пак «<b>${resolved.title}</b>» — ${resolved.stickers.length} эмодзи. Что делаем?`,
        { ...HTML, reply_markup: packChoiceKeyboard(token) },
      );
      return;
    }

    const collectIds = emojiIds.length > 0 ? emojiIds : extractCustomEmojiIdList(ctx.message.text);
    if (collectIds.length > 0) {
      await handleCollectInput(ctx, collectIds);
      return;
    }

    await ctx.reply(
      `${E.eyes} Пришли ссылку вида https://t.me/addemoji/ИмяПака, сообщение с премиум-эмодзи или список ID эмодзи.`,
      HTML,
    );
  });
}

async function handleCollectInput(ctx: MyContext & { from: { id: number } }, ids: string[]): Promise<void> {
  if (!ctx.chat) return;
  const { total, added, capped, prevStatusMsgId } = addToCollect(ctx.from.id, ctx.chat.id, ids);
  if (prevStatusMsgId) {
    await ctx.api.deleteMessage(ctx.chat.id, prevStatusMsgId).catch(() => {});
  }
  const capNote = capped ? `\n${E.warn} Лимит ${COLLECT_CAP} эмодзи — лишние отброшены.` : "";
  const text =
    added === 0
      ? `${E.box} Все эмодзи уже в списке (<b>${total}</b>).${capNote}\nПришли ещё или жми «Готово».`
      : `${E.box} Собрано эмодзи: <b>${total}</b> (+${added} новых).${capNote}\nПришли ещё или жми «Готово».`;
  const msg = await ctx.reply(text, { ...HTML, reply_markup: collectKeyboard(total) });
  setCollectStatusMsg(ctx.from.id, msg.message_id);
}
