import type { Arg, ChartPart, Ref } from "../lang/ast";
import { DslError } from "../lang/errors";
import { argText } from "../lang/parser";
import type { ChartLayout, ChartSeries, ChartSpec, ChartValue, Value } from "../interpreter/values";
import type { Dataset } from "../surveycore/dataset";
import { measureTable, resolveMeasure, type Measure } from "../surveycore/measures";
import * as S from "../surveycore/stats";
import { apexOptions, independentScales } from "./apex";
import type { ChartKind } from "./spec";

const SERIES_KINDS = new Set<ChartKind>(["bar", "vbar", "line", "pie", "doughnut"]);

interface ResolvedSeries extends Measure {
  type: "bar" | "line";
  axis: "left" | "right";
}

/** Describe one part (`bar(a, b)` / `line(c, right)`) as resolved series. */
function resolvePart(part: ChartPart, ds: Dataset, keyRepeats: boolean, vars?: Map<string, Value>): ResolvedSeries[] {
  const kind = part.name as ChartKind;
  if (!SERIES_KINDS.has(kind)) {
    const hint = kind === "hist" || kind === "gauge" ? ` (${kind} shows one question's distribution)` : "";
    throw new DslError(`'${part.name}' cannot be used with against${hint}; use bar, vbar, line, pie or doughnut`, part.line, part.col);
  }
  if (!part.args.length) throw new DslError(`${part.name}: needs at least one series, e.g. ${part.name}(number_computers)`, part.line, part.col);
  const axis: "left" | "right" = part.options.includes("right") ? "right" : "left";
  const type: "bar" | "line" = kind === "line" ? "line" : "bar";
  return part.args.map((a) => ({ ...resolveMeasure(a, part.name, ds, keyRepeats, vars), type, axis }));
}

/** Build a chart of one or more series plotted against a key question. */
export function buildSeriesChart(parts: ChartPart[], keyRef: Ref, ds: Dataset, vars?: Map<string, Value>): ChartValue {
  const key = ds.resolve(keyRef);
  if (key.type === "object") throw new DslError(`against: '${key.key}' is a ${key.questionType} question and cannot be an axis`, keyRef.line, keyRef.col);
  const repeats = S.keyRepeats(ds, key);
  const resolved = parts.map((p) => ({ part: p, series: resolvePart(p, ds, repeats, vars) }));
  const first = resolved[0].part.name as ChartKind;
  const isPie = first === "pie" || first === "doughnut";

  if (isPie) {
    if (parts.length > 1) throw new DslError(`${first}: cannot be combined with 'with'; a pie has a single ring`, parts[1].line, parts[1].col);
    if (resolved[0].series.length !== 1) throw new DslError(`${first}: takes exactly one series when used with against`, parts[0].line, parts[0].col);
    if (resolved[0].series[0].agg === "freq") throw new DslError(`${first}: a choice question cannot be sliced against another; use bar`, parts[0].line, parts[0].col);
    if (parts[0].options.includes("right")) throw new DslError(`${first}: 'right' only applies to bar and line series`, parts[0].line, parts[0].col);
  }
  for (const r of resolved) {
    const k = r.part.name as ChartKind;
    if (k === "pie" || k === "doughnut") {
      if (r.part !== parts[0]) throw new DslError(`${k}: cannot be part of a combined chart`, r.part.line, r.part.col);
    }
  }

  // Compute every series against the key. Choice series expand into one dataset per choice.
  const flat = resolved.flatMap((r) => r.series);
  const t = measureTable(ds, key, flat);
  const labels = t.groups;
  const series: ChartSeries[] = t.columns.map((c) => {
    const src = flat[c.measure];
    return { label: c.label, values: c.values.map((v) => v ?? 0), type: src.type, axis: src.axis, ...(src.agg === "freq" ? { stack: src.column!.key } : {}) };
  });
  // Choice columns of one question stack together; every other series stands on its own.
  const stacks = t.columns.map((c, i) => (flat[c.measure].agg === "freq" ? flat[c.measure].column!.key : `s${i + 1}`));

  const stacked = resolved.some((r) => r.series.some((s) => s.agg === "freq"));
  const hasLine = series.some((s) => s.type === "line");
  const hasRight = series.some((s) => s.axis === "right");
  const horizontal = first === "bar" && !hasLine;
  const seriesText = parts.map((p) => `${p.name}(${p.args.map(argText).join(", ")})`).join(" with ");
  const title = `${seriesText} against ${key.title}`;
  const question = `${parts[0].args.map(argText).join(",")} against ${key.key}`;

  const base: ChartLayout = { title, horizontal, stacked: stacked && !isPie, legend: isPie || series.length > 1 };
  const layout: ChartLayout = { ...base, scales: !isPie && independentScales(series, base, stacks) ? "independent" : "shared" };
  const data = { labels, series };
  const apex = apexOptions({ chartType: first, labels, series, layout, stacks });
  const spec: ChartSpec = { mode: "series", against: key.key, layout, data, apex };
  return { kind: "chart", chartType: first, question, title, spec, dataset: ds };
}
