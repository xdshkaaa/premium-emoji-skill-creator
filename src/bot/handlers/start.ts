import type { Bot } from "grammy";
import type { MyContext } from "../context.js";
import { upsertUser, getSkillsForUser } from "../../db/repo.js";
import { config } from "../../config.js";
import { retryPublish } from "../flow/buildSkill.js";
import { E } from "../emoji.js";
import { mainMenuKeyboard, backToMenuKeyboard } from "../keyboards.js";

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

function menuText(): string {
  return `${E.wave} Пришли пак премиум-эмодзи — ссылку вида https://t.me/addemoji/ИмяПака, или сообщение с премиум-эмодзи — и я соберу из него скилл для Claude Code.

Остальное — через кнопки ниже.`;
}

function helpText(): string {
  return `${E.eyes} Как это работает:

1. Присылаешь ссылку на пак эмодзи или сообщение с премиум-эмодзи
2. Я скачиваю, распознаю каждый эмодзи и раскладываю по категориям — без вопросов
3. Публикую готовый скилл в GitHub и присылаю команду установки

Пришлёшь пак ещё раз позже — новые эмодзи домёржатся в тот же скилл, дубли пропустятся.`;
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
  const lines = skills.map((s) => {
    const installUrl = `https://github.com/${config.githubOwner}/${config.githubRepo}/tree/main/${s.github_path}`;
    const status = s.published_sha ? "" : " (публикация не завершена)";
    return `${E.check} ${s.title}${status}\n<code>npx skills add ${installUrl}</code>`;
  });
  const text = lines.join("\n\n");
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
  for (const skill of pending) {
    await retryPublish(skill.id, ctx);
  }
  await ctx.reply(`${E.eyes} Готово.`, { ...HTML, reply_markup: backToMenuKeyboard() });
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
