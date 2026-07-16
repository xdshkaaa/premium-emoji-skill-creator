import type { MyContext } from "../context.js";
import type { Sticker } from "grammy/types";
import {
  findSkillByUserAndSetName,
  createSkill,
  getSkillById,
  createPack,
  findExistingEmojiIds,
  insertEmoji,
  getEmojisForSkill,
  setSkillPublishedSha,
  touchSkill,
} from "../../db/repo.js";
import { stickerFormat } from "../../telegram/stickers.js";
import { buildUniqueSlug } from "../../skill/slug.js";
import { renderSkillMd } from "../../skill/template.js";
import { renderCatalog } from "../../skill/catalog.js";
import { publishFiles } from "../../publish/github.js";
import { retryPublishKeyboard, backToMenuKeyboard } from "../keyboards.js";
import { config } from "../../config.js";
import { E } from "../emoji.js";
import { startRun, endRun, isRunning } from "./cancellation.js";

export interface PackPayload {
  setName: string | null;
  packTitle: string;
  stickers: Sticker[];
}

function installUrl(githubPath: string): string {
  return `https://github.com/${config.githubOwner}/${config.githubRepo}/tree/main/${githubPath}`;
}

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

export async function processPack(ctx: MyContext, payload: PackPayload): Promise<void> {
  const userId = ctx.from!.id;

  if (isRunning(userId)) {
    await ctx.reply(`${E.eyes} Уже обрабатываю предыдущий пак. Дождись.`, {
      ...HTML,
      reply_markup: backToMenuKeyboard(),
    });
    return;
  }
  startRun(userId);

  try {
    await runPack(ctx, userId, payload);
  } finally {
    endRun(userId);
  }
}

async function runPack(ctx: MyContext, userId: number, payload: PackPayload): Promise<void> {
  // Auto target: same source pack seen before for this user → merge into that skill. Else new skill.
  const existing = payload.setName
    ? findSkillByUserAndSetName(userId, payload.setName)
    : undefined;

  let skillId: number;
  let isNewSkill: boolean;
  let skillTitle: string;

  if (existing) {
    skillId = existing.id;
    isNewSkill = false;
    skillTitle = existing.title;
  } else {
    skillTitle = payload.packTitle;
    const slug = buildUniqueSlug(userId, skillTitle);
    const githubPath = `skills/${slug}`;
    skillId = createSkill({
      tgUserId: userId,
      slug,
      title: skillTitle,
      usageContext: "постов и сообщений в Telegram",
      githubPath,
    });
    isNewSkill = true;
  }

  // Dedupe
  const incomingIds = payload.stickers.map((s) => s.custom_emoji_id).filter((id): id is string => !!id);
  const existingIds = findExistingEmojiIds(skillId, incomingIds);
  const newStickers = payload.stickers.filter((s) => s.custom_emoji_id && !existingIds.has(s.custom_emoji_id));

  if (newStickers.length === 0) {
    await ctx.reply(
      `${E.eyes} Все ${payload.stickers.length} эмодзи уже есть в скилле «${skillTitle}». Добавлять нечего.`,
      { ...HTML, reply_markup: backToMenuKeyboard() },
    );
    return;
  }

  const progressMsg = await ctx.reply(`${E.box} Собираю скилл из ${newStickers.length} эмодзи…`, HTML);

  const packId = createPack({ skillId, setName: payload.setName, title: payload.packTitle });

  for (const s of newStickers) {
    insertEmoji({
      skillId,
      packId,
      customEmojiId: s.custom_emoji_id!,
      fallback: s.emoji ?? "❓",
      format: stickerFormat(s),
    });
  }

  const skillRow = getSkillById(skillId)!;
  const allEmojis = getEmojisForSkill(skillId);
  const skillMd = renderSkillMd(skillRow, allEmojis);
  const catalogMd = renderCatalog(skillRow.title, allEmojis);

  try {
    const sha = await publishFiles(
      [
        { path: `${skillRow.github_path}/SKILL.md`, content: skillMd },
        { path: `${skillRow.github_path}/references/emoji-catalog.md`, content: catalogMd },
      ],
      isNewSkill
        ? `Add skill ${skillRow.slug} (${allEmojis.length} emoji)`
        : `Update skill ${skillRow.slug}: +${newStickers.length} emoji`,
    );
    setSkillPublishedSha(skillId, sha);
    touchSkill(skillId);

    const skipped = payload.stickers.length - newStickers.length;
    const skippedLine = skipped > 0 ? `\nПропущено дублей: ${skipped}.` : "";
    await ctx.api.editMessageText(
      progressMsg.chat.id,
      progressMsg.message_id,
      `${E.check} Скилл «${skillRow.title}» опубликован — всего ${allEmojis.length} эмодзи (+${newStickers.length} новых).${skippedLine}\n\nУстановка:\n<code>npx skills add ${installUrl(skillRow.github_path)}</code>`,
      { ...HTML, reply_markup: backToMenuKeyboard() },
    );
  } catch (err) {
    console.error("Publish failed:", err);
    await ctx.api.editMessageText(
      progressMsg.chat.id,
      progressMsg.message_id,
      `${E.warn} Не удалось опубликовать в GitHub. Эмодзи сохранены — нажми, чтобы повторить.`,
      { ...HTML, reply_markup: retryPublishKeyboard(skillId) },
    );
  }
}

export async function retryPublish(skillId: number, ctx: MyContext): Promise<void> {
  const skillRow = getSkillById(skillId);
  if (!skillRow) {
    await ctx.reply(`${E.warn} Скилл не найден.`, { ...HTML, reply_markup: backToMenuKeyboard() });
    return;
  }
  const allEmojis = getEmojisForSkill(skillId);
  const skillMd = renderSkillMd(skillRow, allEmojis);
  const catalogMd = renderCatalog(skillRow.title, allEmojis);

  try {
    const sha = await publishFiles(
      [
        { path: `${skillRow.github_path}/SKILL.md`, content: skillMd },
        { path: `${skillRow.github_path}/references/emoji-catalog.md`, content: catalogMd },
      ],
      `Retry publish ${skillRow.slug}`,
    );
    setSkillPublishedSha(skillId, sha);
    touchSkill(skillId);
    await ctx.reply(
      `${E.check} Скилл «${skillRow.title}» опубликован.\n\nУстановка:\n<code>npx skills add ${installUrl(skillRow.github_path)}</code>`,
      { ...HTML, reply_markup: backToMenuKeyboard() },
    );
  } catch (err) {
    console.error("Retry publish failed:", err);
    await ctx.reply(`${E.warn} Снова не получилось.`, { ...HTML, reply_markup: retryPublishKeyboard(skillId) });
  }
}
