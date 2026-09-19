import type { DslError } from "./errors";

export interface Ref {
  kind: "ref";
  /** Path segments, e.g. ["colors", "red"]. */
  path: string[];
  /** Original text as written, for messages. */
  text: string;
  line: number;
  col: number;
}

export interface NumberArg {
  kind: "number";
  value: number;
  line: number;
  col: number;
}

export interface StringArg {
  kind: "string";
  value: string;
  line: number;
  col: number;
}

/** A nested call inside a command's arguments, e.g. `sum(number_computers)` in `bar(sum(number_computers))`. */
export interface CallArg {
  kind: "call";
  name: string;
  args: Arg[];
  /** Option words such as `right`. */
  options: string[];
  text: string;
  line: number;
  col: number;
}

/** The reserved word `all`, as in `count(all)`. */
export interface AllArg {
  kind: "all";
  line: number;
  col: number;
}

export type Arg = Ref | NumberArg | StringArg | CallArg | AllArg;

/** `question as name`, as in `rename Q5 as age` or `union(a, b) merge age as number`. */
export interface AliasPair {
  ref: Ref;
  as: string;
  line: number;
  col: number;
}

/** One chart call: the command itself or a part listed after `with`. */
export interface ChartPart {
  name: string;
  args: Arg[];
  options: string[];
  line: number;
  col: number;
}

export type BinaryOp = "and" | "or" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "contains" | "in";

export interface MatchOptions {
  /** Case-sensitive comparison (default is case-insensitive). */
  strict?: boolean;
  /** Treat each value as a regular expression. */
  regex?: boolean;
}

export type Expr =
  | { kind: "binary"; op: BinaryOp; left: Expr; right: Expr; line: number; col: number }
  /** `x is v`, `x is(v1, v2, strict)`, `x contains(v, regex)`; `negate` for `is not`. */
  | { kind: "match"; op: "is" | "contains"; left: Expr; values: Expr[]; options: MatchOptions; negate: boolean; line: number; col: number }
  | { kind: "not"; expr: Expr; line: number; col: number }
  | { kind: "literal"; value: number | string | boolean | null; line: number; col: number }
  | { kind: "list"; items: Expr[]; line: number; col: number }
  | Ref;

export interface Command {
  name: string;
  /** `draw` when written with the chart prefix; checked against the command's kind at run time. */
  prefix?: "draw";
  line: number;
  col: number;
  args: Arg[];
  /** Expression argument (for `filter`). */
  expr?: Expr;
  /** `by <ref>` clause. */
  by?: Ref;
  /** Option words written inside the command's own call, e.g. `draw line(staff, right)`. */
  options?: string[];
  /** `against <ref>` clause (charts). */
  against?: Ref;
  /** Extra chart calls listed after `with`. */
  with?: ChartPart[];
  /** `on <ref> [= <ref>]` clause (join): the key on the left side and, when different, on the right. */
  on?: { left: Ref; right?: Ref };
  /** `merge q as kind, ...` clause (union). */
  merge?: AliasPair[];
  /** `question as name` argument pairs (rename). */
  pairs?: AliasPair[];
  /** Verbatim arguments for raw commands such as `load` and `save`. */
  rawArgs?: string[];
}

export type Literal = { kind: "literal"; value: number | string | boolean };

export type Statement =
  | { kind: "pipeline"; line: number; source: string; commands: Command[] }
  | { kind: "let"; line: number; source: string; name: string; value: Literal | { kind: "pipeline"; commands: Command[] } }
  | { kind: "error"; line: number; source: string; error: DslError };

export interface Script {
  statements: Statement[];
}
