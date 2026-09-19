import type { Dataset } from "../surveycore/dataset";

export type Cell = string | number | boolean | null;

export interface ScalarValue {
  kind: "scalar";
  label: string;
  value: number | string | boolean | null;
}

export interface TableValue {
  kind: "table";
  label: string;
  columns: string[];
  rows: Cell[][];
}

export interface RowsValue {
  kind: "rows";
  columns: string[];
  rows: Record<string, unknown>[];
  /** Total rows in the dataset the preview came from. */
  total: number;
}

export interface ChartSeries {
  label: string;
  values: number[];
  /** Mark type for series charts (mixed charts have both). */
  type?: "bar" | "line";
  /** Which y-axis the series is plotted on (series charts). */
  axis?: "left" | "right";
  /** Series sharing a stack name are drawn stacked (per-choice counts of one question, matrix columns). */
  stack?: string;
}

/** Presentation hints the ApexCharts options are built from. */
export interface ChartLayout {
  title: string;
  horizontal?: boolean;
  stacked?: boolean;
  legend: boolean;
  /**
   * `independent` when the series' magnitudes are too far apart for one axis: each series (or
   * stack group) is drawn to its own scale and the values are printed on the bars. Horizontal
   * bars then carry lengths as a percentage of each series' maximum in `apex`; the real numbers
   * are in `data`.
   */
  scales?: "shared" | "independent";
  /** Footnote under the chart, e.g. the ends of a rating scale: `1 · very unsatisfied   5 · very satisfied`. */
  note?: string;
}

export interface ChartSpec {
  /** `distribution`: one question's counts/bins. `series`: measures plotted against a key question. */
  mode?: "distribution" | "series";
  /** Key question of a series chart. */
  against?: string;
  layout: ChartLayout;
  /** The plotted numbers, independent of any charting library. */
  data: { labels: string[]; series: ChartSeries[] };
  stats?: Record<string, number | number[]>;
  /** JSON-safe ApexCharts options: `new ApexCharts(el, spec.apex)`. */
  apex: Record<string, unknown>;
}

export interface ChartValue {
  kind: "chart";
  chartType: string;
  question: string;
  title: string;
  spec: ChartSpec;
  /** The data the chart was built from (for survey-analytics rendering); stripped from JSON output. */
  dataset?: Dataset;
}

export interface MessageValue {
  kind: "message";
  text: string;
  /** Present when `save` ran in an environment without a filesystem; carries what would have been written. */
  saved?: { path: string; text: string };
}

export interface DatasetValue {
  kind: "dataset";
  dataset: Dataset;
}

export type Value = ScalarValue | TableValue | RowsValue | ChartValue | MessageValue | DatasetValue;

export const scalar = (label: string, value: ScalarValue["value"]): ScalarValue => ({ kind: "scalar", label, value });
export const table = (label: string, columns: string[], rows: Cell[][]): TableValue => ({ kind: "table", label, columns, rows });
export const message = (text: string): MessageValue => ({ kind: "message", text });

/** Strip non-serializable parts (datasets) so results can be JSON-encoded. */
export function toJsonValue(v: Value): unknown {
  if (v.kind === "dataset") return { kind: "dataset", rows: v.dataset.rows.length, columns: v.dataset.columns.map((c) => c.key) };
  if (v.kind === "chart") {
    const { dataset: _ds, ...rest } = v;
    return rest;
  }
  return v;
}
