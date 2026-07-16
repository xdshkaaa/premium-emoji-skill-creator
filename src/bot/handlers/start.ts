import type { Bot } from "grammy";
import type { MyContext } from "../context.js";
import { upsertUser, getSkillsForUser } from "../../db/repo.js";
import { config } from "../../config.js";
import { E } from "../emoji.js";
import { mainMenuKeyboard, backToMenuKeyboard } from "../keyboards.js";

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

function menuText(): string {
  return `${E.wave} <b>Пришли ссылку на пак премиум-эмодзи</b> вида https://t.me/addemoji/ИмяПака. Соберу из него скилл для Claude Code.

<blockquote>Одиночные эмодзи не принимаю: нужна ссылка на весь пак.</blockquote>

Остальное: через кнопки ниже.`;
}

function helpText(): string {
  return `${E.eyes} <b>Как это работает</b>

1. Присылаешь ссылку на пак эмодзи: https://t.me/addemoji/ИмяПака
2. Публикую скилл в GitHub и присылаю команду установки

<blockquote>Пришлёшь пак ещё раз позже: новые эмодзи домёржатся в тот же скилл, дубли пропустятся.
Если пак уже публиковал кто-то другой: отдам готовый скилл, новый не создаю.</blockquote>`;
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
    const status = s.published_sha ? "" : " <i>(публикация не завершена)</i>";
    return `${E.check} <b>${s.title}</b>${status}\n<code>npx skills add ${installUrl}</code>`;
  });
  const overflow = skills.length - shown.length;
  const overflowLine = overflow > 0 ? `\n\n<blockquote>…и ещё ${overflow}. Полный список смотри в GitHub-репозитории скиллов.</blockquote>` : "";
  const text = lines.join("\n\n") + overflowLine;
  if (ctx.callbackQuery) await ctx.editMessageText(text, opts);
  else await ctx.reply(text, opts);
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

  bot.callbackQuery("menu:help", async (ctx) => {
    await ctx.answerCallbackQuery();
    const opts = { ...HTML, reply_markup: backToMenuKeyboard() };
    await ctx.editMessageText(helpText(), opts);
  });
}
