import type { EmojiRow } from "../db/repo.js";

function tgEmojiSnippet(row: EmojiRow): string {
  return `<tg-emoji emoji-id="${row.custom_emoji_id}">${row.fallback}</tg-emoji>`;
}

export function renderCatalog(title: string, emojis: EmojiRow[]): string {
  const sorted = [...emojis].sort((a, b) => a.custom_emoji_id.localeCompare(b.custom_emoji_id));

  const lines: string[] = [
    `# ${title} — emoji catalog`,
    "",
    `${sorted.length} emoji total.`,
    "",
    "| Fallback | Emoji ID | Snippet |",
    "|---|---|---|",
  ];

  for (const row of sorted) {
    lines.push(`| ${row.fallback} | ${row.custom_emoji_id} | \`${tgEmojiSnippet(row)}\` |`);
  }

  return lines.join("\n").trimEnd() + "\n";
}
