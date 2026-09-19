/**
 * Combining datasets: `union` (stack rows of the same questionnaire), `join` (attach another
 * survey's answers on a key) and `rename`. The rules are strict on purpose: nothing is merged
 * or matched unless it is unambiguous, and every message says what was merged, skipped or refused.
 */
import { DslError } from "../lang/errors";
import { isEmpty, looseEquals, toNumber } from "./coerce";
import { Dataset, type Choice, type Column, type ColumnType, type Row } from "./dataset";

/** A dataset together with the variable name it was bound to. */
export interface Named {
  name: string;
  ds: Dataset;
}

/** `merge q as kind` override for union. */
export interface MergeRule {
  key: string;
  as: "number" | "text" | "category";
}

export const MERGE_KINDS = new Set(["number", "text", "category"]);

/** Hidden row property carrying the source name of a unioned row. */
const SOURCE_PROP = "$source";

function sameChoices(a?: Choice[], b?: Choice[]): boolean {
  if (!a && !b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((c) => b.some((d) => looseEquals(c.value, d.value)));
}

/** Two columns merge only when they have the same kind and, for choice/rating questions, the same choices. */
function compatible(a: Column, b: Column): boolean {
  return a.type === b.type && sameChoices(a.choices, b.choices);
}

function describeKind(c: Column): string {
  if (c.questionType === "rating" && c.choices?.length) {
    const nums = c.choices.map((x) => Number(x.value)).filter((n) => Number.isFinite(n));
    if (nums.length) return `rating ${Math.min(...nums)}–${Math.max(...nums)}`;
  }
  if (c.choices?.length && c.type !== "boolean") return `${c.type} (${c.choices.map((x) => x.value).join(", ")})`;
  return c.type;
}

function qualified(name: string, col: Column): Column {
  return {
    ...col,
    key: `${name}.${col.key}`,
    path: [name, ...col.path],
    title: `${name}: ${col.title}`,
    origin: name,
  };
}

/** Column that reads through the merge rule's coercion. */
function coerced(key: string, sources: { name: string; col: Column }[], rule: MergeRule): Column {
  const byName = new Map(sources.map((s) => [s.name, s.col]));
  const first = sources[0].col;
  const raw = (row: Row): unknown => byName.get(String(row[SOURCE_PROP]))?.get(row);
  const base = { key, path: [key], title: first.title, questionType: "merged", origin: sources.map((s) => s.name).join(", ") };
  switch (rule.as) {
    case "number":
      return { ...base, type: "number", get: (row) => toNumber(raw(row)) ?? undefined };
    case "text":
      return {
        ...base,
        type: "text",
        get: (row) => {
          const v = raw(row);
          if (isEmpty(v)) return undefined;
          return Array.isArray(v) ? v.map(String).join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v);
        },
      };
    case "category": {
      const choices: Choice[] = [];
      for (const s of sources) for (const c of s.col.choices ?? []) if (!choices.some((x) => looseEquals(x.value, c.value))) choices.push(c);
      return { ...base, type: "category", choices: choices.length ? choices : undefined, get: raw };
    }
  }
}

export interface CombineResult {
  dataset: Dataset;
  message: string;
}

