import type { Bot } from "grammy";
import type { MyContext } from "../context.js";
import { config } from "../../config.js";
import { normalizeHex } from "../../media/color.js";
import { resolveEmojiSet } from "../../telegram/stickers.js";
import { extractAddEmojiSetName } from "../../telegram/extract.js";
import { processPack, type PackPayload } from "../flow/buildSkill.js";
import { runRecolorJob } from "../flow/recolorFlow.js";
import { getStagedPack, stageColorChoice, getStagedColorChoice } from "../flow/recolorStore.js";
import { setPending, takePendingHex } from "../pendingInput.js";
import { getRecoloredPackById } from "../../db/recolorRepo.js";
import { colorMenuKeyboard, gradientMenuKeyboard, confirmRecolorKeyboard, backToMenuKeyboard } from "../keyboards.js";
import { getGradientPreset } from "../../media/gradients.js";
import { E } from "../emoji.js";

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

function expiredMessage() {
  return { text: `${E.warn} Сессия устарела: пришли ссылку на пак ещё раз.`, ...HTML, reply_markup: backToMenuKeyboard() };
}

export function registerRecolorHandlers(bot: Bot<MyContext>): void {
  bot.callbackQuery(/^pk:skill:([a-f0-9]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const staged = getStagedPack(ctx.match![1]!);
    if (!staged) {
      await ctx.editMessageText(expiredMessage().text, { ...HTML, reply_markup: backToMenuKeyboard() });
      return;
    }
    const payload: PackPayload = {
      setName: staged.setName,
      packTitle: staged.packTitle,
      stickers: staged.stickers,
    };
    await processPack(ctx, payload);
  });

  bot.callbackQuery(/^pk:tint:([a-f0-9]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const token = ctx.match![1]!;
    const staged = getStagedPack(token);
    if (!staged) {
      await ctx.editMessageText(expiredMessage().text, { ...HTML, reply_markup: backToMenuKeyboard() });
      return;
    }
    await ctx.editMessageText(`${E.eyes} Выбери цвет для пака «<b>${staged.packTitle}</b>»:`, {
      ...HTML,
      reply_markup: colorMenuKeyboard(token, !!config.AI_API_KEY),
    });
  });

  bot.callbackQuery(/^tint:([a-f0-9]+):(custom|ai|grad|g:[a-z]+|[0-9a-f]{6})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const token = ctx.match![1]!;
    const choice = ctx.match![2]!;
    const staged = getStagedPack(token);
    if (!staged) {
      await ctx.editMessageText(expiredMessage().text, { ...HTML, reply_markup: backToMenuKeyboard() });
      return;
    }

    if (choice === "grad") {
      await ctx.editMessageText(`${E.eyes} Выбери градиент для пака «<b>${staged.packTitle}</b>»:`, {
        ...HTML,
        reply_markup: gradientMenuKeyboard(token),
      });
      return;
    }

    if (choice.startsWith("g:")) {
      const preset = getGradientPreset(choice.slice(2));
      if (!preset) {
        await ctx.editMessageText(`${E.warn} Неизвестный градиент.`, { ...HTML, reply_markup: backToMenuKeyboard() });
        return;
      }
      const choiceToken = stageColorChoice({
        ...staged,
        hex: preset.colors[1],
        mode: "gradient",
        gradientId: preset.id,
      });
      await ctx.editMessageText(
        `${E.eyes} Градиент: <b>${preset.label}</b> (<code>${preset.colors.join(" → ")}</code>).\n\nПерекрасить ${staged.stickers.length} эмодзи и создать новый пак?`,
        { ...HTML, reply_markup: confirmRecolorKeyboard(choiceToken, token) },
      );
      return;
    }

    if (choice === "custom") {
      setPending(ctx.from.id, token);
      await ctx.editMessageText(`${E.eyes} Пришли цвет в HEX, например <code>#ff0000</code>.`, HTML);
      return;
    }

    if (choice === "ai") {
      if (!config.AI_API_KEY) {
        await ctx.editMessageText(`${E.warn} ИИ недоступен.`, { ...HTML, reply_markup: backToMenuKeyboard() });
        return;
      }
      await ctx.editMessageText(`${E.eyes} Подбираю цвет…`, HTML);
      const { pickColorForPack } = await import("../../ai/colorPick.js");
      const result = await pickColorForPack({
        title: staged.packTitle,
        fallbacks: staged.stickers.map((s) => s.emoji ?? "").filter(Boolean),
      });
      await confirmColor(ctx, token, staged, result.hex, "ai", result.reason);
      return;
    }

    await confirmColor(ctx, token, staged, `#${choice}`, "manual");
  });

  bot.callbackQuery(/^tgo:([a-f0-9]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const token = ctx.match![1]!;
    const staged = getStagedColorChoice(token);
    if (!staged) {
      await ctx.editMessageText(expiredMessage().text, { ...HTML, reply_markup: backToMenuKeyboard() });
      return;
    }
    // Fire-and-forget: bot.start() processes updates sequentially, so awaiting a
    // multi-minute job here would block the bot from handling anything else
    // (including the cancel button for this very job) until it finishes.
    runRecolorJob(bot, ctx, staged).catch((err) => {
      console.error("Recolor job crashed:", err);
    });
  });

  bot.callbackQuery(/^rskill:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const rowId = Number(ctx.match![1]);
    const row = getRecoloredPackById(rowId);
    if (!row || row.tg_user_id !== ctx.from.id || !row.new_set_name) {
      await ctx.reply(`${E.warn} Пак не найден.`, { ...HTML, reply_markup: backToMenuKeyboard() });
      return;
    }
    const resolved = await resolveEmojiSet(bot, row.new_set_name);
    if (!resolved.ok) {
      await ctx.reply(`${E.warn} Не удалось найти пак в Telegram.`, { ...HTML, reply_markup: backToMenuKeyboard() });
      return;
    }
    const payload: PackPayload = {
      setName: resolved.setName,
      packTitle: resolved.title,
      stickers: resolved.stickers,
    };
    await processPack(ctx, payload);
  });
}

