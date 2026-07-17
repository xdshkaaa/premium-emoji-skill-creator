import type { Bot } from "grammy";
import { InputFile, GrammyError } from "grammy";
import type { MyContext } from "../context.js";
import type { StagedColorChoice } from "./recolorStore.js";
import { isRunning, startRun, endRun, throwIfCancelled, CancelledError } from "./cancellation.js";
import { stickerFormat } from "../../telegram/stickers.js";
import { downloadTgFileCached } from "../../media/download.js";
import { recolorSticker, MediaError } from "../../media/recolor.js";
import { hexToHsl, type TintSpec } from "../../media/color.js";
import { getGradientPreset } from "../../media/gradients.js";
import { createRecoloredPack, type RecolorItem } from "../../telegram/packCreate.js";
import { estimateStickerWriteMs } from "../../telegram/globalLimiter.js";
import { createRecoloredPackRow, finishRecoloredPack, failRecoloredPack } from "../../db/recolorRepo.js";
import { backToMenuKeyboard, recolorDoneKeyboard } from "../keyboards.js";
import { E } from "../emoji.js";
import { mapLimit } from "../../utils/concurrency.js";

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
const EDIT_EVERY_N = 5;
const EDIT_EVERY_MS = 3000;
// Base covers up to two full flood-gate waits (~6 min each) on top of the work.
const PHASE2_BASE_TIMEOUT_MS = 15 * 60_000;
// The write bucket paces adds at ~1 per 25s, but a 429 penalty can stretch
// the interval up to 120s/write — the watchdog must outlast that.
const PHASE2_PER_ITEM_MS = 150_000;
// Download hits bot.api.getFile per item; batch it down to stay clear of
// the same bot-wide flood limit that createNewStickerSet/addStickerToSet hit.
const DOWNLOAD_CONCURRENCY = 3;
// Recolor is pure CPU, no Telegram API calls — concurrency here is unrelated
// to rate limits.
const RECOLOR_CONCURRENCY = 4;

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
  const gradient = staged.mode === "gradient" && staged.gradientId
    ? getGradientPreset(staged.gradientId)
    : undefined;
  const spec: TintSpec = gradient
    ? { kind: "gradient", stops: gradient.colors.map(hexToHsl) }
    : { kind: "solid", hsl: hexToHsl(staged.hex) };
  const colorLabel = gradient ? gradient.label : `<code>${staged.hex}</code>`;

  const rowId = createRecoloredPackRow({
    tgUserId: userId,
    sourceSetName: staged.setName ?? staged.packTitle,
    colorHex: gradient ? `grad:${gradient.id}` : staged.hex,
    mode: staged.mode,
  });

  const progressMsg = await ctx.reply(
    `${E.box} Перекрашиваю <b>${staged.stickers.length}</b> эмодзи в ${colorLabel}…`,
    cancelKeyboardHtml(userId),
  );

  let lastEditAt = Date.now();
  let lastEditCount = 0;
  async function maybeEditProgress(
    done: number,
    total: number,
    label: string,
    suffix = "",
  ): Promise<void> {
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
        `${E.box} ${label}: <b>${done}</b>/${total}${suffix}…`,
        cancelKeyboardHtml(userId),
      );
    } catch (err) {
      if (!(err instanceof GrammyError && /message is not modified/i.test(err.description))) {
        console.error("Progress edit failed:", err);
      }
    }
  }

  // Uploads run at the write bucket's pace (~1 add / 25s), so the honest
  // remaining time matters more than the raw counter.
  function uploadEtaSuffix(remaining: number): string {
    const ms = estimateStickerWriteMs(remaining);
    if (ms < 60_000) return "";
    return `, ещё ~${Math.ceil(ms / 60_000)} мин`;
  }

  // Phase 1: batch download the whole pack, then batch recolor the whole pack
  const items: RecolorItem[] = [];
  const failed: { emoji: string; reason: string }[] = [];
  const total = staged.stickers.length;

  try {
    // Stage 1: download all
    lastEditCount = 0;
    let downloadedCount = 0;
    type Downloaded =
      | { ok: true; sticker: (typeof staged.stickers)[number]; format: ReturnType<typeof stickerFormat>; buf: Buffer }
      | { ok: false; sticker: (typeof staged.stickers)[number]; reason: string };
    const downloads = await mapLimit(staged.stickers, DOWNLOAD_CONCURRENCY, async (sticker): Promise<Downloaded> => {
      throwIfCancelled(userId);
      try {
        const format = stickerFormat(sticker);
        const buf = await downloadTgFileCached(bot, sticker.file_id, sticker.file_unique_id);
        downloadedCount++;
        await maybeEditProgress(downloadedCount, total, "Скачано");
        return { ok: true, sticker, format, buf };
      } catch (err) {
        if (err instanceof CancelledError) throw err;
        console.error(`Download failed for emoji ${sticker.custom_emoji_id ?? sticker.file_id}:`, err);
        downloadedCount++;
        await maybeEditProgress(downloadedCount, total, "Скачано");
        return { ok: false, sticker, reason: "error" };
      }
    });

    // Stage 2: recolor all
    lastEditCount = 0;
    let recoloredCount = 0;
    const recolorResults = await mapLimit(downloads, RECOLOR_CONCURRENCY, async (dl): Promise<RecolorItem | null> => {
      throwIfCancelled(userId);
      if (!dl.ok) {
        failed.push({ emoji: dl.sticker.emoji ?? "❓", reason: dl.reason });
        recoloredCount++;
        await maybeEditProgress(recoloredCount, total, "Перекрашено");
        return null;
      }
      try {
        const recolored = await recolorSticker(dl.buf, dl.format, spec);
        const filename = dl.format === "static" ? "e.webp" : dl.format === "animated" ? "e.tgs" : "e.webm";
        return {
          input: new InputFile(recolored, filename),
          emoji: dl.sticker.emoji ?? "❓",
          format: dl.format,
        };
      } catch (err) {
        if (err instanceof CancelledError) throw err;
        const reason = err instanceof MediaError ? err.code : "error";
        failed.push({ emoji: dl.sticker.emoji ?? "❓", reason });
        console.error(`Recolor failed for emoji ${dl.sticker.custom_emoji_id ?? dl.sticker.file_id}:`, err);
        return null;
      } finally {
        recoloredCount++;
        await maybeEditProgress(recoloredCount, total, "Перекрашено");
      }
    });
    for (const item of recolorResults) if (item) items.push(item);
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
  lastEditCount = 0;
  let uploadedCount = 0;
  let lastPaceText = "";
  await maybeEditProgress(0, items.length, "Загружаю в пак", uploadEtaSuffix(items.length));
  try {
    const createPromise = createRecoloredPack(bot, {
      userId,
      sourceSetName: staged.setName ?? staged.packTitle,
      sourceTitle: staged.packTitle,
      hex: gradient ? gradient.id : staged.hex,
      colorLabel: gradient?.label,
      items,
      onSetCreated: (setName) => {
        createdSetName = setName;
      },
      onProgress: (done, total) => {
        uploadedCount = done;
        return maybeEditProgress(done, total, "Загружаю в пак", uploadEtaSuffix(total - done));
      },
      checkCancel: () => throwIfCancelled(userId),
      // Proactive bucket pacing: keep the same progress line, just refresh the ETA.
      onPace: () => {
        const now = Date.now();
        if (now - lastEditAt < EDIT_EVERY_MS) return;
        const text = `${E.box} Загружаю в пак: <b>${uploadedCount}</b>/${items.length}${uploadEtaSuffix(items.length - uploadedCount)}…`;
        if (text === lastPaceText) return;
        lastPaceText = text;
        lastEditAt = now;
        ctx.api
          .editMessageText(progressMsg.chat.id, progressMsg.message_id, text, cancelKeyboardHtml(userId))
          .catch(() => {});
      },
      onFloodWait: (secondsLeft) => {
        const now = Date.now();
        if (now - lastEditAt < EDIT_EVERY_MS) return;
        lastEditAt = now;
        ctx.api
          .editMessageText(
            progressMsg.chat.id,
            progressMsg.message_id,
            `${E.box} Telegram просит подождать ~<b>${secondsLeft}</b> сек (флуд-лимит), жду…`,
            cancelKeyboardHtml(userId),
          )
          .catch(() => {});
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Phase 2 exceeded time budget")),
        PHASE2_BASE_TIMEOUT_MS + items.length * PHASE2_PER_ITEM_MS,
      ),
    );

    const result = await Promise.race([createPromise, timeoutPromise]);

    finishRecoloredPack(rowId, result.setName);

    const skippedTotal = failed.length + result.skipped;
    const skippedLine =
      skippedTotal > 0 ? `\n\nПропущено ${skippedTotal} из-за ошибок.` : "";
    await ctx.api.editMessageText(
      progressMsg.chat.id,
      progressMsg.message_id,
      `${E.check} Готово! <a href="https://t.me/addemoji/${result.setName}">Новый пак</a> создан из ${items.length - result.skipped} эмодзи.${skippedLine}`,
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
