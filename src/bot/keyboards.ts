import { InlineKeyboard } from "grammy";

export function retryPublishKeyboard(skillId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("⚙️ Повторить публикацию", `retry:${skillId}`)
    .row()
    .text("◀️ В меню", "menu:back");
}

export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📦 Мои скиллы", "menu:skills")
    .row()
    .text("⚙️ Опубликовать все неопубликованные", "menu:publish")
    .row()
    .text("👀 Как это работает", "menu:help");
}

export function backToMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("◀️ В меню", "menu:back");
}
