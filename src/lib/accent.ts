/**
 * T116: ship accent colors must CONTRAST the world — the theme's base color
 * is excluded so the player never camouflages into their own track.
 * Pure hex/HSL math, no three.js (lib stays renderer-free).
 */

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = (h / 6 + 1) % 1
  }
  return { h, s, l }
}

export function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 1 / 6 ? [c, x, 0] : h < 2 / 6 ? [x, c, 0] : h < 3 / 6 ? [0, c, x] : h < 4 / 6 ? [0, x, c] : h < 5 / 6 ? [x, 0, c] : [c, 0, x]
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

/** circular hue distance, 0..0.5 */
export function hueDist(a: string, b: string): number {
  const d = Math.abs(hexToHsl(a).h - hexToHsl(b).h)
  return Math.min(d, 1 - d)
}

const SHIP_PALETTE = ['#2ff3ff', '#ff2fd6', '#ffd23d', '#ff5533', '#b4ff39', '#9d7bff']

/** pick the palette color farthest (min-dist) from BOTH theme colors */
export function pickShipAccent(themeEdge: string, themeGlow: string): string {
  let best = SHIP_PALETTE[0]
  let bestScore = -1
  for (const c of SHIP_PALETTE) {
    const score = Math.min(hueDist(c, themeEdge), hueDist(c, themeGlow))
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
}

/** nudge a color's hue away if it sits too close to the theme (NPCs) */
export function contrastShift(hex: string, themeEdge: string): string {
  if (hueDist(hex, themeEdge) > 0.11) return hex
  const { h, s, l } = hexToHsl(hex)
  return hslToHex((h + 0.33) % 1, s, l)
}
