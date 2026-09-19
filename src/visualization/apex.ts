/**
 * ApexCharts options built from the chart data. JSON-safe (no functions), so the same object can
 * be saved by the CLI and handed to `new ApexCharts(el, options)` in a browser; `renderApex` adds
 * number formatters at render time.
 *
 * One flat, dashboard-like look for every chart: muted colours, a grey track behind each bar,
 * no value axis or grid, the numbers printed at the end of the bars, monospace labels.
 */
import type { ChartLayout, ChartSeries } from "../interpreter/values";
import { colorAt, colors } from "./palette";

export interface ApexInput {
  chartType: string;
  labels: string[];
  series: ChartSeries[];
  layout: ChartLayout;
  /** Stack group per series (series charts with per-choice counts). */
  stacks?: string[];
  stats?: Record<string, number | number[]>;
}

export const THEME = {
  background: "#f4f6f8",
  track: "#e3e7ec",
  text: "#374151",
  muted: "#6b7280",
  grid: "#e3e7ec",
  font: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

/** Ratio between the largest and smallest series maximum beyond which one shared axis hides the small series. */
const SCALE_GAP = 20;

/**
 * True when series sharing one axis differ so much in magnitude that the small ones would be
 * invisible. Stacked choice counts (one stack group) are judged by the group's total.
 */
export function independentScales(series: ChartSeries[], layout: ChartLayout, stacks?: string[]): boolean {
  if (series.length < 2 || series.some((s) => s.axis === "right")) return false;
  if (layout.stacked && !stacks) return false; // one stack (matrix rows): a single scale by definition
  const maxes = [...groupMaxes(series, layout, stacks).values()].filter((m) => m > 0);
  if (maxes.length < 2) return false;
  return Math.max(...maxes) / Math.min(...maxes) >= SCALE_GAP;
}

/** Stack group of a series: its `stacks` entry, one shared stack for a stacked chart without groups, else itself. */
function groupOf(i: number, layout: ChartLayout, stacks?: string[]): string {
  return stacks?.[i] ?? (layout.stacked ? "#stack" : `#${i}`);
}

/** Largest value per stack group: a stacked group is measured by its tallest total, a lone series by its largest value. */
function groupMaxes(series: ChartSeries[], layout: ChartLayout, stacks?: string[]): Map<string, number> {
  const totals = new Map<string, number[]>();
  series.forEach((s, i) => {
    const key = groupOf(i, layout, stacks);
    const t = totals.get(key) ?? [];
    s.values.forEach((v, j) => (t[j] = (t[j] ?? 0) + Math.abs(v)));
    totals.set(key, t);
  });
  return new Map([...totals].map(([k, t]) => [k, Math.max(0, ...t)]));
}

/** Whitespace, in pixels, between the bars of one row when a row holds several groups. */
const GROUP_GAP = 4;

const HIDDEN_AXIS = { labels: { show: false }, axisTicks: { show: false }, axisBorder: { show: false } };

/** The scale footnote (`1 · very unsatisfied   5 · very satisfied`) as an x-axis title. */
function noteTitle(layout: ChartLayout): Record<string, unknown> {
  return layout.note ? { title: { text: layout.note, offsetY: 4, style: { color: THEME.muted, fontSize: "11px", fontWeight: 400 } } } : {};
}
const LEGEND = { fontSize: "12px", markers: { shape: "square", size: 5, strokeWidth: 0 }, itemMargin: { horizontal: 10 } };

function base(type: string, layout: ChartLayout, height?: number): Record<string, unknown> {
  return {
    chart: {
      type,
      height,
      toolbar: { show: false },
      animations: { enabled: false },
      fontFamily: THEME.font,
      foreColor: THEME.text,
      background: THEME.background,
      stacked: Boolean(layout.stacked),
    },
    title: { text: layout.title, align: "left", style: { fontSize: "13px", fontWeight: 600, color: THEME.text } },
    legend: { show: layout.legend, position: "top", horizontalAlign: "left", ...LEGEND },
    grid: { show: false, padding: { left: 8, right: 16, top: 4, bottom: 4 } },
    tooltip: { theme: "light", shared: true, intersect: false },
    // `value` is a blend strength (0–1) in ApexCharts 7: 0.08 darkens the hovered mark by 8%.
    states: { hover: { filter: { type: "darken", value: 0.08 } }, active: { filter: { type: "none" } } },
  };
}

/** Build ApexCharts options for a chart. */
export function apexOptions(input: ApexInput): Record<string, unknown> {
  const { chartType, labels, series, layout } = input;

  if (chartType === "pie" || chartType === "doughnut") {
    const s = series[0];
    return {
      ...base(chartType === "pie" ? "pie" : "donut", { ...layout, legend: true }, 280),
      series: s.values,
      labels,
      colors: colors(labels.length),
      legend: { show: true, position: "right", ...LEGEND },
      ...(layout.note ? { subtitle: { text: layout.note, align: "left", style: { color: THEME.muted, fontSize: "11px" } } } : {}),
      stroke: { width: 2, colors: [THEME.background] },
      dataLabels: { enabled: true, style: { fontSize: "12px", fontWeight: 500 }, dropShadow: { enabled: false } },
      plotOptions: { pie: { expandOnClick: false, donut: { size: "62%" } } },
    };
  }

  if (chartType === "gauge") {
    const stats = input.stats ?? {};
    const value = Number(stats.avg ?? series[0]?.values[0] ?? 0);
    const lo = Number(stats.min ?? 0);
    const hi = Number(stats.max ?? 0);
    const pct = hi > lo ? Math.max(0, Math.min(100, ((value - lo) / (hi - lo)) * 100)) : 0;
    return {
      ...base("radialBar", { ...layout, legend: false }, 230),
      series: [Math.round(pct * 100) / 100],
      labels: [`avg ${value} (${lo}–${hi})`],
      colors: [colorAt(0)],
      stroke: { lineCap: "butt" },
      plotOptions: {
        radialBar: {
          startAngle: -90,
          endAngle: 90,
          hollow: { size: "62%" },
          track: { background: THEME.track, strokeWidth: "100%" },
          dataLabels: {
            name: { show: true, offsetY: -4, fontSize: "12px", color: THEME.muted },
            value: { show: true, offsetY: -44, fontSize: "22px", fontWeight: 600, color: THEME.text },
          },
        },
      },
    };
  }

  const mixed = series.some((s) => s.type === "line") && series.some((s) => s.type !== "line");
  const allLine = chartType === "line" || (series.length > 0 && series.every((s) => s.type === "line"));
  const hasRight = series.some((s) => s.axis === "right");
  const horizontal = Boolean(layout.horizontal) && !allLine && !mixed;
  const independent = layout.scales === "independent";

  // A series stacked with others gets its label centred in white; a lone bar's value sits past its end.
  const stackedSeries = (i: number): boolean =>
    Boolean(layout.stacked) && series[i].type !== "line" && (!input.stacks || input.stacks.filter((g) => g === input.stacks![i]).length > 1);
  const anyStacked = series.some((_, i) => stackedSeries(i));
  const maxes = groupMaxes(series, layout, input.stacks);
  const groups = new Set(series.map((_, i) => groupOf(i, layout, input.stacks))).size;

  const apexSeries = series.map((s, i) => {
    const entry: Record<string, unknown> = { name: s.label, data: s.values };
    if (mixed || hasRight) entry.type = s.type === "line" ? "line" : "column";
    if (layout.stacked && input.stacks && s.type !== "line") entry.group = input.stacks[i];
    return entry;
  });

  const height = (horizontal ? Math.max(170, 80 + labels.length * (groups * 22 + 14)) : 300) + (layout.note ? 52 : 0);
  const options: Record<string, unknown> = {
    ...base(allLine ? "line" : mixed ? "line" : "bar", layout, height),
    series: apexSeries,
    colors: series.map((_, i) => colorAt(i)),
    stroke: { width: series.map((s) => (s.type === "line" || allLine ? 2 : 0)), curve: "straight" },
    markers: { size: allLine || mixed ? 4 : 0, strokeWidth: 0 },
    dataLabels: {
      enabled: true,
      style: { fontSize: "12px", fontWeight: 500, colors: series.map((_, i) => (stackedSeries(i) ? "#ffffff" : THEME.text)) },
      background: { enabled: false },
      dropShadow: { enabled: false },
    },
    plotOptions: {
      bar: {
        horizontal,
        borderRadius: 0,
        barHeight: "55%",
        columnWidth: chartType === "hist" ? "92%" : "55%",
        dataLabels: { position: anyStacked ? "center" : "top" },
      },
    },
  };

  if (horizontal) {
    // Every bar is followed by a grey "track" series that fills the row to the same end, so the
    // rows read as progress bars and the value can be printed in one right-aligned column: the
    // track's data label carries the real value (a group total for stacked choice counts).
    // `renderApex` supplies the text from `spec.data`; the JSON keeps the mapping in `track`.
    if (independent) {
      // ApexCharts has no multi-axis horizontal bars: plot each group as a percentage of its maximum.
      apexSeries.forEach((entry, i) => {
        const max = maxes.get(groupOf(i, layout, input.stacks)) || 1;
        entry.data = series[i].values.map((v) => Math.round((v / max) * 10000) / 100);
      });
    }
    const top = independent ? 100 : Math.max(0, ...maxes.values());
    const groupKeys = [...new Set(series.map((_, i) => groupOf(i, layout, input.stacks)))];
    const multi = groupKeys.length > 1;
    options.yaxis = { show: true, labels: { style: { fontSize: "12px" } } };
    apexSeries.forEach((entry, i) => (entry.group = groupOf(i, layout, input.stacks)));
    const tracks = groupKeys.map((g) => {
      const members = series.map((_, i) => i).filter((i) => groupOf(i, layout, input.stacks) === g);
      // Never zero: ApexCharts draws no label for an empty segment, and the label lives on the track.
      const data = labels.map((_, j) => {
        const used = members.reduce((acc, i) => acc + Math.abs((apexSeries[i].data as number[])[j] ?? 0), 0);
        return Math.max(top * 0.02, Math.round((top * 1.02 - used) * 100) / 100);
      });
      return { name: "", data, group: g, track: members };
    });
    const all = [...apexSeries, ...tracks];
    const trackIdx = tracks.map((_, k) => apexSeries.length + k);
    if (multi) {
      // Several bars per row: ApexCharts packs a row's groups edge to edge, so every point shrinks
      // its bar (and track) by GROUP_GAP to leave whitespace between them.
      for (const entry of all) {
        entry.data = (entry.data as number[]).map((y, j) => ({ x: labels[j], y, barHeightOffset: -GROUP_GAP }));
      }
    }
    // Labels: one bar per row prints its value on the track, right-aligned; several bars per row
    // print each value at the bar's end (ApexCharts cannot label the track of a grouped stack).
    // Stacked segments are labelled in their centre, where a total would collide.
    const labelled = anyStacked ? series.map((_, i) => i).filter((i) => stackedSeries(i)) : multi ? series.map((_, i) => i) : trackIdx;
    const onTrack = (i: number) => trackIdx.includes(i) || (multi && !stackedSeries(i));

    options.series = all;
    (options.chart as Record<string, unknown>).stacked = true;
    options.colors = [...series.map((_, i) => colorAt(i)), ...tracks.map(() => THEME.track)];
    options.stroke = { width: 0 };
    options.xaxis = { categories: labels, min: 0, max: top > 0 ? top * 1.2 : 1, ...HIDDEN_AXIS, ...noteTitle(layout) };
    options.dataLabels = {
      ...(options.dataLabels as object),
      enabledOnSeries: labelled,
      offsetX: anyStacked ? 0 : 4,
      textAnchor: anyStacked ? "middle" : "start",
      style: { fontSize: "12px", fontWeight: 500, colors: all.map((_, i) => (onTrack(i) ? THEME.text : "#ffffff")) },
    };
    (options.plotOptions as { bar: Record<string, unknown> }).bar = {
      ...(options.plotOptions as { bar: Record<string, unknown> }).bar,
      barHeight: multi ? "72%" : "55%",
      borderRadius: 3,
      borderRadiusApplication: "around",
      borderRadiusWhenStacked: "all",
      dataLabels: { position: anyStacked ? "center" : "top", hideOverflowingLabels: false },
      colors: {},
    };
    options.grid = { ...(options.grid as object), padding: { left: 8, right: 16, top: 4, bottom: layout.note ? 16 : 4 } };
    options.legend = layout.legend && series.length > 1 ? { ...(options.legend as object), customLegendItems: series.map((s) => s.label), markers: { ...LEGEND.markers, fillColors: series.map((_, i) => colorAt(i)) } } : { show: false };
    options.tooltip = { ...(options.tooltip as object), enabledOnSeries: series.map((_, i) => i), shared: false, intersect: true };
    options.states = { hover: { filter: { type: "none" } }, active: { filter: { type: "none" } } };
    return options;
  }

  // Vertical columns and lines: values above the points, a light baseline, no value axis.
  const decimals = (ss: ChartSeries[]): number => (Math.max(0, ...ss.flatMap((s) => s.values)) >= 10 ? 0 : 2);
  const headroom = (m: number): number => (m > 0 ? m * 1.2 : 1);
  options.xaxis = { categories: labels, axisTicks: { show: false }, axisBorder: { show: true, color: THEME.grid }, labels: { style: { fontSize: "12px" } }, ...noteTitle(layout) };
  if (allLine) options.grid = { ...(options.grid as object), padding: { left: 24, right: 24, top: 4, bottom: 4 } };
  options.dataLabels = { ...(options.dataLabels as object), offsetY: anyStacked ? 0 : -18 };
  if (hasRight) {
    // One y-axis per side, shown lightly since two scales need reading; series on the same side share it.
    const left = series.filter((s) => s.axis !== "right");
    const right = series.filter((s) => s.axis === "right");
    const seen = new Set<string>();
    options.yaxis = series.map((s) => {
      const side = s.axis === "right" ? "right" : "left";
      const anchor = (side === "right" ? right : left)[0].label;
      const show = !seen.has(side);
      seen.add(side);
      return { seriesName: anchor, opposite: side === "right", show, min: 0, forceNiceScale: true, decimalsInFloat: decimals(side === "right" ? right : left), labels: { style: { colors: THEME.muted } } };
    });
    options.grid = { ...(options.grid as object), show: true, borderColor: THEME.grid, xaxis: { lines: { show: false } } };
  } else if (independent) {
    const anchors = new Map<string, string>();
    options.yaxis = series.map((s, i) => {
      const group = groupOf(i, layout, input.stacks);
      if (!anchors.has(group)) anchors.set(group, s.label);
      return { seriesName: anchors.get(group), show: false, min: 0, max: headroom(maxes.get(group) ?? 0) };
    });
  } else {
    options.yaxis = { show: false, min: 0, max: headroom(Math.max(0, ...maxes.values())) };
  }
  return options;
}
