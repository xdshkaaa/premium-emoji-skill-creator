import { Bot } from "grammy";
import { config } from "../config.js";
import type { MyContext } from "./context.js";
import { registerStartHandlers } from "./handlers/start.js";
import { registerPackInputHandlers } from "./handlers/packInput.js";
import { registerAdminHandlers } from "./handlers/admin.js";
import { registerRecolorHandlers } from "./handlers/recolor.js";

export const bot = new Bot<MyContext>(config.BOT_TOKEN);

registerStartHandlers(bot);
registerAdminHandlers(bot);
registerRecolorHandlers(bot);
registerPackInputHandlers(bot);

bot.catch((err) => {
  console.error("Unhandled bot error:", err.error);
});
