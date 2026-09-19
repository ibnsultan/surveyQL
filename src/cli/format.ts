import type { RunResult } from "../interpreter/interpreter";
import type { Cell, Value } from "../interpreter/values";
import { renderChartText } from "./termchart";

const MAX_CELL = 40;

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  // Values are rounded where they are computed (4 places by default, `avg(q, 2)` to choose);
  // only strip binary float noise here.
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(15)));
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > MAX_CELL ? s.slice(0, MAX_CELL - 1) + "…" : s;
}

/** Render a padded ASCII table. Numeric columns are right-aligned. */
export function formatTable(columns: string[], rows: unknown[][]): string {
  const cells = rows.map((r) => columns.map((_, i) => cellText(r[i])));
  const numeric = columns.map((_, i) => rows.every((r) => r[i] === null || r[i] === undefined || typeof r[i] === "number"));
  const widths = columns.map((c, i) => Math.max(c.length, ...cells.map((r) => r[i].length)));
  const line = (vals: string[]) => vals.map((v, i) => (numeric[i] ? v.padStart(widths[i]) : v.padEnd(widths[i]))).join("  ").trimEnd();
  const out = [line(columns), widths.map((w) => "-".repeat(w)).join("  ")];
  for (const r of cells) out.push(line(r));
  if (!rows.length) out.push("(no rows)");
  return out.join("\n");
}

export interface FormatOptions {
  /** Where chart specs went, if the CLI wrote them to files. */
  chartPath?: string;
  /** Draw charts as coloured bars in the terminal (default); false prints a one-line preview. */
  drawCharts?: boolean;
  /** ANSI colours on/off; default: detect the terminal. */
  color?: boolean;
}

export function formatValue(v: Value, opts: FormatOptions = {}): string {
  switch (v.kind) {
    case "scalar":
      return `${v.label} = ${cellText(v.value)}`;
    case "message":
      return v.text;
    case "table":
      return `${v.label}\n${formatTable(v.columns, v.rows as Cell[][])}`;
    case "rows": {
      const body = formatTable(
        v.columns,
        v.rows.map((r) => v.columns.map((c) => r[c])),
      );
      return `${body}\n(${v.rows.length} of ${v.total} rows)`;
    }
    case "dataset":
      return `dataset: ${v.dataset.rows.length} rows, ${v.dataset.questions.length} questions`;
    case "chart": {
      const head = `[chart ${v.chartType} ${v.question}]`;
      const saved = opts.chartPath ? ` -> ${opts.chartPath}` : "";
      if (opts.drawCharts === false) {
        const preview = v.spec.data.labels.map((l, i) => `${l}: ${v.spec.data.series.map((s) => s.values[i]).join("/")}`).join(", ");
        return `${head} ${v.title}${saved}\n  ${preview}`;
      }
      return `${head}${saved}\n${renderChartText(v, { color: opts.color })}`;
    }
  }
}

export function formatResult(r: RunResult, opts: FormatOptions = {}): string {
  if (r.error) return `error (line ${r.line}): ${r.error.message}`;
  if (!r.value) return "";
  return formatValue(r.value, opts);
}
