import { db } from "./index.js";

export function recordWorkerOptin(tgUserId: number, workerUsername: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO worker_optins (tg_user_id, worker_username) VALUES (?, ?)`,
  ).run(tgUserId, workerUsername);
}

export function getWorkerOptins(tgUserId: number): string[] {
  const rows = db
    .prepare(`SELECT worker_username FROM worker_optins WHERE tg_user_id = ?`)
    .all(tgUserId) as { worker_username: string }[];
  return rows.map((r) => r.worker_username);
}
