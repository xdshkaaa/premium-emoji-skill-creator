import type { Bot } from "grammy";
import type { MyContext } from "../bot/context.js";
import { config } from "../config.js";

export async function downloadTgFile(bot: Bot<MyContext>, fileId: string): Promise<Buffer> {
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) throw new Error(`No file_path for file_id ${fileId}`);
  const url = `https://api.telegram.org/file/bot${config.BOT_TOKEN}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download file ${fileId}: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
