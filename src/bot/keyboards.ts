import { InlineKeyboard } from "grammy";

// Custom-emoji icon IDs (Unigram - @SOUICdsgn) — set via InlineKeyboardButton.icon_custom_emoji_id,
// not text markup, since inline keyboard button text has no parse_mode/HTML support.
const ICON = {
  gear: "5870982283724328568",
  back: "5870723666563566827",
  box: "5870528606328852614",
  eyes: "5870903672937911120",
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
