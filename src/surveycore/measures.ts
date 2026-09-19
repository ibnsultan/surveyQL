import type { Arg } from "../lang/ast";
import { DslError } from "../lang/errors";
import type { Value } from "../interpreter/values";
import { argText } from "../lang/parser";
import { round } from "./coerce";
import type { Column, Dataset } from "./dataset";
import * as S from "./stats";

/**
 * A measure is one thing computed per group: an aggregate call (`sum(q)`, `count(all)`),
 * or a bare question that is summarised with a default aggregate when the group repeats.
 * Shared by `get(...)` tables and `draw ... against` charts.
 */
export interface Measure {
  /** Column header / legend label, e.g. `sum(monitors)`. */
  label: string;
  agg: S.SeriesAgg | "freq";
  column?: Column;
  /** Decimal places for the result (`avg(q, 2)`); default 4. */
  decimals?: number;
}

export const DEFAULT_DECIMALS = 4;
const MAX_DECIMALS = 10;

/**
 * The optional decimal-places argument of an aggregate call (`avg(q, 2)`): a whole number 0–10,
 * written as a literal or held in a scalar variable.
 */
export function decimalsArg(a: Arg | undefined, cmd: string, vars?: Map<string, Value>): number | undefined {
  if (!a) return undefined;
  let n: unknown;
  if (a.kind === "number") n = a.value;
  else if (a.kind === "ref" && a.path.length === 1 && vars?.has(a.path[0])) {
    const v = vars.get(a.path[0])!;
    n = v.kind === "scalar" ? v.value : undefined;
  }
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_DECIMALS) {
    throw new DslError(`${cmd}: decimal places must be a whole number from 0 to ${MAX_DECIMALS}, got ${argText(a)}`, a.line, a.col);
  }
  return n;
}

const AGG_NAMES = new Set(["sum", "avg", "mean", "min", "max", "median", "stddev", "count"]);

/**
 * Aggregate applied to a bare question when it must be summarised per group:
 * scales are averaged, other numbers summed, choice questions counted per choice.
 */
export function defaultAggregate(col: Column): "avg" | "sum" | "freq" {
  if (col.questionType === "rating" || col.questionType === "slider") return "avg";
  if (col.type === "number" || col.type === "date") return "sum";
  return "freq";
}

function requireNumeric(cmd: string, col: Column, a: Arg): void {
  if (col.type === "number" || col.type === "date" || col.questionType === "rating") return;
  throw new DslError(`${cmd}: '${col.key}' is a ${col.type} question, not numeric`, a.line, a.col);
}

/**
 * Resolve one argument to a measure. `keyRepeats` says whether a bare question needs summarising;
 * `vars` lets a decimal-places argument be a variable.
 */
export function resolveMeasure(a: Arg, cmd: string, ds: Dataset, keyRepeats: boolean, vars?: Map<string, Value>): Measure {
  if (a.kind === "call") {
    const name = a.name === "mean" ? "avg" : a.name;
    if (!AGG_NAMES.has(name)) {
      throw new DslError(`${cmd}: '${a.name}' is not an aggregate; use sum, avg, min, max, median, stddev or count(all)`, a.line, a.col);
    }
    const inner = a.args[0];
    if (name === "count") {
      if (!inner || inner.kind === "all") return { label: "count(all)", agg: "count" };
      if (inner.kind !== "ref") throw new DslError(`${cmd}: count(...) takes 'all' or a question`, a.line, a.col);
      const col = ds.resolve(inner);
      if (col.type === "object") throw new DslError(`${cmd}: count(${inner.text}) cannot be a measure; ${inner.text} is a ${col.questionType} question`, a.line, a.col);
      // Questions with a choice scale (choice, boolean, rating) give one value per choice;
      // free numbers and text give the number of non-empty answers.
      if (col.choices?.length) return { label: a.text, agg: "freq", column: col };
      return { label: a.text, agg: "nonempty", column: col };
    }
    if (!inner || inner.kind !== "ref" || a.args.length > 2) {
      throw new DslError(`${cmd}: ${a.name}(...) takes a question and optional decimal places, e.g. ${a.name}(q, 2)`, a.line, a.col);
    }
    const col = ds.resolve(inner);
    requireNumeric(cmd, col, a);
    const decimals = decimalsArg(a.args[1], `${cmd}: ${a.name}`, vars);
    return { label: `${a.name}(${inner.text})`, agg: name as S.SeriesAgg, column: col, decimals };
  }
  if (a.kind === "ref") {
    const col = ds.resolve(a);
    if (col.type === "object") throw new DslError(`${cmd}: '${col.key}' is a ${col.questionType} question and cannot be a measure`, a.line, a.col);
    if (col.type === "text") throw new DslError(`${cmd}: '${col.key}' is free text and cannot be a measure; use count(${col.key}), or group by it`, a.line, a.col);
    if (col.type === "date") throw new DslError(`${cmd}: '${col.key}' is a date and cannot be a measure; group by it instead`, a.line, a.col);
    const def = defaultAggregate(col);
    if (def === "freq") return { label: a.text, agg: "freq", column: col };
    if (!keyRepeats) return { label: a.text, agg: "value", column: col };
    return { label: `${def}(${a.text})`, agg: def, column: col };
  }
  throw new DslError(`${cmd}: expected a question or an aggregate, got ${argText(a)}`, a.line, a.col);
}

export interface MeasureColumn {
  label: string;
  values: (number | null)[];
  /** Index of the measure this column came from (choice measures expand to several columns). */
  measure: number;
}

export interface MeasureTable {
  /** Group labels, in choice order for choice keys; a single "all" when there is no key. */
  groups: string[];
  columns: MeasureColumn[];
}

function aggregateOver(ds: Dataset, m: Measure): number | null {
  if (m.agg === "count") return ds.rows.length;
  if (!m.column) return null;
  if (m.agg === "nonempty") return S.countNonEmpty(ds, m.column);
  const xs = ds.numbers(m.column);
  if (m.agg === "value") return xs.length ? xs[0] : null;
  if (m.agg === "freq") return null;
  const v = S.aggregate(m.agg, xs);
  return v === null ? null : round(v, m.decimals ?? DEFAULT_DECIMALS);
}

/** Evaluate measures per group of `key` (or once over the whole dataset when `key` is null). */
export function measureTable(ds: Dataset, key: Column | null, measures: Measure[]): MeasureTable {
  const groups = key ? S.groupBy(ds, key) : [{ label: "all", value: null, dataset: ds }];
  const columns: MeasureColumn[] = [];
  measures.forEach((m, mi) => {
    if (m.agg === "freq") {
      const overall = S.frequency(ds, m.column!);
      const perGroup = groups.map((g) => S.frequency(g.dataset, m.column!));
      overall.values.forEach((v, i) => {
        columns.push({
          label: `${m.label}: ${overall.labels[i]}`,
          measure: mi,
          values: perGroup.map((f) => {
            const idx = f.values.findIndex((x) => String(x) === String(v));
            return idx >= 0 ? f.counts[idx] : 0;
          }),
        });
      });
    } else {
      columns.push({ label: m.label, measure: mi, values: groups.map((g) => aggregateOver(g.dataset, m)) });
    }
  });
  return { groups: groups.map((g) => g.label), columns };
}
