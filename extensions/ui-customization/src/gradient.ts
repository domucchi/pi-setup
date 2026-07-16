/** Themed truecolor gradient for the logo (pure; parses RGB from theme ANSI). */

export type Rgb = [number, number, number];
const RESET = "\x1b[0m";

/** Extract r,g,b from a truecolor SGR string like "\x1b[38;2;120;80;200m". */
export function parseRgb(ansi: string): Rgb | null {
  const m = ansi.match(/38;2;(\d+);(\d+);(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function mix(c1: Rgb, c2: Rgb, t: number): Rgb {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

/**
 * Color a logo line with a diagonal gradient from c1 to c2 (spaces kept
 * blank). row/totalRows shifts the gradient down the block so it reads as
 * a soft diagonal sheen rather than flat fill.
 */
export function gradientLine(
  text: string,
  row: number,
  totalRows: number,
  c1: Rgb,
  c2: Rgb,
): string {
  const chars = [...text];
  const span = Math.max(chars.length - 1, 1);
  const rowT = totalRows > 1 ? row / (totalRows - 1) : 0;
  return chars
    .map((ch, col) => {
      if (ch === " ") return ch;
      const t = Math.min(1, (col / span) * 0.65 + rowT * 0.35);
      const [r, g, b] = mix(c1, c2, t);
      return `\x1b[38;2;${r};${g};${b}m${ch}${RESET}`;
    })
    .join("");
}

/**
 * Render the logo with a themed gradient, falling back to a flat color
 * when truecolor isn't available or the colors can't be parsed.
 */
export function gradientLogo(
  logo: string[],
  fromAnsi: string,
  toAnsi: string,
  truecolor: boolean,
  flat: (line: string) => string,
): string[] {
  const c1 = parseRgb(fromAnsi);
  const c2 = parseRgb(toAnsi);
  if (!truecolor || !c1 || !c2) return logo.map(flat);
  return logo.map((line, row) => gradientLine(line, row, logo.length, c1, c2));
}