async function confirmColor(
  ctx: MyContext,
  packToken: string,
  staged: { userId: number; setName: string | null; packTitle: string; stickers: import("grammy/types").Sticker[] },
  hex: string,
  mode: "manual" | "ai",
  reason?: string,
): Promise<void> {
  const choiceToken = stageColorChoice({ ...staged, hex, mode });
  const reasonLine = reason ? `\n<i>${reason}</i>` : "";
  await ctx.editMessageText(
    `${E.eyes} Цвет: <code>${hex}</code>.${reasonLine}\n\nПерекрасить ${staged.stickers.length} эмодзи и создать новый пак?`,
    { ...HTML, reply_markup: confirmRecolorKeyboard(choiceToken, packToken) },
  );
}

/** Handles a HEX color typed as a plain message while a "custom color" pick is pending.
 *  Returns true if the message was consumed (pending flow handled it), false to let the
 *  caller fall through to normal pack-link handling. */
export async function handlePendingHexMessage(ctx: MyContext): Promise<boolean> {
  if (!ctx.from || !ctx.message?.text) return false;
  const text = ctx.message.text;

  // A new pack link always takes precedence and clears any pending color prompt
  // (recolor intent from the menu stays: packInput consumes it).
  if (extractAddEmojiSetName(text)) {
    takePendingHex(ctx.from.id);
    return false;
  }

  const token = takePendingHex(ctx.from.id);
  if (!token) return false;

  const staged = getStagedPack(token);
  if (!staged) {
    await ctx.reply(expiredMessage().text, { ...HTML, reply_markup: backToMenuKeyboard() });
    return true;
  }

  const hex = normalizeHex(text);
  if (!hex) {
    setPending(ctx.from.id, token);
    await ctx.reply(`${E.warn} Не похоже на HEX. Пришли, например, <code>#ff0000</code>.`, HTML);
    return true;
  }

  const choiceToken = stageColorChoice({ ...staged, hex, mode: "manual" });
  await ctx.reply(
    `${E.eyes} Цвет: <code>${hex}</code>.\n\nПерекрасить ${staged.stickers.length} эмодзи и создать новый пак?`,
    { ...HTML, reply_markup: confirmRecolorKeyboard(choiceToken, token) },
  );
  return true;
}
