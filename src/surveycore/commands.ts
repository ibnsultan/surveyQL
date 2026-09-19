import type { Arg, Command, Ref } from "../lang/ast";
import { DslError } from "../lang/errors";
import { argText } from "../lang/parser";
import { requireDataset, type CommandImpl, type Env, type PipeContext } from "../interpreter/context";
import { message, scalar, table, type Cell, type TableValue, type Value } from "../interpreter/values";
import { round } from "./coerce";
import type { Column, Dataset } from "./dataset";
import { joinDatasets, MERGE_KINDS, renameColumns, unionDatasets, type JoinOptions, type MergeRule, type Named } from "./combine";
import { compileFilter } from "./filter";
import { loadDataset } from "./loader";
import * as S from "./stats";
import { DEFAULT_DECIMALS, decimalsArg, measureTable, resolveMeasure } from "./measures";

// ---------- helpers ----------

function refArg(cmd: Command, idx = 0): Ref | undefined {
  const a = cmd.args[idx];
  if (!a) return undefined;
  if (a.kind !== "ref") throw new DslError(`${cmd.name}: expected a question name, got ${describeArg(a)}`, a.line, a.col);
  return a;
}

function describeArg(a: Arg): string {
  return argText(a);
}

/** Numeric argument that may be a literal or a scalar variable. */
function numberArg(cmd: Command, env: Env, idx: number, fallback?: number): number | undefined {
  const a = cmd.args[idx];
  if (!a) return fallback;
  if (a.kind === "number") return a.value;
  if (a.kind === "ref" && a.path.length === 1) {
    const v = env.vars.get(a.path[0]);
    if (v && v.kind === "scalar" && typeof v.value === "number") return v.value;
    if (v) throw new DslError(`${cmd.name}: variable '${a.path[0]}' is not a number`, a.line, a.col);
  }
  throw new DslError(`${cmd.name}: expected a number, got ${describeArg(a)}`, a.line, a.col);
}

function noExtraArgs(cmd: Command, max: number): void {
  if (cmd.args.length > max) {
    const a = cmd.args[max];
    throw new DslError(`${cmd.name}: unexpected argument ${describeArg(a)}`, a.line, a.col);
  }
}

function resolveRef(ds: Dataset, ref: Ref, env: Env): Column {
  if (ref.path.length === 1 && env.vars.has(ref.path[0]) && !ds.has(ref.path[0])) {
    throw new DslError(`'${ref.path[0]}' is a variable, not a question`, ref.line, ref.col);
  }
  return ds.resolve(ref);
}

const NUMERIC_TYPES = new Set(["number", "date"]);
const COUNTABLE_TYPES = new Set(["category", "multi", "boolean", "number"]);

function requireNumeric(cmd: Command, col: Column): void {
  if (NUMERIC_TYPES.has(col.type)) return;
  if (col.questionType === "rating") return;
  const hint = COUNTABLE_TYPES.has(col.type) ? `; use 'count(${col.key})'` : "";
  throw new DslError(`${cmd.name}: '${col.key}' is a ${col.type} question, not numeric${hint}`, cmd.line, cmd.col);
}

function fmtNumber(n: number | null, decimals = DEFAULT_DECIMALS): Cell {
  return n === null ? null : round(n, decimals);
}

function rowsValue(ds: Dataset, rows: Dataset["rows"]): Value {
  const cols = ds.questions;
  return { kind: "rows", columns: cols.map((q) => q.key), rows: rows.map((r) => Object.fromEntries(cols.map((c) => [c.key, c.get(r)]))), total: ds.rows.length };
}

/** A dataset variable named by an argument. */
function datasetArg(cmd: Command, env: Env, a: Arg): Named {
  if (a.kind !== "ref" || a.path.length !== 1) throw new DslError(`${cmd.name}: expected a dataset variable, got ${describeArg(a)}`, a.line, a.col);
  const name = a.path[0];
  const v = env.vars.get(name);
  if (!v) throw new DslError(`${cmd.name}: '${name}' is not a variable; bind a dataset first, e.g. let ${name} = load <survey> <responses>`, a.line, a.col);
  if (v.kind !== "dataset") throw new DslError(`${cmd.name}: '${name}' is a ${v.kind}, not a dataset`, a.line, a.col);
  return { name, ds: v.dataset };
}

