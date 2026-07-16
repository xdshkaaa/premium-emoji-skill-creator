import type { Bot } from "grammy";
import type { MyContext } from "../context.js";
import { upsertUser, getSkillsForUser } from "../../db/repo.js";
import { config } from "../../config.js";
import { retryPublish } from "../flow/buildSkill.js";
import { E } from "../emoji.js";
import { mainMenuKeyboard, backToMenuKeyboard } from "../keyboards.js";

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

function menuText(): string {
  return `${E.wave} Пришли ссылку на пак премиум-эмодзи вида https://t.me/addemoji/ИмяПака — и я соберу из него скилл для Claude Code.

Одиночные эмодзи не принимаю, только ссылка на весь пак.

Остальное — через кнопки ниже.`;
}

function helpText(): string {
  return `${E.eyes} Как это работает:

1. Присылаешь ссылку на пак эмодзи — https://t.me/addemoji/ИмяПака
2. Публикую скилл в GitHub и присылаю команду установки

Пришлёшь пак ещё раз позже — новые эмодзи домёржатся в тот же скилл, дубли пропустятся.
Если пак уже публиковал кто-то другой — отдам готовый скилл, новый не создаю.`;
}

async function showMenu(ctx: MyContext, edit: boolean): Promise<void> {
  const text = menuText();
  const opts = { ...HTML, reply_markup: mainMenuKeyboard() };
  if (edit && ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, opts);
  } else {
    await ctx.reply(text, opts);
  }
}

async function showSkills(ctx: MyContext, userId: number): Promise<void> {
  const skills = getSkillsForUser(userId);
  const opts = { ...HTML, reply_markup: backToMenuKeyboard() };
  if (skills.length === 0) {
    const text = `${E.eyes} Пока нет ни одного скилла. Пришли пак эмодзи, чтобы начать.`;
    if (ctx.callbackQuery) await ctx.editMessageText(text, opts);
    else await ctx.reply(text, opts);
    return;
  }
  const MAX_LISTED = 20;
  const shown = skills.slice(0, MAX_LISTED);
  const lines = shown.map((s) => {
    const installUrl = `https://github.com/${config.githubOwner}/${config.githubRepo}/tree/main/${s.github_path}`;
    const status = s.published_sha ? "" : " (публикация не завершена)";
    return `${E.check} ${s.title}${status}\n<code>npx skills add ${installUrl}</code>`;
  });
  const overflow = skills.length - shown.length;
  const overflowLine = overflow > 0 ? `\n\n…и ещё ${overflow}. Полный список — в GitHub-репозитории скиллов.` : "";
  const text = lines.join("\n\n") + overflowLine;
  if (ctx.callbackQuery) await ctx.editMessageText(text, opts);
  else await ctx.reply(text, opts);
}

async function publishPending(ctx: MyContext, userId: number): Promise<void> {
  const pending = getSkillsForUser(userId).filter((s) => !s.published_sha);
  if (pending.length === 0) {
    const text = `${E.check} Публиковать нечего — всё уже опубликовано.`;
    const opts = { ...HTML, reply_markup: backToMenuKeyboard() };
    if (ctx.callbackQuery) await ctx.editMessageText(text, opts);
    else await ctx.reply(text, opts);
    return;
  }
  let succeeded = 0;
  for (const skill of pending) {
    if (await retryPublish(skill.id, ctx)) succeeded++;
  }
  const failed = pending.length - succeeded;
  const summary =
    failed === 0
      ? `${E.check} Опубликовано: ${succeeded} из ${pending.length}.`
      : `${E.warn} Опубликовано: ${succeeded} из ${pending.length}. Не удалось: ${failed} — нажми «Повторить публикацию» на карточке скилла выше.`;
  await ctx.reply(summary, { ...HTML, reply_markup: backToMenuKeyboard() });
}

export function registerStartHandlers(bot: Bot<MyContext>): void {
  bot.command(["start", "menu", "help"], async (ctx) => {
    if (ctx.from) upsertUser(ctx.from.id, ctx.from.username ?? null);
    await showMenu(ctx, false);
  });

  bot.callbackQuery("menu:back", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMenu(ctx, true);
  });

  bot.callbackQuery("menu:skills", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    await showSkills(ctx, ctx.from.id);
  });

  bot.callbackQuery("menu:publish", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    await publishPending(ctx, ctx.from.id);
  });

  bot.callbackQuery("menu:help", async (ctx) => {
    await ctx.answerCallbackQuery();
    const opts = { ...HTML, reply_markup: backToMenuKeyboard() };
    await ctx.editMessageText(helpText(), opts);
  });
}
