import type { Command } from "../lang/ast";
import { DslError } from "../lang/errors";
import { requireDataset, type CommandImpl, type Env } from "../interpreter/context";
import { message, toJsonValue, type Value } from "../interpreter/values";
import { buildChartSpec, CHART_KINDS, type ChartKind } from "./spec";
import { buildSeriesChart } from "./series";

function chartCommand(kind: ChartKind): CommandImpl {
  return {
    names: kind === "hist" ? ["hist", "histogram"] : [kind],
    kind: "draw",
    usage:
      kind === "hist" || kind === "gauge"
        ? `draw ${kind}(<question>${kind === "hist" ? "[, bins]" : ""}) [where <expr>]`
        : `draw ${kind}(<question or series...>) [with <chart(...)>, ...] [against <question>] [where <expr>]`,
    run(ctx, cmd, env) {
      const ds = requireDataset(ctx, cmd);
      if (cmd.by) throw new DslError(`${cmd.name}: use 'against' instead of 'by' for charts`, cmd.by.line, cmd.by.col);
      if (cmd.against) {
        const parts = [{ name: cmd.name, args: cmd.args, options: cmd.options ?? [], line: cmd.line, col: cmd.col }, ...(cmd.with ?? [])];
        try {
          return { ...ctx, value: buildSeriesChart(parts, cmd.against, ds, env.vars) };
        } catch (e) {
          if (e instanceof DslError) throw e.at(cmd.line, cmd.col);
          throw e;
        }
      }
      if (cmd.with) throw new DslError(`${cmd.name}: 'with' needs 'against', e.g. draw bar(a) with line(b) against school_name`, cmd.with[0].line, cmd.with[0].col);
      if (cmd.options?.length) throw new DslError(`${cmd.name}: '${cmd.options[0]}' only applies to charts drawn against a question`, cmd.line, cmd.col);
      const ref = cmd.args[0];
      if (!ref) throw new DslError(`${cmd.name}: missing question name`, cmd.line, cmd.col);
      if (ref.kind !== "ref") throw new DslError(`${cmd.name}: expected a question name`, ref.line, ref.col);
      let bins: number | undefined;
      const extra = cmd.args[1];
      if (extra) {
        if (kind !== "hist" && kind !== "line") throw new DslError(`${cmd.name}: unexpected argument`, extra.line, extra.col);
        bins = binsArg(cmd, env);
      }
      if (cmd.args.length > 2) throw new DslError(`${cmd.name}: too many arguments`, cmd.args[2].line, cmd.args[2].col);
      const col = ds.resolve(ref);
      try {
        return { ...ctx, value: buildChartSpec(kind, col, ds, { bins }) };
      } catch (e) {
        if (e instanceof DslError) throw e.at(cmd.line, cmd.col);
        throw e;
      }
    },
  };
}

function binsArg(cmd: Command, env: Env): number {
  const a = cmd.args[1];
  if (a.kind === "number") return a.value;
  if (a.kind === "ref" && a.path.length === 1) {
    const v = env.vars.get(a.path[0]);
    if (v && v.kind === "scalar" && typeof v.value === "number") return v.value;
  }
  throw new DslError(`${cmd.name}: bins must be a number`, a.line, a.col);
}

/** Serialize a value for `save`, choosing the format by file extension. */
export function serializeValue(value: Value, path: string): string {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  if (ext === "csv") {
    if (value.kind === "table") return toCsv(value.columns, value.rows);
    if (value.kind === "rows") return toCsv(value.columns, value.rows.map((r) => value.columns.map((c) => cellText(r[c]))));
    throw new DslError(`save: only tables and rows can be saved as CSV (got ${value.kind})`);
  }
  if (value.kind === "chart") return JSON.stringify(value.spec, null, 2);
  if (value.kind === "dataset") return JSON.stringify(value.dataset.rows, null, 2);
  return JSON.stringify(toJsonValue(value), null, 2);
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function toCsv(columns: string[], rows: unknown[][]): string {
  const esc = (v: unknown) => {
    const s = cellText(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n") + "\n";
}

const save: CommandImpl = {
  names: ["save", "export"],
  kind: "action",
  usage: "<value> | save <path>",
  async run(ctx, cmd, env) {
    const args = cmd.rawArgs ?? [];
    if (args.length !== 1) throw new DslError("save: usage is '<value> | save <path>'", cmd.line, cmd.col);
    const path = args[0];
    const value: Value | null = ctx.value ?? (ctx.dataset ? { kind: "dataset", dataset: ctx.dataset } : null);
    if (!value) throw new DslError("save: nothing to save; pipe a value into it, e.g. 'draw pie(gender) | save out.json'", cmd.line, cmd.col);
    const text = serializeValue(value, path);
    const written = await env.io.writeText(path, text);
    const msg = message(written ? `Saved ${path}` : `Prepared ${path} (${text.length} bytes)`);
    if (!written) msg.saved = { path, text };
    return { ...ctx, value: msg };
  },
};

export const visualizationCommands: CommandImpl[] = [...CHART_KINDS.map(chartCommand), save];
