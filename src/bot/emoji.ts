/** Plain emoji for the bot's own messages.
 *  Bots cannot send <tg-emoji> entities (Telegram rejects them: DOCUMENT_INVALID).
 *  <tg-emoji> is only used inside generated skill catalogs, never in bot replies. */
export const E = {
  wave: "👋",
  gear: "⚙️",
  eyes: "👀",
  check: "✅",
  warn: "⚠️",
  box: "📦",
};
