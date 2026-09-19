/**
 * Terminal rendering of chart values: block-character bars in the palette colours over a dim
 * track, the values in a right-aligned column, a legend for several series and the scale
 * footnote. Same look as the web theme, in text. Colours use 24-bit ANSI escapes and are
 * skipped when the output is not a colour terminal.
 */
import type { ChartValue } from "../interpreter/values";
import { PALETTE } from "../visualization/palette";

export interface TermChartOptions {
  /** Emit ANSI colour codes. Default: detect from the environment. */
  color?: boolean;
  /** Total line width to fit into. Default: the terminal width, or 80. */
  width?: number;
}

const FULL = "█";
const LINE = "▬"; // series drawn as a line in the browser
const TRACK = "░";
const TRACK_COLOR = "#c9ced6";
const MUTED = "#6b7280";

/** True when stdout is a colour-capable terminal (honours NO_COLOR and FORCE_COLOR). */
export function colorEnabled(): boolean {
  const env = process.env;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
  return Boolean(process.stdout.isTTY) && env.TERM !== "dumb";
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function paint(text: string, hex: string, color: boolean): string {
  if (!color || !text) return text;
  const [r, g, b] = rgb(hex);
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

function num(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/** Text width ignoring escape codes. */
function visible(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function padEndVisible(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - visible(s)));
}

interface Row {
  label: string;
  /** One segment per series drawn in this row: [colour, share of the bar width 0..1, glyph]. */
  segments: [string, number, string][];
  value: string;
}

/** Draw one bar: coloured segments, then the track up to `barWidth`. */
function bar(segments: [string, number, string][], barWidth: number, color: boolean): string {
  let used = 0;
  let out = "";
  for (const [hex, share, glyph] of segments) {
    const cells = Math.max(share > 0 ? 1 : 0, Math.round(share * barWidth));
    const n = Math.min(cells, barWidth - used);
    out += paint(glyph.repeat(n), hex, color);
    used += n;
  }
  return out + paint(TRACK.repeat(Math.max(0, barWidth - used)), TRACK_COLOR, color);
}

/** Render a chart value as lines of text. */
export function renderChartText(v: ChartValue, opts: TermChartOptions = {}): string {
  const color = opts.color ?? colorEnabled();
  const width = Math.max(40, opts.width ?? (process.stdout.columns || 80));
  const { labels, series } = v.spec.data;
  const layout = v.spec.layout;
  const lines: string[] = [paint(layout.title, "#1f2430", false)];

  if (v.chartType === "gauge") {
    const stats = v.spec.stats ?? {};
    const value = Number(stats.avg ?? 0);
    const lo = Number(stats.min ?? 0);
    const hi = Number(stats.max ?? 0);
    const share = hi > lo ? Math.max(0, Math.min(1, (value - lo) / (hi - lo))) : 0;
    const barWidth = Math.min(50, width - 20);
    lines.push(`  ${bar([[PALETTE[0], share, FULL]], barWidth, color)}  ${num(value)}`);
    lines.push(paint(`  ${num(lo)} … ${num(hi)}`, MUTED, color));
    return lines.join("\n");
  }

  const isPie = v.chartType === "pie" || v.chartType === "doughnut";
  const independent = layout.scales === "independent";
  const stacks = seriesGroups(v);
  const groups = [...new Set(stacks)];

  // Group maxima: a stacked group by its tallest total, a lone series by its largest value.
  const groupMax = new Map<string, number>();
  labels.forEach((_, j) => {
    for (const g of groups) {
      const total = series.reduce((acc, s, i) => acc + (stacks[i] === g ? Math.abs(s.values[j] ?? 0) : 0), 0);
      groupMax.set(g, Math.max(groupMax.get(g) ?? 0, total));
    }
  });
  // Shared scale per axis side: a `right` series is on its own axis in the browser, so here too.
  const sideMax = (side: "left" | "right"): number =>
    Math.max(0, ...groups.filter((g) => series.some((s, i) => stacks[i] === g && (s.axis === "right") === (side === "right"))).map((g) => groupMax.get(g) ?? 0));
  const pieTotal = series[0]?.values.reduce((a, b) => a + b, 0) ?? 0;

  const rows: Row[] = [];
  labels.forEach((label, j) => {
    if (isPie) {
      const val = series[0].values[j];
      rows.push({ label, segments: [[PALETTE[j % PALETTE.length], pieTotal > 0 ? val / pieTotal : 0, FULL]], value: `${num(val)}  ${pieTotal > 0 ? ((val / pieTotal) * 100).toFixed(1) : "0.0"}%` });
      return;
    }
    for (const g of groups) {
      const members = series.map((s, i) => i).filter((i) => stacks[i] === g);
      const side = series[members[0]].axis === "right" ? "right" : "left";
      const scale = independent ? groupMax.get(g) || 1 : sideMax(side) || 1;
      const segments: [string, number, string][] = members.map((i) => [PALETTE[i % PALETTE.length], Math.abs(series[i].values[j] ?? 0) / scale, series[i].type === "line" ? LINE : FULL]);
      const values = members.map((i) => series[i].values[j] ?? 0);
      const value = members.length > 1 ? `${values.map(num).join(" + ")} = ${num(values.reduce((a, b) => a + b, 0))}` : num(values[0]);
      rows.push({ label: g === groups[0] ? label : "", segments, value });
    }
  });

  const labelWidth = Math.min(28, Math.max(...rows.map((r) => r.label.length), 1));
  const valueWidth = Math.max(...rows.map((r) => r.value.length), 1);
  const barWidth = Math.max(10, Math.min(60, width - labelWidth - valueWidth - 6));

  if (series.length > 1 && !isPie) {
    lines.push("  " + series.map((s, i) => `${paint("■", PALETTE[i % PALETTE.length], color)} ${s.label}`).join("   "));
  }
  for (const r of rows) {
    const label = r.label.length > labelWidth ? r.label.slice(0, labelWidth - 1) + "…" : r.label;
    lines.push(`  ${padEndVisible(label, labelWidth)}  ${bar(r.segments, barWidth, color)}  ${r.value}`);
  }
  if (independent) lines.push(paint("  each series to its own scale", MUTED, color));
  else if (series.some((s) => s.axis === "right")) lines.push(paint("  ▬ series on the right axis have their own scale", MUTED, color));
  if (layout.note) lines.push(paint(`  ${layout.note}`, MUTED, color));
  return lines.join("\n");
}

/** Stack group per series: series that share a `stack` are drawn in one bar, everything else stands alone. */
function seriesGroups(v: ChartValue): string[] {
  return v.spec.data.series.map((s, i) => s.stack ?? `#${i}`);
}
