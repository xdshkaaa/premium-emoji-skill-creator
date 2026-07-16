import { slugExists } from "../db/repo.js";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export function buildUniqueSlug(base: string): string {
  const root = (slugify(base) || "pack").slice(0, 60);
  if (!slugExists(root)) return root;
  for (let n = 2; n < 100; n++) {
    const candidate = `${root}-${n}`;
    if (!slugExists(candidate)) return candidate;
  }
  return `${root}-${Date.now()}`;
}
