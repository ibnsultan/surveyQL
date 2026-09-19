/** Default categorical palette (10 muted, flat colours; green and slate first). */
export const PALETTE = [
  "#2f9e5b", // green
  "#7f8a96", // slate
  "#3b7ddd", // blue
  "#d99a2b", // amber
  "#c65d5d", // red
  "#8b6bd1", // violet
  "#2aa39c", // teal
  "#b8679f", // magenta
  "#7d9a2a", // olive
  "#5b7083", // steel
];

export function colorAt(i: number): string {
  return PALETTE[i % PALETTE.length];
}

export function colors(n: number): string[] {
  return Array.from({ length: n }, (_, i) => colorAt(i));
}
