import type { DatabaseSync } from "node:sqlite";

const MIGRATIONS: string[] = [
  // v1: initial schema
  `
  CREATE TABLE users (
    tg_user_id INTEGER PRIMARY KEY,
    username TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_user_id INTEGER NOT NULL REFERENCES users(tg_user_id),
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    usage_context TEXT,
    github_path TEXT NOT NULL,
    published_sha TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE packs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id INTEGER NOT NULL REFERENCES skills(id),
    set_name TEXT,
    title TEXT,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (skill_id, set_name)
  );

  CREATE TABLE emojis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id INTEGER NOT NULL REFERENCES skills(id),
    pack_id INTEGER REFERENCES packs(id),
    custom_emoji_id TEXT NOT NULL,
    fallback TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('static','animated','video')),
    description TEXT,
    suggested_category TEXT,
    category TEXT,
    UNIQUE (skill_id, custom_emoji_id)
  );
  `,
  // v2: recolored packs
  `
  CREATE TABLE recolored_packs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_user_id INTEGER NOT NULL,
    source_set_name TEXT NOT NULL,
    new_set_name TEXT,
    color_hex TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('manual','ai')),
    status TEXT NOT NULL CHECK (status IN ('pending','done','failed')) DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_recolored_user ON recolored_packs(tg_user_id);
  `,
];

export function runMigrations(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  const currentVersion = row.user_version;
  for (let i = currentVersion; i < MIGRATIONS.length; i++) {
    const migration = MIGRATIONS[i]!;
    db.exec(migration);
    db.exec(`PRAGMA user_version = ${i + 1}`);
  }
}
