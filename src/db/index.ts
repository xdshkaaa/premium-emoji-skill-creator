import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";
import { runMigrations } from "./migrations.js";

mkdirSync(dirname(config.DB_PATH), { recursive: true });

export const db = new DatabaseSync(config.DB_PATH);
runMigrations(db);
