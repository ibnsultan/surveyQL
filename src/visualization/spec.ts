import { DslError } from "../lang/errors";
import type { ChartLayout, ChartSeries, ChartSpec, ChartValue } from "../interpreter/values";
import { round } from "../surveycore/coerce";
import type { Column, Dataset } from "../surveycore/dataset";
import * as S from "../surveycore/stats";
import { apexOptions, independentScales } from "./apex";

export type ChartKind = "bar" | "vbar" | "pie" | "doughnut" | "hist" | "gauge" | "line";

export const CHART_KINDS: ChartKind[] = ["bar", "vbar", "pie", "doughnut", "hist", "gauge", "line"];

export interface SpecOptions {
  bins?: number;
  title?: string;
}

const CATEGORICAL = new Set(["category", "multi", "boolean"]);

/** Build the chart of one question's distribution. */
export function buildChartSpec(kind: ChartKind, col: Column, ds: Dataset, opts: SpecOptions = {}): ChartValue {
  const title = opts.title ?? col.title;
  let spec: ChartSpec;

  switch (kind) {
    case "hist":
      spec = histogramSpec(col, ds, opts.bins, title);
      break;
    case "gauge":
      spec = gaugeSpec(col, ds, title);
      break;
    case "line":
      spec = lineSpec(col, ds, opts.bins, title);
      break;
    default:
      spec = categoricalSpec(kind, col, ds, title);
  }

  return { kind: "chart", chartType: kind, question: col.key, title, spec, dataset: ds };
}

/** Assemble a spec: the plotted data, its layout, and the ApexCharts options built from them. */
function makeSpec(chartType: ChartKind, layout: ChartLayout, data: { labels: string[]; series: ChartSeries[] }, stats?: Record<string, number | number[]>): ChartSpec {
  layout = { ...layout, scales: independentScales(data.series, layout) ? "independent" : "shared" };
  return { mode: "distribution", layout, data, stats, apex: apexOptions({ chartType, labels: data.labels, series: data.series, layout, stats }) };
}

/** `1 · very unsatisfied   5 · very satisfied` for a rating question that describes its ends. */
export function scaleNote(col: Column): string | undefined {
  if (col.questionType !== "rating" || !col.choices?.length) return undefined;
  const q = col.question as unknown as { minRateDescription?: string; maxRateDescription?: string } | undefined;
  const lo = q?.minRateDescription?.trim();
  const hi = q?.maxRateDescription?.trim();
  if (!lo && !hi) return undefined;
  const first = col.choices[0].text;
  const last = col.choices[col.choices.length - 1].text;
  return [lo ? `${first} · ${lo}` : "", hi ? `${last} · ${hi}` : ""].filter(Boolean).join("   ");
}

function requireNumeric(kind: string, col: Column): void {
  if (col.type === "number" || col.type === "date" || col.questionType === "rating") return;
  throw new DslError(`${kind}: '${col.key}' is a ${col.type} question, not numeric; try 'draw bar(${col.key})'`);
}

function categoricalSpec(kind: "bar" | "vbar" | "pie" | "doughnut", col: Column, ds: Dataset, title: string): ChartSpec {
  if (col.type === "object" && col.questionType === "matrix") return matrixSpec(kind, col, ds, title);
  if (!CATEGORICAL.has(col.type) && col.questionType !== "rating") {
    const hint = col.type === "number" ? `; try 'draw hist(${col.key})'` : "";
    throw new DslError(`${kind}: '${col.key}' is a ${col.type} question and cannot be charted as categories${hint}`);
  }
  const f = S.frequency(ds, col);
  const isPie = kind === "pie" || kind === "doughnut";
  return makeSpec(kind, { title, horizontal: kind === "bar", legend: isPie, note: scaleNote(col) }, { labels: f.labels, series: [{ label: "Responses", values: f.counts }] }, { answered: f.answered, missing: f.missing });
}

function matrixSpec(kind: "bar" | "vbar" | "pie" | "doughnut", col: Column, ds: Dataset, title: string): ChartSpec {
  const m = S.matrixFrequency(ds, col);
  if (kind === "pie" || kind === "doughnut") {
    // A pie of a matrix: totals per column across all rows.
    const totals = m.columnLabels.map((_, j) => m.counts.reduce((acc, r) => acc + r[j], 0));
    return makeSpec(kind, { title, legend: true }, { labels: m.columnLabels, series: [{ label: "Responses", values: totals }] });
  }
  // One stacked series per matrix column, one bar per matrix row.
  const series = m.columnLabels.map((label, j) => ({ label, values: m.counts.map((r) => r[j]), stack: col.key }));
  return makeSpec(kind, { title, horizontal: kind === "bar", stacked: true, legend: true }, { labels: m.rowLabels, series });
}

function histogramSpec(col: Column, ds: Dataset, bins: number | undefined, title: string): ChartSpec {
  requireNumeric("hist", col);
  const xs = ds.numbers(col);
  const h = S.histogram(xs, bins);
  return makeSpec("hist", { title, legend: false }, { labels: h.labels, series: [{ label: "Responses", values: h.counts }] }, {
    n: xs.length,
    min: S.min(xs) ?? 0,
    max: S.max(xs) ?? 0,
    avg: round(S.avg(xs) ?? 0),
    edges: h.edges,
  });
}

function lineSpec(col: Column, ds: Dataset, bins: number | undefined, title: string): ChartSpec {
  // Ratings have their own scale values; other numbers are binned.
  const binned = (col.type === "number" && col.questionType !== "rating") || col.type === "date";
  const base = binned ? histogramSpec(col, ds, bins, title) : categoricalSpec("vbar", col, ds, title);
  base.layout = { ...base.layout, horizontal: false };
  base.apex = apexOptions({ chartType: "line", labels: base.data.labels, series: base.data.series, layout: base.layout, stats: base.stats });
  return base;
}

function gaugeSpec(col: Column, ds: Dataset, title: string): ChartSpec {
  requireNumeric("gauge", col);
  const xs = ds.numbers(col);
  const avg = S.avg(xs);
  const choiceValues = (col.choices ?? []).map((c) => Number(c.value)).filter((n) => Number.isFinite(n));
  const lo = choiceValues.length ? Math.min(...choiceValues) : (S.min(xs) ?? 0);
  const hi = choiceValues.length ? Math.max(...choiceValues) : (S.max(xs) ?? 0);
  const value = avg === null ? 0 : round(avg);
  return makeSpec("gauge", { title: `${title}: avg ${value} (${lo}–${hi})`, legend: false }, { labels: ["Average"], series: [{ label: "Average", values: [value] }] }, {
    avg: value,
    min: lo,
    max: hi,
    n: xs.length,
  });
}
