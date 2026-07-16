import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import type { MyContext } from "../context.js";
import { upsertUser, getSkillsForUser, getSkillById } from "../../db/repo.js";
import { config } from "../../config.js";
import { E } from "../emoji.js";
import { mainMenuKeyboard, backToMenuKeyboard } from "../keyboards.js";

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

function menuText(): string {
  return `${E.wave} <b>Пришли ссылку на пак премиум-эмодзи.</b> Соберу из него скилл для Claude Code/Codex/Cursor и т.д.

<blockquote>Одиночные эмодзи не принимаю: нужна ссылка на весь пак.</blockquote>

Остальное: через кнопки ниже.`;
}

function helpText(): string {
  return `${E.eyes} <b>Как это работает</b>

1. Присылаешь ссылку на пак эмодзи: https://t.me/addemoji/ИмяПака
2. Отдаю ссылку на скилл и присылаю команду установки для установки скилла

<blockquote>Пришлёшь пак ещё раз позже: новые эмодзи домёржатся в тот же скилл, дубли пропустятся.
Если пак уже публиковал кто-то другой: отдам готовый скилл, новый не создаю.</blockquote>`;
}

function isAdmin(ctx: MyContext): boolean {
  return config.ADMIN_TG_ID !== undefined && ctx.from?.id === config.ADMIN_TG_ID;
}

async function showMenu(ctx: MyContext, edit: boolean): Promise<void> {
  const text = menuText();
  const opts = { ...HTML, reply_markup: mainMenuKeyboard(isAdmin(ctx)) };
  if (edit && ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, opts);
  } else {
    await ctx.reply(text, opts);
  }
}

function installUrl(githubPath: string): string {
  return `https://github.com/${config.githubOwner}/${config.githubRepo}/tree/main/${githubPath}`;
}

const MAX_LISTED = 30;

async function showSkills(ctx: MyContext, userId: number): Promise<void> {
  const skills = getSkillsForUser(userId);
  if (skills.length === 0) {
    const text = `${E.eyes} Пока нет ни одного скилла. Пришли пак эмодзи, чтобы начать.`;
    const opts = { ...HTML, reply_markup: backToMenuKeyboard() };
    if (ctx.callbackQuery) await ctx.editMessageText(text, opts);
    else await ctx.reply(text, opts);
    return;
  }

  const shown = skills.slice(0, MAX_LISTED);
  const keyboard = new InlineKeyboard();
  for (const s of shown) {
    const status = s.published_sha ? "" : " ❗️";
    keyboard.text(`${s.title}${status}`, `myskill:${s.id}`).row();
  }
  keyboard.text("В меню", "menu:back");

  const overflow = skills.length - shown.length;
  const overflowLine = overflow > 0 ? `\n\n<blockquote>…и ещё ${overflow}. Полный список смотри в GitHub-репозитории скиллов.</blockquote>` : "";
  const text = `${E.box} <b>Мои скиллы</b> (${skills.length})${overflowLine}`;
  const opts = { ...HTML, reply_markup: keyboard };
  if (ctx.callbackQuery) await ctx.editMessageText(text, opts);
  else await ctx.reply(text, opts);
}

async function showSkillCard(ctx: MyContext, userId: number, skillId: number): Promise<void> {
  const s = getSkillById(skillId);
  const backKeyboard = new InlineKeyboard().text("К скиллам", "menu:skills");
  if (!s || s.tg_user_id !== userId) {
    await ctx.editMessageText(`${E.warn} Скилл не найден.`, { ...HTML, reply_markup: backKeyboard });
    return;
  }
  const status = s.published_sha ? "" : "\n<i>Публикация не завершена</i>";
  const text = `${E.check} <b>${s.title}</b>${status}\n\n<code>npx skills add ${installUrl(s.github_path)}</code>`;
  await ctx.editMessageText(text, { ...HTML, reply_markup: backKeyboard });
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

  bot.callbackQuery(/^myskill:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;
    await showSkillCard(ctx, ctx.from.id, Number(ctx.match[1]));
  });

  bot.callbackQuery("menu:help", async (ctx) => {
    await ctx.answerCallbackQuery();
    const opts = { ...HTML, reply_markup: backToMenuKeyboard() };
    await ctx.editMessageText(helpText(), opts);
  });
}
