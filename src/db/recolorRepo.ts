import { db } from "./index.js";

export type RecolorMode = "manual" | "ai" | "gradient";
export type RecolorStatus = "pending" | "done" | "failed";

export interface RecoloredPackRow {
  id: number;
  tg_user_id: number;
  source_set_name: string;
  new_set_name: string | null;
  color_hex: string;
  mode: RecolorMode;
  status: RecolorStatus;
  created_at: string;
}

export function createRecoloredPackRow(params: {
  tgUserId: number;
  sourceSetName: string;
  colorHex: string;
  mode: RecolorMode;
}): number {
  const result = db
    .prepare(
      `INSERT INTO recolored_packs (tg_user_id, source_set_name, color_hex, mode)
       VALUES (?, ?, ?, ?)`,
    )
    .run(params.tgUserId, params.sourceSetName, params.colorHex, params.mode);
  return Number(result.lastInsertRowid);
}

export function finishRecoloredPack(id: number, newSetName: string): void {
  db.prepare(`UPDATE recolored_packs SET status = 'done', new_set_name = ? WHERE id = ?`).run(
    newSetName,
    id,
  );
}

export function failRecoloredPack(id: number): void {
  db.prepare(`UPDATE recolored_packs SET status = 'failed' WHERE id = ?`).run(id);
}

export function getRecoloredPackById(id: number): RecoloredPackRow | undefined {
  return db.prepare(`SELECT * FROM recolored_packs WHERE id = ?`).get(id) as
    | RecoloredPackRow
    | undefined;
}
