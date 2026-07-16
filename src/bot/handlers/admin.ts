import { InlineKeyboard, type Bot } from "grammy";
import type { MyContext } from "../context.js";
import { config } from "../../config.js";
import { E } from "../emoji.js";
import {
  getAdminMetrics,
  getRecentSkills,
  getAdminSkill,
  deleteSkillCascade,
} from "../../db/adminRepo.js";

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
const SKILLS_LIMIT = 15;

function isAdmin(ctx: MyContext): boolean {
  return config.ADMIN_TG_ID !== undefined && ctx.from?.id === config.ADMIN_TG_ID;
}

function ownerLabel(username: string | null, tgUserId: number): string {
  return username ? `@${username}` : `id ${tgUserId}`;
}

function adminMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📊 Метрики", "admin:stats")
    .row()
    .text("📁 Скиллы", "admin:skills");
}

function backToAdminKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("◀️ В админку", "admin:menu");
}

function statsText(): string {
  const m = getAdminMetrics();
  const top =
    m.topUsers.length > 0
      ? m.topUsers
          .map((u, i) => `${i + 1}. ${ownerLabel(u.username, u.tg_user_id)}: ${u.skill_count}`)
          .join("\n")
      : "пока пусто";
  return `${E.gear} <b>Метрики</b>

Юзеров: <b>${m.users}</b> (+${m.usersDay} за 24ч, +${m.usersWeek} за 7д)
Скиллов: <b>${m.skills}</b> (+${m.skillsDay} за 24ч, +${m.skillsWeek} за 7д)
Паков: <b>${m.packs}</b>
Эмодзи: <b>${m.emojis}</b>
Не опубликовано: <b>${m.unpublishedSkills}</b>

<b>Топ юзеров по скиллам</b>
<blockquote>${top}</blockquote>`;
}

function skillsListView(): { text: string; keyboard: InlineKeyboard } {
  const skills = getRecentSkills(SKILLS_LIMIT);
  const keyboard = new InlineKeyboard();
  for (const s of skills) {
    const status = s.published_sha ? "" : " ❗️";
    keyboard.text(`${s.title}${status}`, `admin:skill:${s.id}`).row();
  }
  keyboard.text("◀️ В админку", "admin:menu");
  const text =
    skills.length === 0
      ? `${E.eyes} Скиллов пока нет.`
      : `${E.box} <b>Последние скиллы</b> (${skills.length})\n\n❗️ = публикация не завершена`;
  return { text, keyboard };
}

function skillCard(id: number): { text: string; keyboard: InlineKeyboard } | undefined {
  const s = getAdminSkill(id);
  if (!s) return undefined;
  const text = `${E.box} <b>${s.title}</b>

Slug: <code>${s.slug}</code>
Владелец: ${ownerLabel(s.owner_username, s.tg_user_id)}
Эмодзи: ${s.emoji_count}
Публикация: ${s.published_sha ? `${E.check} ${s.published_sha.slice(0, 7)}` : `${E.warn} не завершена`}
Путь: <code>${s.github_path}</code>
Создан: ${s.created_at}
Обновлён: ${s.updated_at}`;
  const keyboard = new InlineKeyboard()
    .text("🗑 Удалить", `admin:del:${id}`)
    .row()
    .text("◀️ К скиллам", "admin:skills");
  return { text, keyboard };
}

export function registerAdminHandlers(bot: Bot<MyContext>): void {
  bot.command("admin", async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.reply(`${E.gear} <b>Админка</b>`, { ...HTML, reply_markup: adminMenuKeyboard() });
  });

  bot.callbackQuery(/^admin:/, async (ctx, next) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCallbackQuery();
      return;
    }
    await next();
  });

  bot.callbackQuery("admin:menu", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`${E.gear} <b>Админка</b>`, {
      ...HTML,
      reply_markup: adminMenuKeyboard(),
    });
  });

  bot.callbackQuery("admin:stats", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(statsText(), { ...HTML, reply_markup: backToAdminKeyboard() });
  });

  bot.callbackQuery("admin:skills", async (ctx) => {
    await ctx.answerCallbackQuery();
    const { text, keyboard } = skillsListView();
    await ctx.editMessageText(text, { ...HTML, reply_markup: keyboard });
  });

  bot.callbackQuery(/^admin:skill:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const card = skillCard(Number(ctx.match[1]));
    if (!card) {
      const { text, keyboard } = skillsListView();
      await ctx.editMessageText(text, { ...HTML, reply_markup: keyboard });
      return;
    }
    await ctx.editMessageText(card.text, { ...HTML, reply_markup: card.keyboard });
  });

  bot.callbackQuery(/^admin:del:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const id = Number(ctx.match[1]);
    const keyboard = new InlineKeyboard()
      .text("❗️ Да, удалить", `admin:delyes:${id}`)
      .row()
      .text("◀️ Отмена", `admin:skill:${id}`);
    await ctx.editMessageText(
      `${E.warn} Удалить скилл из базы? Файлы в GitHub останутся.`,
      { ...HTML, reply_markup: keyboard },
    );
  });

  bot.callbackQuery(/^admin:delyes:(\d+)$/, async (ctx) => {
    const deleted = deleteSkillCascade(Number(ctx.match[1]));
    await ctx.answerCallbackQuery(deleted ? "Удалено" : "Уже нет в базе");
    const { text, keyboard } = skillsListView();
    await ctx.editMessageText(text, { ...HTML, reply_markup: keyboard });
  });
}