/** Stack the rows of several datasets of the same questionnaire, adding a `source` column. */
export function unionDatasets(inputs: Named[], rules: MergeRule[] = []): CombineResult {
  if (inputs.length < 2) throw new DslError("union: needs at least two datasets, e.g. union(baseline, endline)");
  const names = inputs.map((i) => i.name);
  const dupName = names.find((n, i) => names.indexOf(n) !== i);
  if (dupName) throw new DslError(`union: '${dupName}' is listed twice`);

  const rows: Row[] = inputs.flatMap((i) => i.ds.rows.map((r) => ({ ...r, [SOURCE_PROP]: i.name })));

  // Every column key, in first-seen order, with the sources that have it.
  const byKey = new Map<string, { name: string; col: Column }[]>();
  for (const i of inputs) {
    for (const col of i.ds.columns) {
      if (!byKey.has(col.key)) byKey.set(col.key, []);
      byKey.get(col.key)!.push({ name: i.name, col });
    }
  }
  for (const r of rules) {
    if (!byKey.has(r.key)) throw new DslError(`union: merge: unknown question '${r.key}'`);
  }

  const sourceKey = byKey.has("source") ? "_source" : "source";
  const columns: Column[] = [
    {
      key: sourceKey,
      path: [sourceKey],
      title: "Source",
      type: "category",
      questionType: "source",
      choices: names.map((n) => ({ value: n, text: n })),
      origin: "(union)",
      get: (row) => row[SOURCE_PROP],
    },
  ];
  const conflicts = new Map<string, string>();
  const merged: string[] = [];
  const widened: string[] = [];
  const onlyIn = new Map<string, string[]>();
  const conflictText: string[] = [];

  for (const [key, sources] of byKey) {
    const rule = rules.find((r) => r.key === key);
    const colByName = new Map(sources.map((s) => [s.name, s.col]));
    if (rule) {
      columns.push(coerced(key, sources, rule));
      widened.push(`${key} as ${rule.as}`);
    } else if (sources.every((s) => compatible(s.col, sources[0].col))) {
      const first = sources[0].col;
      columns.push({
        ...first,
        question: undefined,
        origin: sources.map((s) => s.name).join(", "),
        get: (row) => colByName.get(String(row[SOURCE_PROP]))?.get(row),
      });
      if (sources.length === inputs.length) {
        if (first.path.length === 1) merged.push(key);
      } else if (first.path.length === 1) {
        for (const s of sources) {
          if (!onlyIn.has(s.name)) onlyIn.set(s.name, []);
          onlyIn.get(s.name)!.push(key);
        }
      }
    } else {
      const kinds = sources.map((s) => `${describeKind(s.col)} in ${s.name}`).join(", ");
      const alternatives = sources.map((s) => `${s.name}.${key}`).join(" or ");
      conflicts.set(key, `'${key}' is ${kinds}; use ${alternatives}, or union(...) merge ${key} as number|text|category`);
      conflictText.push(`${key} (${sources.map((s) => describeKind(s.col)).join(" / ")})`);
    }
  }
  // Every source's columns stay reachable under a qualified name: baseline.age (empty on other rows).
  for (const i of inputs) {
    for (const col of i.ds.columns) {
      columns.push(qualified(i.name, { ...col, question: undefined, get: (row) => (row[SOURCE_PROP] === i.name ? col.get(row) : undefined) }));
    }
  }

  const parts = [
    `Combined ${rows.length} responses from ${inputs.map((i) => `${i.name} (${i.ds.rows.length})`).join(", ")}.`,
    `Merged: ${merged.length} question${merged.length === 1 ? "" : "s"}.`,
  ];
  if (widened.length) parts.push(`Merged by rule: ${widened.join(", ")}.`);
  for (const [name, keys] of onlyIn) parts.push(`Only in ${name}: ${keys.join(", ")}.`);
  if (conflictText.length) {
    parts.push(`Conflicts (not merged): ${conflictText.join("; ")}. Use <source>.<question>, or merge <question> as number|text|category.`);
  }
  const dataset = Dataset.combined(columns, rows, { origin: `union(${names.join(", ")})`, conflicts });
  return { dataset, message: parts.join(" ") };
}

export interface JoinOptions {
  /** Drop left rows without a match (default keeps them). */
  inner?: boolean;
  /** Allow several right rows per key (each left row is repeated). */
  many?: boolean;
  /** Case-insensitive, whitespace-trimmed key matching. */
  loose?: boolean;
  /** Also match on choice labels (a dropdown value against a free-text label). */
  labels?: boolean;
}

const KEY_TYPES = new Set<ColumnType>(["number", "category", "boolean", "text", "date"]);

