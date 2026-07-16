import type { EmojiRow, SkillRow } from "../db/repo.js";

export interface LangFile {
  path: string;
  content: string;
}

const ID_RE = /^\d+$/;

function safeTitle(title: string): string {
  return title.replace(/\*\//g, "").replace(/"""/g, "").replace(/[\r\n]+/g, " ").trim();
}

function buildFallbackMap(emojis: EmojiRow[]): Map<string, string[]> {
  const sorted = [...emojis].sort((a, b) => a.custom_emoji_id.localeCompare(b.custom_emoji_id));
  const map = new Map<string, string[]>();
  for (const row of sorted) {
    if (!ID_RE.test(row.custom_emoji_id)) {
      console.warn(`Skipping invalid custom_emoji_id: ${row.custom_emoji_id}`);
      continue;
    }
    if (/["\\\r\n]/.test(row.fallback)) {
      console.warn(`Skipping unsafe fallback char for id ${row.custom_emoji_id}`);
      continue;
    }
    const list = map.get(row.fallback);
    if (list) list.push(row.custom_emoji_id);
    else map.set(row.fallback, [row.custom_emoji_id]);
  }
  return map;
}

function renderGo(title: string, count: number, map: Map<string, string[]>): string {
  const entries = [...map.entries()]
    .map(([fallback, ids]) => `\t"${fallback}": {${ids.map((id) => `"${id}"`).join(", ")}},`)
    .join("\n");

  return `// Package emoji: generated from Telegram pack "${title}" (${count} emoji).
// Copy into your project; rename the package if needed. Do not edit by hand.
//
// Rendering requires parse_mode=HTML. Custom emoji display only when sent
// from a Telegram Premium account (or an eligible channel), not via a
// regular bot through the Bot API.
package emoji

import "html"

// Emoji maps a fallback character to the custom emoji IDs that use it.
var Emoji = map[string][]string{
${entries}
}

// TgEmoji returns the <tg-emoji> HTML tag for parse_mode=HTML messages.
func TgEmoji(id, fallback string) string {
	return \`<tg-emoji emoji-id="\` + id + \`">\` + html.EscapeString(fallback) + \`</tg-emoji>\`
}
`;
}

function renderPython(title: string, count: number, map: Map<string, string[]>): string {
  const entries = [...map.entries()]
    .map(([fallback, ids]) => `    "${fallback}": [${ids.map((id) => `"${id}"`).join(", ")}],`)
    .join("\n");

  return `"""Generated from Telegram pack "${title}" (${count} emoji). Do not edit by hand.

Rendering requires parse_mode=HTML. Custom emoji display only when sent
from a Telegram Premium account (or an eligible channel), not via a
regular bot through the Bot API.
"""

from html import escape

EMOJI: dict[str, list[str]] = {
${entries}
}


def tg_emoji(emoji_id: str, fallback: str) -> str:
    """Return the <tg-emoji> HTML tag for parse_mode=HTML messages."""
    return f'<tg-emoji emoji-id="{emoji_id}">{escape(fallback)}</tg-emoji>'
`;
}

function renderTypeScript(title: string, count: number, map: Map<string, string[]>): string {
  const entries = [...map.entries()]
    .map(([fallback, ids]) => `  "${fallback}": [${ids.map((id) => `"${id}"`).join(", ")}],`)
    .join("\n");

  return `/**
 * Generated from Telegram pack "${title}" (${count} emoji). Do not edit by hand.
 *
 * Rendering requires parse_mode=HTML. Custom emoji display only when sent
 * from a Telegram Premium account (or an eligible channel), not via a
 * regular bot through the Bot API.
 */

/** Maps a fallback character to the custom emoji IDs that use it. */
export const EMOJI: Record<string, readonly string[]> = {
${entries}
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Returns the <tg-emoji> HTML tag for parse_mode=HTML messages. */
export function tgEmoji(id: string, fallback: string): string {
  return \`<tg-emoji emoji-id="\${id}">\${escapeHtml(fallback)}</tg-emoji>\`;
}
`;
}

export function renderLangModules(skill: SkillRow, emojis: EmojiRow[]): LangFile[] {
  const title = safeTitle(skill.title);
  const map = buildFallbackMap(emojis);
  const count = emojis.length;

  return [
    { path: "references/lib/emoji.go", content: renderGo(title, count, map) },
    { path: "references/lib/emoji.py", content: renderPython(title, count, map) },
    { path: "references/lib/emoji.ts", content: renderTypeScript(title, count, map) },
  ];
}
