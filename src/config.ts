import { z } from "zod";

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN missing"),
  GITHUB_TOKEN: z.string().min(1, "GITHUB_TOKEN missing"),
  GITHUB_SKILLS_REPO: z
    .string()
    .regex(/^[^/\s]+\/[^/\s]+$/, "GITHUB_SKILLS_REPO must be owner/repo"),
  DB_PATH: z.string().default("data/bot.sqlite"),
  ADMIN_TG_ID: z.coerce.number().int().positive().optional(),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().url().default("https://cheapvibecode.ru/v1"),
  AI_MODEL: z.string().default("mimo-v2.5"),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
});

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:");
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  const [githubOwner, githubRepo] = parsed.data.GITHUB_SKILLS_REPO.split("/");
  return { ...parsed.data, githubOwner: githubOwner!, githubRepo: githubRepo! };
}

export const config = loadConfig();
export type Config = typeof config;