/** Attach the columns of `right` to the rows of `left` where the key questions match. */
export function joinDatasets(left: Named, right: Named, keyL: Column, keyR: Column, opts: JoinOptions = {}): CombineResult {
  if (left.name === right.name) throw new DslError(`join: cannot join '${left.name}' with itself`);
  for (const [k, side] of [
    [keyL, left],
    [keyR, right],
  ] as const) {
    if (!KEY_TYPES.has(k.type)) {
      throw new DslError(`join: cannot join on '${k.key}': it is a ${k.type === "multi" ? "multi-select" : k.questionType} question in ${side.name}`);
    }
  }
  if (keyL.type !== keyR.type && !opts.labels) {
    throw new DslError(`join: '${keyL.key}' is ${keyL.type} in ${left.name} but '${keyR.key}' is ${keyR.type} in ${right.name}; use join(..., labels) to match on choice labels`);
  }

  const norm = (v: unknown): string | null => {
    if (isEmpty(v)) return null;
    const s = String(v).trim();
    return opts.loose ? s.toLowerCase() : s;
  };
  const keysOf = (ds: Dataset, col: Column, row: Row): string[] => {
    const v = col.get(row);
    const out: string[] = [];
    const k = norm(v);
    if (k !== null) out.push(k);
    if (opts.labels && !isEmpty(v)) {
      const l = norm(ds.label(col, v));
      if (l !== null && !out.includes(l)) out.push(l);
    }
    return out;
  };

  const index = new Map<string, Row[]>();
  for (const r of right.ds.rows) {
    for (const k of keysOf(right.ds, keyR, r)) {
      if (!index.has(k)) index.set(k, []);
      const bucket = index.get(k)!;
      if (!bucket.includes(r)) bucket.push(r);
    }
  }

  const prop = `$${right.name}`;
  const rows: Row[] = [];
  const unmatched: string[] = [];
  let matched = 0;
  let multiplied = 0;
  for (const l of left.ds.rows) {
    const ks = keysOf(left.ds, keyL, l);
    const hits: Row[] = [];
    for (const k of ks) for (const r of index.get(k) ?? []) if (!hits.includes(r)) hits.push(r);
    const display = keyL.get(l);
    if (hits.length > 1 && !opts.many) {
      throw new DslError(`join: '${String(display)}' matches ${hits.length} rows in ${right.name}; use join(..., many) to keep every match`);
    }
    if (!hits.length) {
      unmatched.push(isEmpty(display) ? "(empty)" : String(display));
      if (!opts.inner) rows.push({ ...l });
      continue;
    }
    matched++;
    if (hits.length > 1) multiplied++;
    for (const h of hits) rows.push({ ...l, [prop]: h });
  }

  const leftKeys = new Set(left.ds.columns.map((c) => c.key));
  const columns: Column[] = left.ds.columns.map((c) => ({ ...c, origin: c.origin ?? left.name }));
  const clashes: string[] = [];
  for (const c of right.ds.columns) {
    const through: Column = { ...c, question: undefined, origin: right.name, get: (row) => (row[prop] ? c.get(row[prop] as Row) : undefined) };
    if (leftKeys.has(c.key)) {
      if (c.path.length === 1 && c.key !== keyR.key) clashes.push(c.key);
    } else {
      columns.push(through);
    }
    columns.push(qualified(right.name, through));
  }

  const keyText = keyL.key === keyR.key ? keyL.key : `${keyL.key} = ${keyR.key}`;
  const parts = [`Joined ${matched} of ${left.ds.rows.length} ${left.name} rows with ${right.name} on ${keyText}.`];
  if (unmatched.length) {
    const distinct = [...new Set(unmatched)];
    const shown = distinct.slice(0, 5).join(", ");
    parts.push(`${opts.inner ? "Dropped" : "No match for"} ${unmatched.length}: ${shown}${distinct.length > 5 ? ", …" : ""}.`);
  }
  if (multiplied) parts.push(`${multiplied} left row${multiplied === 1 ? "" : "s"} matched several ${right.name} rows and were repeated.`);
  if (clashes.length) parts.push(`Also in ${right.name} (use ${right.name}.<question>): ${clashes.join(", ")}.`);
  const dataset = Dataset.combined(columns, rows, { origin: `join(${left.name}, ${right.name}) on ${keyText}` });
  return { dataset, message: parts.join(" ") };
}

/** Rename top-level questions; sub-path columns follow their parent. */
export function renameColumns(ds: Dataset, pairs: { from: Column; to: string }[]): Dataset {
  const map = new Map<string, string>();
  for (const p of pairs) {
    if (p.from.path.length !== 1) throw new DslError(`rename: '${p.from.key}' is a sub-field; rename its question instead`);
    if (ds.has(p.to) && !map.has(p.to)) throw new DslError(`rename: '${p.to}' already exists`);
    if (map.has(p.from.key)) throw new DslError(`rename: '${p.from.key}' is renamed twice`);
    map.set(p.from.key, p.to);
  }
  const columns = ds.columns.map((c) => {
    const to = map.get(c.path[0]);
    if (!to) return c;
    const path = [to, ...c.path.slice(1)];
    return { ...c, key: path.join("."), path };
  });
  return ds.withColumns(columns);
}
