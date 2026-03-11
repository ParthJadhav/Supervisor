/** Shared RGB color map for project tinting — used by AgentNode and ProjectZone */

export const PROJECT_COLORS_RGB: Record<string, { r: number; g: number; b: number }> = {
  gray: { r: 180, g: 180, b: 192 },
  red: { r: 255, g: 110, b: 97 },
  orange: { r: 255, g: 150, b: 50 },
  amber: { r: 245, g: 158, b: 11 },
  green: { r: 52, g: 211, b: 153 },
  teal: { r: 45, g: 212, b: 191 },
  blue: { r: 96, g: 165, b: 250 },
  indigo: { r: 140, g: 145, b: 255 },
  purple: { r: 192, g: 132, b: 252 },
  pink: { r: 251, g: 113, b: 178 },
};

/** Tinted background: mixes a project color with near-black at the given alpha mix */
export function tintedBg(colorName: string | undefined, mix: number): string {
  if (!colorName) return "#0f0f0f";
  const c = PROJECT_COLORS_RGB[colorName];
  if (!c) return "#0f0f0f";
  const base = 15;
  const r = Math.round(base + (c.r - base) * mix);
  const g = Math.round(base + (c.g - base) * mix);
  const b = Math.round(base + (c.b - base) * mix);
  return `rgb(${r},${g},${b})`;
}

/** Solid dark tinted background — alias for tintedBg */
export function solidBg(colorName: string | undefined, mix: number): string {
  return tintedBg(colorName, mix);
}

/** Returns an rgba string for a project color */
export function rgba(colorName: string | undefined, alpha: number): string {
  if (!colorName) return `rgba(180,180,192,${alpha})`;
  const c = PROJECT_COLORS_RGB[colorName];
  if (!c) return `rgba(180,180,192,${alpha})`;
  return `rgba(${c.r},${c.g},${c.b},${alpha})`;
}

/** Tinted border color */
export function tintedBorder(colorName: string | undefined, alpha: number): string | undefined {
  if (!colorName) return undefined;
  const c = PROJECT_COLORS_RGB[colorName];
  if (!c) return undefined;
  return `rgba(${c.r},${c.g},${c.b},${alpha})`;
}