export type Aggregate = (xs: number[]) => number | null;
export const AGGREGATES: Record<string, Aggregate> = {
  avg: S.avg,
  mean: S.avg,
  sum: (xs) => (xs.length ? S.sum(xs) : null),
  min: S.min,
  max: S.max,
  median: S.median,
  stddev: S.stddev,
};

export { defaultAggregate } from "./measures";

function aggregateCommand(name: string): CommandImpl {
  return {
    names: name === "avg" ? ["avg", "mean"] : [name],
    kind: "value",
    usage: `${name}(<question>[, <decimals>]) [where <expr>] [by <question>]`,
    run(ctx, cmd, env) {
      const ds = requireDataset(ctx, cmd);
      const ref = refArg(cmd);
      if (!ref) throw new DslError(`${cmd.name}: missing question name`, cmd.line, cmd.col);
      noExtraArgs(cmd, 2);
      const col = resolveRef(ds, ref, env);
      requireNumeric(cmd, col);
      const decimals = decimalsArg(cmd.args[1], cmd.name, env.vars) ?? DEFAULT_DECIMALS;
      const fn = AGGREGATES[name];
      const label = `${name}(${col.key})`;
      if (cmd.by) {
        const byCol = resolveRef(ds, cmd.by, env);
        const groups = S.groupBy(ds, byCol);
        const rows: Cell[][] = groups.map((g) => [g.label, fmtNumber(fn(g.dataset.numbers(col)), decimals), g.dataset.rows.length]);
        return { ...ctx, value: table(`${label} by ${byCol.key}`, [byCol.key, label, "n"], rows) };
      }
      return { ...ctx, value: scalar(label, fmtNumber(fn(ds.numbers(col)), decimals)) };
    },
  };
}

function frequencyTable(ds: Dataset, col: Column, label: string): TableValue {
  if (col.type === "object" && col.questionType === "matrix") {
    const m = S.matrixFrequency(ds, col);
    const rows: Cell[][] = m.rowLabels.map((r, i) => [r, ...m.counts[i]]);
    return table(label, ["row", ...m.columnLabels], rows);
  }
  const f = S.frequency(ds, col);
  const rows: Cell[][] = f.values.map((v, i) => [cellOf(v), f.labels[i], f.counts[i], f.percents[i]]);
  const t = table(label, ["value", "label", "count", "percent"], rows);
  if (f.missing) t.rows.push([null, "(no answer)", f.missing, null]);
  return t;
}

function cellOf(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  return JSON.stringify(v);
}

// ---------- commands ----------

const load: CommandImpl = {
  names: ["load"],
  kind: "action",
  usage: "load <survey.json|url> [<responses.json|url>]",
  setsDefault: true,
  async run(ctx, cmd, env) {
    const args = cmd.rawArgs ?? [];
    if (args.length < 1 || args.length > 2) {
      throw new DslError("load: usage is 'load <survey> [<responses>]'", cmd.line, cmd.col);
    }
    const ds = await loadDataset(env.io, args[0], args[1]);
    return { dataset: ds, value: message(`Loaded ${ds.rows.length} responses, ${ds.questions.length} questions`) };
  },
};

/** `use schools`: make a bound dataset the default for the following statements. */
const use: CommandImpl = {
  names: ["use"],
  kind: "action",
  usage: "use <dataset variable>",
  setsDefault: true,
  run(ctx, cmd, env) {
    if (cmd.args.length !== 1) throw new DslError("use: name one dataset variable, e.g. use schools", cmd.line, cmd.col);
    const { name, ds } = datasetArg(cmd, env, cmd.args[0]);
    return { dataset: ds, value: message(`Using ${name}: ${ds.rows.length} responses, ${ds.questions.length} questions`), name };
  },
};

/** `sources()`: every bound dataset, and which one is the default. */
const sources: CommandImpl = {
  names: ["sources", "datasets"],
  kind: "value",
  usage: "sources()",
  run(ctx, cmd, env) {
    noExtraArgs(cmd, 0);
    const rows: Cell[][] = [];
    let defaultNamed = false;
    for (const [name, v] of env.vars) {
      if (v.kind !== "dataset") continue;
      const isDefault = v.dataset === env.dataset;
      defaultNamed ||= isDefault;
      rows.push([name, v.dataset.rows.length, v.dataset.questions.length, v.dataset.origin ?? "", isDefault ? "yes" : ""]);
    }
    if (env.dataset && !defaultNamed) rows.push(["(default)", env.dataset.rows.length, env.dataset.questions.length, env.dataset.origin ?? "", "yes"]);
    return { ...ctx, value: table("sources", ["name", "responses", "questions", "origin", "default"], rows) };
  },
};

