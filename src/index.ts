import { existsSync } from "node:fs";
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const { config } = await import("./config.js");
const { checkRepoAccess } = await import("./publish/github.js");
await import("./db/index.js");
const { bot } = await import("./bot/bot.js");

try {
  await checkRepoAccess();
} catch (err) {
  console.error(
    `Cannot access GitHub repo ${config.githubOwner}/${config.githubRepo}. Create it and check GITHUB_TOKEN permissions.`,
  );
  console.error(err);
  process.exit(1);
}

await bot.api.setMyCommands([{ command: "start", description: "Меню" }]);

console.log("Bot starting (long polling)...");
bot.start({
  onStart: (info) => console.log(`Bot @${info.username} is running.`),
});
