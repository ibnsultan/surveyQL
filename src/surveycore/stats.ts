import { asArray, isEmpty, looseEquals, round, toNumber } from "./coerce";
import type { Column, Dataset, Row } from "./dataset";

export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

export function avg(xs: number[]): number | null {
  return xs.length ? sum(xs) / xs.length : null;
}

export function min(xs: number[]): number | null {
  return xs.length ? Math.min(...xs) : null;
}

export function max(xs: number[]): number | null {
  return xs.length ? Math.max(...xs) : null;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function stddev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = avg(xs)!;
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}

export function countNonEmpty(ds: Dataset, col: Column): number {
  let n = 0;
  for (const row of ds.rows) if (!isEmpty(col.get(row))) n++;
  return n;
}

export interface Frequency {
  /** Raw values in display order. */
  values: unknown[];
  labels: string[];
  counts: number[];
  /** Percent of respondents (non-empty answers) that gave each value. */
  percents: number[];
  /** Respondents with a non-empty answer. */
  answered: number;
  missing: number;
}

/** Frequency table for a categorical, multi-select, boolean or rating column. */
export function frequency(ds: Dataset, col: Column): Frequency {
  const order: unknown[] = col.choices ? col.choices.map((c) => c.value) : [];
  const counts = new Map<string, { value: unknown; count: number }>();
  const keyOf = (v: unknown) => (typeof v === "string" ? `s:${v}` : typeof v === "boolean" ? `b:${v}` : `n:${String(v)}`);
  for (const v of order) counts.set(keyOf(v), { value: v, count: 0 });

  let answered = 0;
  let missing = 0;
  for (const row of ds.rows) {
    const raw = col.get(row);
    if (isEmpty(raw)) {
      missing++;
      continue;
    }
    answered++;
    for (const v of asArray(raw)) {
      const known = order.find((o) => looseEquals(o, v));
      const k = keyOf(known !== undefined ? known : v);
      const entry = counts.get(k);
      if (entry) entry.count++;
      else counts.set(k, { value: v, count: 1 });
    }
  }

  const entries = [...counts.values()];
  // Unknown values (not in choices) are sorted by count after the known ones.
  const known = entries.slice(0, order.length);
  const unknown = entries.slice(order.length).sort((a, b) => b.count - a.count);
  const all = order.length ? [...known, ...unknown] : sortNatural(entries);

  return {
    values: all.map((e) => e.value),
    labels: all.map((e) => ds.label(col, e.value)),
    counts: all.map((e) => e.count),
    percents: all.map((e) => (answered ? round((e.count / answered) * 100, 1) : 0)),
    answered,
    missing,
  };
}

function sortNatural(entries: { value: unknown; count: number }[]): { value: unknown; count: number }[] {
  const allNumeric = entries.every((e) => toNumber(e.value) !== null);
  if (allNumeric) return [...entries].sort((a, b) => toNumber(a.value)! - toNumber(b.value)!);
  return [...entries].sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
}

export interface MatrixFrequency {
  rowLabels: string[];
  columnLabels: string[];
  /** counts[row][column] */
  counts: number[][];
}

/** Row x column counts for a single-choice matrix question. */
export function matrixFrequency(ds: Dataset, col: Column): MatrixFrequency {
  const rowCols = ds.columns.filter((c) => c.path.length === 2 && c.path[0] === col.path[0] && c.type === "category");
  const columnLabels = (col.choices ?? []).map((c) => c.text);
  const counts = rowCols.map((rc) => {
    const f = frequency(ds, rc);
    return (col.choices ?? []).map((choice) => {
      const idx = f.values.findIndex((v) => looseEquals(v, choice.value));
      return idx >= 0 ? f.counts[idx] : 0;
    });
  });
  return { rowLabels: rowCols.map((rc) => rc.title.replace(`${col.title}: `, "")), columnLabels, counts };
}

export interface Histogram {
  edges: number[];
  labels: string[];
  counts: number[];
}

/** Equal-width histogram. Default bin count is min(10, ceil(sqrt(n))). */
export function histogram(xs: number[], bins?: number): Histogram {
  if (!xs.length) return { edges: [], labels: [], counts: [] };
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const n = Math.max(1, bins ?? Math.min(10, Math.ceil(Math.sqrt(xs.length))));
  if (lo === hi) return { edges: [lo, hi], labels: [String(lo)], counts: [xs.length] };
  const width = (hi - lo) / n;
  const edges = Array.from({ length: n + 1 }, (_, i) => lo + i * width);
  const counts = new Array(n).fill(0);
  for (const x of xs) {
    let i = Math.floor((x - lo) / width);
    if (i >= n) i = n - 1;
    counts[i]++;
  }
  const fmt = (v: number) => String(round(v, 2));
  const labels = counts.map((_, i) => `${fmt(edges[i])}–${fmt(edges[i + 1])}`);
  return { edges, labels, counts };
}

