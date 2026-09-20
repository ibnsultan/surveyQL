/**
 * Syntax highlighter for SurveyQL, playground only.
 *
 * A small hand-written scanner (not the language's lexer) that turns source text into
 * HTML with one <span class="tok-…"> per token and one <span class="cm-line"> per line.
 * It never throws: unterminated strings and unknown characters are just coloured as-is.
 */

export type TokenClass =
  | "comment"
  | "string"
  | "name" // `quoted question name`
  | "number"
  | "keyword" // let, draw, get, where, by, and, is, …
  | "command" // a function: the first word of a pipeline segment, or a nested call like avg(…)
  | "option" // strict, regex, right, inner, …
  | "literal" // true, false, null
  | "var" // a variable: the name after `let`, or a later use of one
  | "path" // arguments of load / save, taken verbatim
  | "op"
  | "punct"
  | "pipe"
  | "ident";

export interface HToken {
  cls: TokenClass | null;
  text: string;
}

const RESERVED = new Set([
  "where", "by", "against", "with", "on", "as", "all", "merge",
  "and", "or", "not", "in", "is", "contains", "between",
]);
const LITERALS = new Set(["true", "false", "null"]);
const OPTIONS = new Set(["strict", "regex", "right", "inner", "many", "loose", "labels"]);
const RAW_COMMANDS = new Set(["load", "save", "export"]);
/** Words that start a statement and are coloured as keywords, not functions. */
const STARTERS = new Set(["let", "draw"]);
const KEYWORD_COMMANDS = new Set(["get", "select"]);

const WORD_START = /[A-Za-z_]/;
const WORD_CHAR = /[A-Za-z0-9_-]/;
const DIGIT = /[0-9]/;

/** Scanner state carried from one line to the next. */
interface LineState {
  /** Unclosed parentheses so far in the statement. */
  depth: number;
  /** The previous line ended with `|`, `,` or `\` (comment stripped). */
  trailing: boolean;
  /** Inside a `load` / `save` segment whose arguments continue on this line. */
  raw: boolean;
  /** Variable names bound so far (`let` in the script, plus names given from outside). */
  vars: Set<string>;
}

/** Does this physical line continue the statement above it? Mirrors the rules in docs/language.md §1. */
function continues(line: string, state: LineState): boolean {
  if (line.trim() === "") return false;
  const first = /^\s*([A-Za-z_][A-Za-z0-9_-]*)/.exec(line)?.[1];
  if (first && STARTERS.has(first)) return false;
  if (/^\s/.test(line)) return true;
  if (line.trimStart().startsWith("|")) return true;
  if (first && RESERVED.has(first)) return true;
  return state.depth > 0 || state.trailing;
}