/** `union(a, b, ...) [merge q as kind, ...]`: stack responses of the same questionnaire. */
const union: CommandImpl = {
  names: ["union"],
  kind: "action",
  usage: "union(<dataset>, <dataset>, ...) [merge <question> as number|text|category, ...]",
  run(ctx, cmd, env) {
    if (cmd.args.length < 2) throw new DslError("union: needs at least two dataset variables, e.g. union(baseline, endline)", cmd.line, cmd.col);
    const inputs = cmd.args.map((a) => datasetArg(cmd, env, a));
    const rules: MergeRule[] = (cmd.merge ?? []).map((m) => {
      if (!MERGE_KINDS.has(m.as)) throw new DslError(`union: merge ${m.ref.text} as ${m.as}: expected number, text or category`, m.line, m.col);
      if (m.ref.path.length !== 1) throw new DslError(`union: merge: '${m.ref.text}' must be a question name`, m.line, m.col);
      return { key: m.ref.path[0], as: m.as as MergeRule["as"] };
    });
    const { dataset, message: text } = unionDatasets(inputs, rules);
    return { dataset, value: message(text) };
  },
};

/** `join(right) on key` (left = current data) or `join(left, right) on key [= key2]`. */
const joinCmd: CommandImpl = {
  names: ["join"],
  kind: "action",
  usage: "join([<left>,] <right>[, inner|many|loose|labels]) on <question> [= <question>]",
  run(ctx, cmd, env) {
    if (cmd.args.length < 1 || cmd.args.length > 2) throw new DslError("join: usage is join(right) on key, or join(left, right) on key", cmd.line, cmd.col);
    if (!cmd.on) throw new DslError("join: missing 'on <question>', e.g. join(inventory) on school_name", cmd.line, cmd.col);
    let left: Named;
    if (cmd.args.length === 2) left = datasetArg(cmd, env, cmd.args[0]);
    else {
      const ds = requireDataset(ctx, cmd);
      left = { name: ctx.name ?? "left", ds };
    }
    const right = datasetArg(cmd, env, cmd.args[cmd.args.length - 1]);
    const opts: JoinOptions = Object.fromEntries((cmd.options ?? []).map((o) => [o, true]));
    const keyOf = (side: Named, ref: Ref): Column => {
      try {
        return side.ds.resolve(ref);
      } catch (e) {
        if (e instanceof DslError) throw new DslError(`join: ${side.name}: ${e.message}`, ref.line, ref.col);
        throw e;
      }
    };
    const keyL = keyOf(left, cmd.on.left);
    const keyR = keyOf(right, cmd.on.right ?? cmd.on.left);
    const { dataset, message: text } = joinDatasets(left, right, keyL, keyR, opts);
    return { dataset, value: message(text) };
  },
};

/** `rename Q5 as age, Q7 as region`. */
const rename: CommandImpl = {
  names: ["rename"],
  kind: "action",
  usage: "rename <question> as <name>, ...",
  run(ctx, cmd, env) {
    const ds = requireDataset(ctx, cmd);
    const pairs = (cmd.pairs ?? []).map((p) => ({ from: resolveRef(ds, p.ref, env), to: p.as }));
    return { ...ctx, dataset: renameColumns(ds, pairs), value: null };
  },
};

const questions: CommandImpl = {
  names: ["questions", "columns"],
  kind: "value",
  usage: "questions()",
  run(ctx, cmd, env) {
    const ds = requireDataset(ctx, cmd);
    noExtraArgs(cmd, 0);
    const rows: Cell[][] = ds.questions.map((q) => [
      q.key + (env.vars.has(q.key) ? " (shadowed by variable)" : ""),
      q.questionType,
      q.type,
      q.title,
      q.choices ? q.choices.map((c) => String(c.value)).join(", ") : "",
      ...(ds.combined ? [q.origin ?? ""] : []),
    ]);
    if (ds.combined) {
      for (const [key, why] of ds.conflicts) if (!key.includes(".")) rows.push([key, "(conflict)", "", why, "", ""]);
    }
    const columns = ["name", "question", "kind", "title", "choices", ...(ds.combined ? ["in"] : [])];
    return { ...ctx, value: table("questions", columns, rows) };
  },
};