/** Group rows by the value of a column. Multi-select rows appear in every group they belong to. */
export function groupBy(ds: Dataset, col: Column): { label: string; value: unknown; dataset: Dataset }[] {
  const groups = new Map<string, { label: string; value: unknown; rows: Row[] }>();
  const order: unknown[] = col.choices ? col.choices.map((c) => c.value) : [];
  for (const v of order) groups.set(String(v), { label: ds.label(col, v), value: v, rows: [] });
  for (const row of ds.rows) {
    const raw = col.get(row);
    if (isEmpty(raw)) continue;
    for (const v of asArray(raw)) {
      const known = order.find((o) => looseEquals(o, v));
      const key = String(known !== undefined ? known : v);
      let g = groups.get(key);
      if (!g) {
        g = { label: ds.label(col, v), value: v, rows: [] };
        groups.set(key, g);
      }
      g.rows.push(row);
    }
  }
  return [...groups.values()].filter((g) => g.rows.length > 0).map((g) => ({ label: g.label, value: g.value, dataset: ds.withRows(g.rows) }));
}

export interface Description {
  type: string;
  n: number;
  missing: number;
  stats: Record<string, number | string | null>;
}

export function describe(ds: Dataset, col: Column): Description {
  const n = countNonEmpty(ds, col);
  const missing = ds.rows.length - n;
  if (col.type === "number" || col.type === "date") {
    const xs = ds.numbers(col);
    return {
      type: col.type,
      n,
      missing,
      stats: {
        mean: avg(xs) === null ? null : round(avg(xs)!),
        median: median(xs),
        min: min(xs),
        max: max(xs),
        stddev: stddev(xs) === null ? null : round(stddev(xs)!),
      },
    };
  }
  if (col.type === "category" || col.type === "multi" || col.type === "boolean") {
    const f = frequency(ds, col);
    let top = -1;
    f.counts.forEach((c, i) => {
      if (top < 0 || c > f.counts[top]) top = i;
    });
    return {
      type: col.type,
      n,
      missing,
      stats: {
        distinct: f.values.length,
        top: top >= 0 ? f.labels[top] : null,
        "top count": top >= 0 ? f.counts[top] : null,
      },
    };
  }
  if (col.type === "text") {
    const lengths = ds.rows.map((r) => col.get(r)).filter((v) => !isEmpty(v)).map((v) => String(v).length);
    return { type: col.type, n, missing, stats: { "avg length": avg(lengths) === null ? null : round(avg(lengths)!, 1) } };
  }
  return { type: col.type, n, missing, stats: {} };
}

export type SeriesAgg = "value" | "count" | "nonempty" | "avg" | "sum" | "min" | "max" | "median" | "stddev";

export interface SeriesResult {
  labels: string[];
  values: number[];
  /** Number of groups whose key value repeated (0 when every key is unique). */
  repeated: number;
}

const AGG_FN: Record<Exclude<SeriesAgg, "value" | "count" | "nonempty">, (xs: number[]) => number | null> = {
  avg,
  sum: (xs) => (xs.length ? sum(xs) : null),
  min,
  max,
  median,
  stddev,
};

/** Apply a named numeric aggregate. */
export function aggregate(agg: Exclude<SeriesAgg, "value" | "count" | "nonempty">, xs: number[]): number | null {
  return AGG_FN[agg](xs);
}

/** True when some value of `key` appears in more than one response. */
export function keyRepeats(ds: Dataset, key: Column): boolean {
  return groupBy(ds, key).some((g) => g.dataset.rows.length > 1);
}

/**
 * One numeric series per group of `key`. `agg: "value"` reads the single answer of each group
 * (callers use it only when the key is unique); `count` is the group size; others aggregate `col`.
 */
export function seriesByKey(ds: Dataset, key: Column, agg: SeriesAgg, col?: Column): SeriesResult {
  const groups = groupBy(ds, key);
  const labels = groups.map((g) => g.label);
  let repeated = 0;
  const values = groups.map((g) => {
    if (g.dataset.rows.length > 1) repeated++;
    if (agg === "count") return g.dataset.rows.length;
    if (!col) return 0;
    if (agg === "nonempty") return countNonEmpty(g.dataset, col);
    const xs = g.dataset.numbers(col);
    if (agg === "value") return xs.length ? xs[0] : 0;
    const v = AGG_FN[agg](xs);
    return v === null ? 0 : round(v);
  });
  return { labels, values, repeated };
}

/** For a choice column: one series per choice, counting selections inside each group of `key`. */
export function choiceSeriesByKey(ds: Dataset, key: Column, col: Column): { labels: string[]; series: { label: string; values: number[] }[] } {
  const groups = groupBy(ds, key);
  const overall = frequency(ds, col);
  const perGroup = groups.map((g) => frequency(g.dataset, col));
  const series = overall.values.map((v, i) => ({
    label: overall.labels[i],
    values: perGroup.map((f) => {
      const idx = f.values.findIndex((x) => looseEquals(x, v));
      return idx >= 0 ? f.counts[idx] : 0;
    }),
  }));
  return { labels: groups.map((g) => g.label), series };
}
