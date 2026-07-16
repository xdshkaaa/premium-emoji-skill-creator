import { db } from "./index.js";

export type EmojiFormat = "static" | "animated" | "video";

export interface UserRow {
  tg_user_id: number;
  username: string | null;
  created_at: string;
}

export interface SkillRow {
  id: number;
  tg_user_id: number;
  slug: string;
  title: string;
  usage_context: string | null;
  github_path: string;
  published_sha: string | null;
  created_at: string;
  updated_at: string;
}

export interface PackRow {
  id: number;
  skill_id: number;
  set_name: string | null;
  title: string | null;
  added_at: string;
}

export interface EmojiRow {
  id: number;
  skill_id: number;
  pack_id: number | null;
  custom_emoji_id: string;
  fallback: string;
  format: EmojiFormat;
  description: string | null;
  suggested_category: string | null;
  category: string | null;
}

export function upsertUser(tgUserId: number, username: string | null): void {
  db.prepare(
    `INSERT INTO users (tg_user_id, username) VALUES (?, ?)
     ON CONFLICT(tg_user_id) DO UPDATE SET username = excluded.username`,
  ).run(tgUserId, username);
}

export function getSkillsForUser(tgUserId: number): SkillRow[] {
  return db
    .prepare(`SELECT * FROM skills WHERE tg_user_id = ? ORDER BY updated_at DESC`)
    .all(tgUserId) as unknown as SkillRow[];
}

export function getSkillById(id: number): SkillRow | undefined {
  return db.prepare(`SELECT * FROM skills WHERE id = ?`).get(id) as SkillRow | undefined;
}

export function getSkillBySlug(slug: string): SkillRow | undefined {
  return db.prepare(`SELECT * FROM skills WHERE slug = ?`).get(slug) as SkillRow | undefined;
}

/** Finds the skill this user already built from the same source pack, if any (for auto-merge). */
export function findSkillByUserAndSetName(
  tgUserId: number,
  setName: string,
): SkillRow | undefined {
  return db
    .prepare(
      `SELECT s.* FROM skills s
       JOIN packs p ON p.skill_id = s.id
       WHERE s.tg_user_id = ? AND p.set_name = ?
       ORDER BY s.updated_at DESC LIMIT 1`,
    )
    .get(tgUserId, setName) as SkillRow | undefined;
}

export function createSkill(params: {
  tgUserId: number;
  slug: string;
  title: string;
  usageContext: string | null;
  githubPath: string;
}): number {
  const result = db
    .prepare(
      `INSERT INTO skills (tg_user_id, slug, title, usage_context, github_path)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(params.tgUserId, params.slug, params.title, params.usageContext, params.githubPath);
  return Number(result.lastInsertRowid);
}

export function touchSkill(id: number): void {
  db.prepare(`UPDATE skills SET updated_at = datetime('now') WHERE id = ?`).run(id);
}

export function setSkillPublishedSha(id: number, sha: string | null): void {
  db.prepare(`UPDATE skills SET published_sha = ?, updated_at = datetime('now') WHERE id = ?`).run(
    sha,
    id,
  );
}

export function slugExists(slug: string): boolean {
  return !!db.prepare(`SELECT 1 FROM skills WHERE slug = ?`).get(slug);
}

export function createPack(params: {
  skillId: number;
  setName: string | null;
  title: string | null;
}): number {
  const result = db
    .prepare(`INSERT INTO packs (skill_id, set_name, title) VALUES (?, ?, ?)`)
    .run(params.skillId, params.setName, params.title);
  return Number(result.lastInsertRowid);
}

export function findExistingEmojiIds(skillId: number, customEmojiIds: string[]): Set<string> {
  if (customEmojiIds.length === 0) return new Set();
  const placeholders = customEmojiIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT custom_emoji_id FROM emojis WHERE skill_id = ? AND custom_emoji_id IN (${placeholders})`,
    )
    .all(skillId, ...customEmojiIds) as { custom_emoji_id: string }[];
  return new Set(rows.map((r) => r.custom_emoji_id));
}

export function insertEmoji(params: {
  skillId: number;
  packId: number;
  customEmojiId: string;
  fallback: string;
  format: EmojiFormat;
}): number {
  const result = db
    .prepare(
      `INSERT INTO emojis (skill_id, pack_id, custom_emoji_id, fallback, format)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(params.skillId, params.packId, params.customEmojiId, params.fallback, params.format);
  return Number(result.lastInsertRowid);
}

export function getEmojisForSkill(skillId: number): EmojiRow[] {
  return db
    .prepare(`SELECT * FROM emojis WHERE skill_id = ? ORDER BY custom_emoji_id`)
    .all(skillId) as unknown as EmojiRow[];
}
