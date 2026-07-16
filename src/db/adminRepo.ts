import { db } from "./index.js";
import type { SkillRow } from "./repo.js";

export interface AdminMetrics {
  users: number;
  skills: number;
  packs: number;
  emojis: number;
  usersDay: number;
  usersWeek: number;
  skillsDay: number;
  skillsWeek: number;
  unpublishedSkills: number;
  topUsers: { tg_user_id: number; username: string | null; skill_count: number }[];
}

function count(sql: string): number {
  return (db.prepare(sql).get() as { n: number }).n;
}

export function getAdminMetrics(): AdminMetrics {
  return {
    users: count(`SELECT COUNT(*) n FROM users`),
    skills: count(`SELECT COUNT(*) n FROM skills`),
    packs: count(`SELECT COUNT(*) n FROM packs`),
    emojis: count(`SELECT COUNT(*) n FROM emojis`),
    usersDay: count(`SELECT COUNT(*) n FROM users WHERE created_at >= datetime('now', '-1 day')`),
    usersWeek: count(`SELECT COUNT(*) n FROM users WHERE created_at >= datetime('now', '-7 day')`),
    skillsDay: count(`SELECT COUNT(*) n FROM skills WHERE created_at >= datetime('now', '-1 day')`),
    skillsWeek: count(`SELECT COUNT(*) n FROM skills WHERE created_at >= datetime('now', '-7 day')`),
    unpublishedSkills: count(`SELECT COUNT(*) n FROM skills WHERE published_sha IS NULL`),
    topUsers: db
      .prepare(
        `SELECT u.tg_user_id, u.username, COUNT(s.id) AS skill_count
         FROM users u JOIN skills s ON s.tg_user_id = u.tg_user_id
         GROUP BY u.tg_user_id ORDER BY skill_count DESC LIMIT 5`,
      )
      .all() as unknown as AdminMetrics["topUsers"],
  };
}

export interface AdminSkillRow extends SkillRow {
  owner_username: string | null;
  emoji_count: number;
}

export function getRecentSkills(limit: number): AdminSkillRow[] {
  return db
    .prepare(
      `SELECT s.*, u.username AS owner_username,
              (SELECT COUNT(*) FROM emojis e WHERE e.skill_id = s.id) AS emoji_count
       FROM skills s LEFT JOIN users u ON u.tg_user_id = s.tg_user_id
       ORDER BY s.updated_at DESC LIMIT ?`,
    )
    .all(limit) as unknown as AdminSkillRow[];
}

export function getAdminSkill(id: number): AdminSkillRow | undefined {
  return db
    .prepare(
      `SELECT s.*, u.username AS owner_username,
              (SELECT COUNT(*) FROM emojis e WHERE e.skill_id = s.id) AS emoji_count
       FROM skills s LEFT JOIN users u ON u.tg_user_id = s.tg_user_id
       WHERE s.id = ?`,
    )
    .get(id) as AdminSkillRow | undefined;
}

/** Deletes a skill with its packs and emojis in one transaction. DB only; GitHub untouched. */
export function deleteSkillCascade(id: number): boolean {
  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM emojis WHERE skill_id = ?`).run(id);
    db.prepare(`DELETE FROM packs WHERE skill_id = ?`).run(id);
    const result = db.prepare(`DELETE FROM skills WHERE id = ?`).run(id);
    db.exec("COMMIT");
    return result.changes > 0;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