/** Tokenize one line. `expectCommand` is true when the next word names a command. */
function scanLine(line: string, state: LineState): { tokens: HToken[]; state: LineState } {
  const tokens: HToken[] = [];
  const cont = continues(line, state);
  let depth = cont ? state.depth : 0;
  let raw = cont && state.raw;
  let expectCommand = !cont;
  let afterLet = false; // the next word is the variable name
  let letLine = false; // a `let` was seen: the `=` that follows starts a pipeline
  const vars = state.vars;
  let i = 0;

  const push = (cls: TokenClass | null, text: string) => {
    if (text) tokens.push({ cls, text });
  };

  while (i < line.length) {
    const ch = line[i];

    if (ch === "#") {
      push("comment", line.slice(i));
      break;
    }

    if (/\s/.test(ch)) {
      let j = i;
      while (j < line.length && /\s/.test(line[j])) j++;
      push(null, line.slice(i, j));
      i = j;
      continue;
    }

    if (ch === "|") {
      push("pipe", ch);
      i++;
      expectCommand = true;
      raw = false;
      continue;
    }

    // load / save arguments: everything up to the next pipe or comment, verbatim
    if (raw) {
      let j = i;
      let quote: string | null = null;
      while (j < line.length) {
        const c = line[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === "|" || c === "#") break;
        j++;
      }
      push("path", line.slice(i, j).trimEnd());
      i += line.slice(i, j).trimEnd().length;
      continue;
    }

    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) j += line[j] === "\\" ? 2 : 1;
      push("string", line.slice(i, Math.min(j + 1, line.length)));
      i = j + 1;
      continue;
    }

    if (ch === "`") {
      const end = line.indexOf("`", i + 1);
      const j = end < 0 ? line.length : end + 1;
      push("name", line.slice(i, j));
      i = j;
      expectCommand = false;
      continue;
    }

    if (DIGIT.test(ch) || (ch === "-" && DIGIT.test(line[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < line.length && DIGIT.test(line[j])) j++;
      if (line[j] === "." && DIGIT.test(line[j + 1] ?? "")) {
        j++;
        while (j < line.length && DIGIT.test(line[j])) j++;
      }
      push("number", line.slice(i, j));
      i = j;
      expectCommand = false;
      continue;
    }

    if (WORD_START.test(ch)) {
      let j = i + 1;
      while (j < line.length && WORD_CHAR.test(line[j])) j++;
      const word = line.slice(i, j);
      const lower = word.toLowerCase();
      i = j;

      if (afterLet) {
        push("var", word);
        vars.add(word);
        afterLet = false;
        letLine = true;
        continue;
      }
      if (expectCommand) {
        if (lower === "let") {
          push("keyword", word);
          afterLet = true;
          continue;
        }
        if (lower === "draw") {
          push("keyword", word);
          continue;
        }
        if (KEYWORD_COMMANDS.has(lower)) push("keyword", word);
        else if (vars.has(word) && line[i] !== "(") push("var", word); // adults | count(colors)
        else push("command", word);
        expectCommand = false;
        if (RAW_COMMANDS.has(lower)) raw = true;
        continue;
      }
      if (RESERVED.has(lower)) push("keyword", word);
      else if (LITERALS.has(lower)) push("literal", word);
      else if (OPTIONS.has(lower)) push("option", word);
      else if (line[i] === "(") push("command", word); // nested call: avg(income)
      else if (vars.has(word)) push("var", word); // age > cutoff
      else push("ident", word);
      continue;
    }

    const two = line.slice(i, i + 2);
    if (two === "==" || two === "!=" || two === "<=" || two === ">=") {
      push("op", two);
      i += 2;
      continue;
    }
    if (ch === "=" || ch === "<" || ch === ">") {
      push("op", ch);
      i++;
      if (ch === "=" && letLine) {
        expectCommand = true; // let x = <command>
        letLine = false;
      }
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if ("()[],.".includes(ch)) {
      push("punct", ch);
      i++;
      continue;
    }

    push(null, ch);
    i++;
  }

  const code = line.replace(/#.*$/, "").trimEnd();
  const trailing = /[|,\\]$/.test(code);
  return { tokens, state: { depth, trailing, raw, vars } };
}

/** Tokenize a whole script, one token list per line. `variables` are names bound outside the script. */
export function tokenizeLines(source: string, variables: Iterable<string> = []): HToken[][] {
  let state: LineState = { depth: 0, trailing: false, raw: false, vars: new Set(variables) };
  return source.split("\n").map((line) => {
    const r = scanLine(line, state);
    state = r.state;
    return r.tokens;
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Render a script as HTML. Lines whose 1-based number is in `errorLines` get the
 * `has-error` class so the stylesheet can underline them.
 */
export function highlight(source: string, errorLines: ReadonlySet<number> = new Set(), variables: Iterable<string> = []): string {
  return tokenizeLines(source, variables)
    .map((tokens, idx) => {
      const body = tokens.map((t) => (t.cls ? `<span class="tok-${t.cls}">${escapeHtml(t.text)}</span>` : escapeHtml(t.text))).join("");
      const cls = errorLines.has(idx + 1) ? "cm-line has-error" : "cm-line";
      // "​" keeps empty lines the same height as the others
      return `<span class="${cls}">${body || "​"}</span>`;
    })
    .join("\n");
}
