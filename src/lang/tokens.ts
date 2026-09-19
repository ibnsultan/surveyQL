export type TokenType = "ident" | "qident" | "number" | "string" | "op" | "punct" | "eof";

export interface Token {
  type: TokenType;
  /** Raw text for idents/ops/punct, unescaped content for strings and quoted idents. */
  value: string;
  line: number;
  col: number;
}

/** Words that are reserved in argument and expression positions. */
export const RESERVED = new Set([
  "where", "by", "against", "with", "on", "as", "all",
  "and", "or", "not", "in", "is", "contains", "between",
  "true", "false", "null",
]);

/** Option words accepted inside `is(...)` and `contains(...)`. */
export const MATCH_OPTIONS = new Set(["strict", "regex"]);

/** Option words accepted inside a chart call, e.g. `line(staff, right)`. */
export const SERIES_OPTIONS = new Set(["right"]);

/** Option words accepted inside `join(...)`. */
export const JOIN_OPTIONS = new Set(["inner", "many", "loose", "labels"]);

/** Option words accepted by value/action commands, by command name. */
export const CALL_OPTIONS: Record<string, Set<string>> = { join: JOIN_OPTIONS };

/** Commands whose arguments are `question as name` pairs. */
export const PAIR_COMMANDS = new Set(["rename"]);

/** Prefix words that classify a command: `draw` for charts. Value commands take no prefix. */
export const PREFIXES = new Set(["draw"]);
export type Prefix = "draw";

/** Commands whose arguments are taken verbatim (split on whitespace) instead of tokenized. */
export const RAW_COMMANDS = new Set(["load", "save"]);

/** Commands whose single argument is an expression. */
export const EXPR_COMMANDS = new Set(["filter"]);
