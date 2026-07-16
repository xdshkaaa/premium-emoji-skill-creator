import { config } from "../config.js";
import { normalizeHex } from "../media/color.js";

const DEFAULT_HEX = "#e91e63";
const TIMEOUT_MS = 30_000;

export interface PickColorParams {
  title: string;
  fallbacks: string[];
  previews?: string[]; // base64 png data (no data: prefix)
}

export interface PickColorResult {
  hex: string;
  reason: string;
  isFallback: boolean;
}

const SYSTEM_PROMPT =
  'You pick a single accent color for a Telegram custom-emoji sticker pack. ' +
  'Respond ONLY with strict JSON: {"hex":"#rrggbb","reason":"short reason in Russian"}. No markdown, no extra text.';

function buildUserText(params: PickColorParams): string {
  return `Pack title: "${params.title}". Sample emoji: ${params.fallbacks.slice(0, 20).join(" ")}. Pick one accent hex color that fits this pack's vibe.`;
}

async function callChat(body: unknown): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${config.AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.AI_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`AI API ${res.status}`);
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty AI response");
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseColorResponse(content: string): { hex: string; reason: string } | null {
  const stripped = content
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    const parsed = JSON.parse(stripped) as { hex?: string; reason?: string };
    if (parsed.hex) {
      const normalized = normalizeHex(parsed.hex);
      if (normalized) return { hex: normalized, reason: parsed.reason ?? "" };
    }
  } catch {
    // fall through to regex
  }
  const match = /#?[0-9a-f]{6}/i.exec(stripped);
  if (match) {
    const normalized = normalizeHex(match[0]);
    if (normalized) return { hex: normalized, reason: content.trim() };
  }
  return null;
}

export async function pickColorForPack(params: PickColorParams): Promise<PickColorResult> {
  if (!config.AI_API_KEY) {
    return { hex: DEFAULT_HEX, reason: "AI недоступен", isFallback: true };
  }

  // Attempt 1: with image previews, if available.
  if (params.previews && params.previews.length > 0) {
    try {
      const content = [
        { type: "text", text: buildUserText(params) },
        ...params.previews.slice(0, 3).map((b64) => ({
          type: "image_url",
          image_url: { url: `data:image/png;base64,${b64}` },
        })),
      ];
      const raw = await callChat({
        model: config.AI_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content },
        ],
      });
      const parsed = parseColorResponse(raw);
      if (parsed) return { hex: parsed.hex, reason: parsed.reason, isFallback: false };
    } catch {
      // fall through to text-only attempt
    }
  }

  // Attempt 2: text-only.
  try {
    const raw = await callChat({
      model: config.AI_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserText(params) },
      ],
    });
    const parsed = parseColorResponse(raw);
    if (parsed) return { hex: parsed.hex, reason: parsed.reason, isFallback: false };
  } catch {
    // fall through to default
  }

  return { hex: DEFAULT_HEX, reason: "Не удалось определить цвет, взял стандартный", isFallback: true };
}
