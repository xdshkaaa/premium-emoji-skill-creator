export interface GradientPreset {
  id: string;
  label: string;
  colors: [string, string, string];
}

export const GRADIENT_PRESETS: GradientPreset[] = [
  { id: "sunset", label: "🌅 Закат", colors: ["#E63946", "#F4A261", "#FFD700"] },
  { id: "ocean", label: "🌊 Океан", colors: ["#023E8A", "#0096C7", "#90E0EF"] },
  { id: "aurora", label: "💫 Аврора", colors: ["#7B2FBE", "#00B4D8", "#00F5D4"] },
  { id: "fire", label: "🔥 Огонь", colors: ["#6A040F", "#D62828", "#FCBF49"] },
  { id: "sakura", label: "🌸 Сакура", colors: ["#5C0A5E", "#C77DFF", "#FFCCD5"] },
  { id: "galaxy", label: "🌌 Галактика", colors: ["#03045E", "#7B2FBE", "#E040FB"] },
  { id: "forest", label: "🌿 Лес", colors: ["#0A2208", "#2D8B2D", "#C8E6C9"] },
  { id: "neon", label: "⚡ Неон", colors: ["#00D4FF", "#7B2FBE", "#FF006E"] },
  { id: "gold", label: "👑 Золото", colors: ["#7B5200", "#FFC300", "#FFF9C4"] },
  { id: "candy", label: "🍭 Конфета", colors: ["#FF0099", "#FF7B00", "#FFD700"] },
];

export function getGradientPreset(id: string): GradientPreset | undefined {
  return GRADIENT_PRESETS.find((g) => g.id === id);
}
