import { Bot } from "grammy";
import { config } from "../config.js";
import type { MyContext } from "./context.js";
import { registerStartHandlers } from "./handlers/start.js";
import { registerPackInputHandlers } from "./handlers/packInput.js";

export const bot = new Bot<MyContext>(config.BOT_TOKEN);

registerStartHandlers(bot);
registerPackInputHandlers(bot);

bot.catch((err) => {
  console.error("Unhandled bot error:", err.error);
});