const show: CommandImpl = {
  names: ["show", "head"],
  kind: "value",
  usage: "show([n])",
  run(ctx, cmd, env) {
    const ds = requireDataset(ctx, cmd);
    noExtraArgs(cmd, 1);
    const n = numberArg(cmd, env, 0, 10)!;
    return { ...ctx, value: rowsValue(ds, ds.rows.slice(0, Math.max(0, n))) };
  },
};

const sample: CommandImpl = {
  names: ["sample"],
  kind: "value",
  usage: "sample(<n>)",
  run(ctx, cmd, env) {
    const ds = requireDataset(ctx, cmd);
    noExtraArgs(cmd, 1);
    const n = numberArg(cmd, env, 0, 5)!;
    const pool = [...ds.rows];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(env.rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return { ...ctx, value: rowsValue(ds, pool.slice(0, Math.max(0, n))) };
  },
};

const count: CommandImpl = {
  names: ["count", "freq"],
  kind: "value",
  usage: "count(all | <question>) [where <expr>] [by <question>]",
  run(ctx, cmd, env) {
    const ds = requireDataset(ctx, cmd);
    noExtraArgs(cmd, 1);
    const ref = cmd.args[0]?.kind === "all" ? undefined : refArg(cmd);

    if (!ref) {
      if (cmd.by) {
        const byCol = resolveRef(ds, cmd.by, env);
        const groups = S.groupBy(ds, byCol);
        return { ...ctx, value: table(`count by ${byCol.key}`, [byCol.key, "count"], groups.map((g) => [g.label, g.dataset.rows.length])) };
      }
      return { ...ctx, value: scalar("count", ds.rows.length) };
    }

    const col = resolveRef(ds, ref, env);
    const label = `count(${col.key})`;
    if (cmd.by) {
      const byCol = resolveRef(ds, cmd.by, env);
      const groups = S.groupBy(ds, byCol);
      if (col.type === "text" || col.type === "number" || col.type === "date" || col.type === "object") {
        return { ...ctx, value: table(`${label} by ${byCol.key}`, [byCol.key, label], groups.map((g) => [g.label, S.countNonEmpty(g.dataset, col)])) };
      }
      // Cross-tab: one column per choice of `col`.
      const f = S.frequency(ds, col);
      const rows: Cell[][] = groups.map((g) => {
        const gf = S.frequency(g.dataset, col);
        return [g.label, ...f.values.map((v) => gf.counts[gf.values.findIndex((x) => String(x) === String(v))] ?? 0)];
      });
      return { ...ctx, value: table(`${label} by ${byCol.key}`, [byCol.key, ...f.labels], rows) };
    }

    if (cmd.name === "count" && (col.type === "text" || col.type === "number" || col.type === "date") && col.questionType !== "rating") {
      return { ...ctx, value: scalar(label, S.countNonEmpty(ds, col)) };
    }
    if (col.type === "object" && col.questionType !== "matrix") {
      return { ...ctx, value: scalar(label, S.countNonEmpty(ds, col)) };
    }
    return { ...ctx, value: frequencyTable(ds, col, label) };
  },
};

const describe: CommandImpl = {
  names: ["describe", "summary"],
  kind: "value",
  usage: "describe([question])",
  run(ctx, cmd, env) {
    const ds = requireDataset(ctx, cmd);
    noExtraArgs(cmd, 1);
    const ref = refArg(cmd);
    if (ref) {
      const col = resolveRef(ds, ref, env);
      const d = S.describe(ds, col);
      const rows: Cell[][] = [
        ["type", d.type],
        ["n", d.n],
        ["missing", d.missing],
        ...Object.entries(d.stats).map(([k, v]) => [k, v] as Cell[]),
      ];
      return { ...ctx, value: table(`describe(${col.key})`, ["stat", "value"], rows) };
    }
    const rows: Cell[][] = ds.questions
      .filter((q) => q.type !== "object" || q.questionType === "matrix")
      .map((q) => {
        const d = S.describe(ds, q);
        const summary = Object.entries(d.stats)
          .filter(([, v]) => v !== null && v !== undefined)
          .map(([k, v]) => `${k}=${v}`)
          .join("  ");
        return [q.key, d.type, d.n, d.missing, summary];
      });
    return { ...ctx, value: table("describe", ["question", "kind", "n", "missing", "summary"], rows) };
  },
};

const filter: CommandImpl = {
  names: ["filter"],
  kind: "action",
  usage: "filter <expr>",
  run(ctx, cmd, env) {
    const ds = requireDataset(ctx, cmd);
    if (!cmd.expr) throw new DslError("filter: missing expression", cmd.line, cmd.col);
    const pred = compileFilter(cmd.expr, ds, env.vars);
    const out = ds.where(pred);
    return { dataset: out, value: null };
  },
};

/**
 * `get a, b, c [where …] [by q]`: several measures in one table (SQL select).
 * Only bare questions and no `by` → a projection of the responses to those columns.
 */
const get: CommandImpl = {
  names: ["get", "select"],
  kind: "value",
  usage: "get <question|aggregate>, ... [where <expr>] [by <question>]",
  run(ctx, cmd, env) {
    const ds = requireDataset(ctx, cmd);
    if (!cmd.args.length) throw new DslError("get: name what to get, e.g. get avg(income), count(all) by gender", cmd.line, cmd.col);
    const byCol = cmd.by ? resolveRef(ds, cmd.by, env) : null;
    const bare = cmd.args.filter((a): a is Ref => a.kind === "ref");
    const calls = cmd.args.filter((a) => a.kind === "call");
    const other = cmd.args.find((a) => a.kind !== "ref" && a.kind !== "call");
    if (other) throw new DslError(`get: expected a question or an aggregate, got ${describeArg(other)}`, other.line, other.col);

    if (!byCol && calls.length === 0) {
      // Projection: the chosen columns of every response.
      const cols = bare.map((a) => resolveRef(ds, a, env));
      const rows = ds.rows.map((r) => Object.fromEntries(cols.map((c) => [c.key, c.get(r)])));
      return { ...ctx, value: { kind: "rows", columns: cols.map((c) => c.key), rows, total: ds.rows.length } };
    }
    if (!byCol && bare.length) {
      const a = bare[0];
      throw new DslError(`get: '${a.text}' next to an aggregate needs 'by <question>' (or write an aggregate such as sum(${a.text}))`, a.line, a.col);
    }

    // Grouped (or single-row) measures. A bare question equal to the key is the group column itself.
    const args = cmd.args.filter((a) => !(byCol && a.kind === "ref" && ds.resolve(a).key === byCol.key));
    const keyRepeats = byCol ? S.keyRepeats(ds, byCol) : ds.rows.length > 1;
    const measures = args.map((a) => resolveMeasure(a, "get", ds, keyRepeats, env.vars));
    const t = measureTable(ds, byCol, measures);
    const label = `get ${measures.map((m) => m.label).join(", ")}${byCol ? ` by ${byCol.key}` : ""}`;
    if (byCol) {
      const rows: Cell[][] = t.groups.map((g, i) => [g, ...t.columns.map((c) => c.values[i])]);
      return { ...ctx, value: table(label, [byCol.key, ...t.columns.map((c) => c.label)], rows) };
    }
    return { ...ctx, value: table(label, t.columns.map((c) => c.label), [t.columns.map((c) => c.values[0])]) };
  },
};

/** Prints the piped value, or the current dataset row count when nothing was piped. */
const print: CommandImpl = {
  names: ["print", "echo"],
  kind: "action",
  usage: "<value> | print",
  run(ctx, cmd) {
    noExtraArgs(cmd, 0);
    if (ctx.value) return ctx;
    if (ctx.dataset) return { ...ctx, value: rowsValue(ctx.dataset, ctx.dataset.rows.slice(0, 10)) };
    throw new DslError("print: nothing to print", cmd.line, cmd.col);
  },
};

export const surveycoreCommands: CommandImpl[] = [
  load,
  use,
  sources,
  union,
  joinCmd,
  rename,
  questions,
  show,
  sample,
  count,
  aggregateCommand("avg"),
  aggregateCommand("sum"),
  aggregateCommand("min"),
  aggregateCommand("max"),
  aggregateCommand("median"),
  aggregateCommand("stddev"),
  describe,
  get,
  filter,
  print,
];
