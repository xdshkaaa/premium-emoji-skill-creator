import { InlineKeyboard } from "grammy";
import { GRADIENT_PRESETS } from "../media/gradients.js";

// Custom-emoji icon IDs (Unigram - @SOUICdsgn) — set via InlineKeyboardButton.icon_custom_emoji_id,
// not text markup, since inline keyboard button text has no parse_mode/HTML support.
const ICON = {
  gear: "5870982283724328568",
  back: "5870723666563566827",
  box: "5870528606328852614",
  eyes: "5870903672937911120",
  check: "5870633910337015697",
};

export function retryPublishKeyboard(skillId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("Повторить публикацию", `retry:${skillId}`)
    .icon(ICON.gear)
    .row()
    .text("В меню", "menu:back")
    .icon(ICON.back);
}

export function mainMenuKeyboard(isAdmin = false): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("Мои скиллы", "menu:skills")
    .icon(ICON.box)
    .row()
    .text("Как это работает", "menu:help")
    .icon(ICON.eyes);
  if (isAdmin) {
    kb.row().text("Админка", "admin:menu").icon(ICON.gear);
  }
  return kb;
}

export function backToMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("В меню", "menu:back").icon(ICON.back);
}

export function packChoiceKeyboard(token: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Создать скилл", `pk:skill:${token}`)
    .icon(ICON.box)
    .row()
    .text("Перекрасить", `pk:tint:${token}`)
    .icon(ICON.gear)
    .row()
    .text("В меню", "menu:back")
    .icon(ICON.back);
}

const COLOR_PRESETS: { hex: string; label: string }[] = [
  { hex: "e91e63", label: "Розовый" },
  { hex: "9c27b0", label: "Фиолетовый" },
  { hex: "3f51b5", label: "Индиго" },
  { hex: "2196f3", label: "Синий" },
  { hex: "009688", label: "Бирюзовый" },
  { hex: "4caf50", label: "Зелёный" },
  { hex: "ff9800", label: "Оранжевый" },
  { hex: "f44336", label: "Красный" },
];

export function colorMenuKeyboard(token: string, aiEnabled: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let i = 0; i < COLOR_PRESETS.length; i += 2) {
    const a = COLOR_PRESETS[i]!;
    const b = COLOR_PRESETS[i + 1];
    kb.text(a.label, `tint:${token}:${a.hex}`);
    if (b) kb.text(b.label, `tint:${token}:${b.hex}`);
    kb.row();
  }
  kb.text("🌈 Градиент", `tint:${token}:grad`);
  kb.row();
  kb.text("Свой HEX", `tint:${token}:custom`).icon(ICON.eyes);
  if (aiEnabled) {
    kb.text("ИИ выберет", `tint:${token}:ai`).icon(ICON.gear);
  }
  kb.row().text("В меню", "menu:back").icon(ICON.back);
  return kb;
}

export function gradientMenuKeyboard(token: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let i = 0; i < GRADIENT_PRESETS.length; i += 2) {
    const a = GRADIENT_PRESETS[i]!;
    const b = GRADIENT_PRESETS[i + 1];
    kb.text(a.label, `tint:${token}:g:${a.id}`);
    if (b) kb.text(b.label, `tint:${token}:g:${b.id}`);
    kb.row();
  }
  kb.text("Назад", `pk:tint:${token}`).icon(ICON.back);
  return kb;
}

export function confirmRecolorKeyboard(choiceToken: string, packToken: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Продолжить", `tgo:${choiceToken}`)
    .icon(ICON.check)
    .row()
    .text("Другой цвет", `pk:tint:${packToken}`)
    .icon(ICON.eyes)
    .row()
    .text("Отмена", "menu:back")
    .icon(ICON.back);
}

export function recolorDoneKeyboard(recoloredPackId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("Создать скилл", `rskill:${recoloredPackId}`)
    .icon(ICON.box)
    .row()
    .text("Готово", "menu:back")
    .icon(ICON.back);
}
