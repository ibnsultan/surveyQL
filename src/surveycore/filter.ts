import type { Expr, MatchOptions, Ref } from "../lang/ast";
import { DslError } from "../lang/errors";
import type { Value } from "../interpreter/values";
import { isEmpty, looseEquals, toNumber } from "./coerce";
import type { Dataset, Row } from "./dataset";

type Getter = (row: Row) => unknown;

/** Compile a filter expression into a row predicate. Refs resolve to columns (or scalar variables) once. */
export function compileFilter(expr: Expr, ds: Dataset, vars: Map<string, Value> = new Map()): (row: Row) => boolean {
  const g = compile(expr, ds, vars);
  return (row) => truthy(g(row));
}

function compile(expr: Expr, ds: Dataset, vars: Map<string, Value>): Getter {
  switch (expr.kind) {
    case "literal": {
      const v = expr.value;
      return () => v;
    }
    case "list": {
      const items = expr.items.map((e) => compile(e, ds, vars));
      return (row) => items.map((g) => g(row));
    }
    case "ref":
      return compileRef(expr, ds, vars);
    case "not": {
      const inner = compile(expr.expr, ds, vars);
      return (row) => !truthy(inner(row));
    }
    case "match": {
      const l = compile(expr.left, ds, vars);
      const getters = expr.values.map((v) => compile(v, ds, vars));
      const matcher = makeMatcher(expr.op, expr.options, expr);
      const negate = expr.negate;
      return (row) => {
        const left = l(row);
        const hit = getters.some((g) => matcher(left, g(row)));
        return negate ? !hit : hit;
      };
    }
    case "binary": {
      const l = compile(expr.left, ds, vars);
      const r = compile(expr.right, ds, vars);
      switch (expr.op) {
        case "and":
          return (row) => truthy(l(row)) && truthy(r(row));
        case "or":
          return (row) => truthy(l(row)) || truthy(r(row));
        case "==":
          return (row) => equals(l(row), r(row));
        case "!=":
          return (row) => !equals(l(row), r(row));
        case "<":
          return (row) => compare(l(row), r(row), (a, b) => a < b);
        case "<=":
          return (row) => compare(l(row), r(row), (a, b) => a <= b);
        case ">":
          return (row) => compare(l(row), r(row), (a, b) => a > b);
        case ">=":
          return (row) => compare(l(row), r(row), (a, b) => a >= b);
        case "contains": // only produced by older ASTs; the parser now emits a "match" node
          return (row) => contains(l(row), r(row));
        case "in": {
          return (row) => {
            const list = r(row);
            const items = Array.isArray(list) ? list : [list];
            const v = l(row);
            if (Array.isArray(v)) return v.some((x) => items.some((i) => looseEquals(x, i)));
            return items.some((i) => looseEquals(v, i));
          };
        }
      }
    }
  }
}

function compileRef(ref: Ref, ds: Dataset, vars: Map<string, Value>): Getter {
  const variable = ref.path.length === 1 ? vars.get(ref.path[0]) : undefined;
  if (variable) {
    if (variable.kind === "scalar") {
      const v = variable.value;
      return () => v;
    }
    throw new DslError(`variable '${ref.path[0]}' is a ${variable.kind}, not a value usable in an expression`, ref.line, ref.col);
  }
  const col = ds.resolve(ref);
  return col.get;
}

function truthy(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return !isEmpty(v);
}

function equals(a: unknown, b: unknown): boolean {
  const aEmpty = isEmpty(a);
  const bEmpty = isEmpty(b);
  if (aEmpty || bEmpty) return aEmpty && bEmpty;
  if (Array.isArray(a) && !Array.isArray(b)) return a.length === 1 && looseEquals(a[0], b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => looseEquals(x, b[i]));
  return looseEquals(a, b);
}

function compare(a: unknown, b: unknown, op: (x: number | string, y: number | string) => boolean): boolean {
  if (isEmpty(a) || isEmpty(b)) return false;
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) return op(na, nb);
  return op(String(a), String(b));
}

function contains(a: unknown, b: unknown): boolean {
  if (isEmpty(a)) return false;
  if (Array.isArray(a)) return a.some((x) => looseEquals(x, b));
  return String(a).toLowerCase().includes(String(b).toLowerCase());
}

/** Build the per-value test for `is` / `contains` with `strict` and `regex` options. */
function makeMatcher(op: "is" | "contains", options: MatchOptions, pos: { line: number; col: number }): (left: unknown, value: unknown) => boolean {
  const regexCache = new Map<string, RegExp>();
  const toRegex = (v: unknown): RegExp => {
    const src = String(v);
    let re = regexCache.get(src);
    if (!re) {
      try {
        re = new RegExp(src, options.strict ? "" : "i");
      } catch (e) {
        throw new DslError(`invalid regular expression '${src}': ${(e as Error).message}`, pos.line, pos.col);
      }
      regexCache.set(src, re);
    }
    return re;
  };

  // Compare one scalar answer against one value.
  const scalarIs = (x: unknown, v: unknown): boolean => {
    if (options.regex) return !isEmpty(x) && toRegex(v).test(String(x));
    if (options.strict) return looseEquals(x, v);
    const nx = toNumber(x);
    const nv = toNumber(v);
    if (nx !== null && nv !== null && typeof x !== "boolean" && typeof v !== "boolean") return nx === nv;
    if (typeof x === "boolean" || typeof v === "boolean") return looseEquals(x, v);
    return String(x).toLowerCase() === String(v).toLowerCase();
  };
  const scalarContains = (x: unknown, v: unknown): boolean => {
    if (options.regex) return toRegex(v).test(String(x));
    const a = String(x);
    const b = String(v);
    return options.strict ? a.includes(b) : a.toLowerCase().includes(b.toLowerCase());
  };

  return (left, value) => {
    if (value === null || value === undefined) return isEmpty(left);
    if (isEmpty(left)) return false;
    if (Array.isArray(left)) {
      // A multi-select answer matches when any selected choice matches.
      return left.some((x) => (op === "is" ? scalarIs(x, value) : scalarContains(x, value)));
    }
    if (op === "is") return scalarIs(left, value);
    return scalarContains(left, value);
  };
}
