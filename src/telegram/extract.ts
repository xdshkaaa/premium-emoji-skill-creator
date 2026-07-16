import type { Message, MessageEntity } from "grammy/types";

const ADDEMOJI_RE = /t\.me\/addemoji\/([A-Za-z0-9_]+)/i;

export function extractAddEmojiSetName(text: string | undefined): string | null {
  if (!text) return null;
  const match = ADDEMOJI_RE.exec(text);
  return match ? match[1]! : null;
}

export function extractCustomEmojiIds(message: Message): string[] {
  const entities: MessageEntity[] = [
    ...(message.entities ?? []),
    ...(message.caption_entities ?? []),
  ];
  const ids = entities
    .filter((e): e is MessageEntity & { type: "custom_emoji"; custom_emoji_id: string } => e.type === "custom_emoji")
    .map((e) => e.custom_emoji_id);
  return [...new Set(ids)];
}
