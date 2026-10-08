// Ready-made colours shown in the task form (the full picker and hex box allow any colour)
export const PRESET_COLORS = [
  "#f4675e", "#f08a4b", "#d1964a", "#e3c34f", "#7cb342", "#3a9d6e",
  "#26a69a", "#3f9bd8", "#4858a3", "#7e57c2", "#c658a1", "#78909c",
];

// "#4858A3", "4858a3" or "48a" -> "#4858a3". Returns "" if it is not a valid hex colour.
export function normalizeHex(value) {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value || "").trim());
  if (!match) return "";
  let hex = match[1].toLowerCase();
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  return `#${hex}`;
}

// CSS variables for a coloured task (only call this with a normalized hex)
export function colorStyle(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `--task-color:${hex};--task-tint:rgba(${r},${g},${b},0.14);--task-tint-strong:rgba(${r},${g},${b},0.22)`;
}