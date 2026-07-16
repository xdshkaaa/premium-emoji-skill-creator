import type { Bot } from "grammy";
import { InputFile, GrammyError } from "grammy";
import type { MyContext } from "../context.js";
import type { StagedColorChoice } from "./recolorStore.js";
import { isRunning, startRun, endRun, throwIfCancelled, CancelledError } from "./cancellation.js";
import { stickerFormat } from "../../telegram/stickers.js";
import { downloadTgFile } from "../../media/download.js";
import { recolorSticker, MediaError } from "../../media/recolor.js";
import { hexToHsl } from "../../media/color.js";
import { createRecoloredPack, type RecolorItem } from "../../telegram/packCreate.js";
import { createRecoloredPackRow, finishRecoloredPack, failRecoloredPack } from "../../db/recolorRepo.js";
import { backToMenuKeyboard, recolorDoneKeyboard } from "../keyboards.js";
import { E } from "../emoji.js";

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
const EDIT_EVERY_N = 5;
const EDIT_EVERY_MS = 3000;
const PHASE2_TIMEOUT_MS = 5 * 60_000;

function cancelKeyboardHtml(userId: number) {
  return {
    ...HTML,
    reply_markup: { inline_keyboard: [[{ text: "Отменить", callback_data: `cancel:${userId}` }]] },
  };
}

export async function runRecolorJob(
  bot: Bot<MyContext>,
  ctx: MyContext,
  staged: StagedColorChoice,
): Promise<void> {
  const userId = staged.userId;

  if (isRunning(userId)) {
    await ctx.reply(`${E.eyes} Уже обрабатываю предыдущий запуск. Дождись.`, {
      ...HTML,
      reply_markup: backToMenuKeyboard(),
    });
    return;
  }
  startRun(userId);
  try {
    await run(bot, ctx, staged);
  } finally {
    endRun(userId);
  }
}

async function run(bot: Bot<MyContext>, ctx: MyContext, staged: StagedColorChoice): Promise<void> {
  const userId = staged.userId;
  const hsl = hexToHsl(staged.hex);

  const rowId = createRecoloredPackRow({
    tgUserId: userId,
    sourceSetName: staged.setName ?? staged.packTitle,
    colorHex: staged.hex,
    mode: staged.mode,
  });

  const progressMsg = await ctx.reply(
    `${E.box} Перекрашиваю <b>${staged.stickers.length}</b> эмодзи в <code>${staged.hex}</code>…`,
    cancelKeyboardHtml(userId),
  );

  let lastEditAt = Date.now();
  let lastEditCount = 0;
  async function maybeEditProgress(done: number, total: number, label: string): Promise<void> {
    const now = Date.now();
    if (done - lastEditCount < EDIT_EVERY_N && now - lastEditAt < EDIT_EVERY_MS && done !== total) {
      return;
    }
    lastEditCount = done;
    lastEditAt = now;
    try {
      await ctx.api.editMessageText(
        progressMsg.chat.id,
        progressMsg.message_id,
        `${E.box} ${label}: <b>${done}</b>/${total}…`,
        cancelKeyboardHtml(userId),
      );
    } catch (err) {
      if (!(err instanceof GrammyError && /message is not modified/i.test(err.description))) {
        console.error("Progress edit failed:", err);
      }
    }
  }

  // Phase 1: download + recolor
  const items: RecolorItem[] = [];
  const failed: { emoji: string; reason: string }[] = [];

  try {
    for (let i = 0; i < staged.stickers.length; i++) {
      throwIfCancelled(userId);
      const sticker = staged.stickers[i]!;
      try {
        const format = stickerFormat(sticker);
        const buf = await downloadTgFile(bot, sticker.file_id);
        const recolored = await recolorSticker(buf, format, hsl);
        const filename = format === "static" ? "e.webp" : format === "animated" ? "e.tgs" : "e.webm";
        items.push({
          input: new InputFile(recolored, filename),
          emoji: sticker.emoji ?? "❓",
          format,
        });
      } catch (err) {
        if (err instanceof CancelledError) throw err;
        const reason = err instanceof MediaError ? err.code : "error";
        failed.push({ emoji: sticker.emoji ?? "❓", reason });
        console.error(`Recolor failed for emoji ${sticker.custom_emoji_id ?? sticker.file_id}:`, err);
      }
      await maybeEditProgress(i + 1, staged.stickers.length, "Перекрашено");
    }
  } catch (err) {
    if (err instanceof CancelledError) {
      failRecoloredPack(rowId);
      await ctx.api.editMessageText(
        progressMsg.chat.id,
        progressMsg.message_id,
        `${E.warn} Отменено.`,
        { ...HTML, reply_markup: backToMenuKeyboard() },
      );
      return;
    }
    throw err;
  }

  if (items.length === 0) {
    failRecoloredPack(rowId);
    await ctx.api.editMessageText(
      progressMsg.chat.id,
      progressMsg.message_id,
      `${E.warn} Не удалось перекрасить ни одного эмодзи. Прерываю.`,
      { ...HTML, reply_markup: backToMenuKeyboard() },
    );
    return;
  }

  // Phase 2: create the new pack
  let createdSetName: string | undefined;
  await maybeEditProgress(0, staged.stickers.length, "Загружаю в Telegram");
  try {
    const createPromise = createRecoloredPack(bot, {
      userId,
      sourceSetName: staged.setName ?? staged.packTitle,
      sourceTitle: staged.packTitle,
      hex: staged.hex,
      items,
      onSetCreated: (setName) => {
        createdSetName = setName;
      },
      onUploadProgress: (done, total) => maybeEditProgress(done, total, "Загружаю в Telegram"),
      onProgress: (done, total) => maybeEditProgress(done, total, "Добавляю в пак"),
      checkCancel: () => throwIfCancelled(userId),
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Phase 2 exceeded time budget")),
        PHASE2_TIMEOUT_MS,
      ),
    );

    const result = await Promise.race([createPromise, timeoutPromise]);

    finishRecoloredPack(rowId, result.setName);

    const skippedLine =
      failed.length > 0 ? `\n\nПропущено ${failed.length} из-за ошибок конвертации.` : "";
    await ctx.api.editMessageText(
      progressMsg.chat.id,
      progressMsg.message_id,
      `${E.check} Готово! <a href="https://t.me/addemoji/${result.setName}">Новый пак</a> создан из ${items.length} эмодзи.${skippedLine}`,
      { ...HTML, reply_markup: recolorDoneKeyboard(rowId) },
    );
  } catch (err) {
    if (err instanceof CancelledError) {
      failRecoloredPack(rowId);
      if (createdSetName) {
        try {
          await bot.api.deleteStickerSet(createdSetName);
        } catch (cleanupErr) {
          console.error("Failed to clean up cancelled sticker set:", cleanupErr);
        }
      }
      await ctx.api.editMessageText(
        progressMsg.chat.id,
        progressMsg.message_id,
        `${E.warn} Отменено.`,
        { ...HTML, reply_markup: backToMenuKeyboard() },
      );
      return;
    }
    console.error("Create recolored pack failed:", err);
    failRecoloredPack(rowId);
    await ctx.api.editMessageText(
      progressMsg.chat.id,
      progressMsg.message_id,
      `${E.warn} Не удалось создать пак в Telegram.`,
      { ...HTML, reply_markup: backToMenuKeyboard() },
    );
  }
}
