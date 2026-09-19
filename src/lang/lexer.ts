import { DslError } from "./errors";
import { RESERVED, type Token } from "./tokens";

export interface Segment {
  /** Text of one pipe-separated command, with surrounding whitespace preserved for column math. */
  text: string;
  line: number;
  /** 1-based column of the first character of `text` in the original line. */
  col: number;
}

const QUOTES = new Set(['"', "'", "`"]);

/** Remove a trailing `# comment`, ignoring `#` inside quotes. */
export function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\" && quote !== "`") i++;
      else if (ch === quote) quote = null;
    } else if (QUOTES.has(ch)) {
      quote = ch;
    } else if (ch === "#") {
      return line.slice(0, i);
    }
  }
  return line;
}

/** One logical statement: physical lines joined with `\n`, comments removed. */
export interface StatementText {
  text: string;
  /** 1-based number of the first physical line. */
  line: number;
  /** What the user wrote, collapsed to one line. */
  source: string;
}

// A reserved word (where, with, and, between, is, …) can never start a statement, so a line
// beginning with one belongs to the line above.
const STATEMENT_START = /^\s*(let|draw)\b/;
const WORD_START = /^\s*([A-Za-z_][A-Za-z0-9_-]*)/;

/**
 * True when `text` cannot be a complete statement yet: an open parenthesis, or a trailing
 * `|`, `,` or `\`. The REPL uses this to ask for another line.
 */
export function isIncomplete(text: string): boolean {
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\" && quote !== "`") i++;
      else if (ch === quote) quote = null;
    } else if (QUOTES.has(ch)) quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
  }
  if (quote) return false; // let the tokenizer report the unterminated string
  return depth > 0 || /[|,\\]\s*$/.test(text);
}

/**
 * Group the physical lines of a script into statements. A line continues the statement above when
 * that statement is incomplete (see `isIncomplete`), when it is indented, or when it starts with
 * `|` or a reserved word (`with`, `against`, `where`, `by`, `and`, `or`, `between`, `is`, …). A blank line ends a statement
 * unless a parenthesis is still open. A trailing `\` is removed.
 */
export function splitStatements(source: string): StatementText[] {
  const out: StatementText[] = [];
  let current: { lines: string[]; line: number } | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.lines.join("\n").replace(/\\\s*$/, "");
    out.push({ text, line: current.line, source: text.trim().replace(/\s*\n\s*/g, " ") });
    current = null;
  };
  source.split(/\r?\n/).forEach((raw, idx) => {
    const text = stripComment(raw);
    if (text.trim() === "") {
      if (!current || !isIncomplete(current.lines.join("\n"))) flush();
      return;
    }
    const startsClause = /^\s*\|/.test(text) || RESERVED.has(WORD_START.exec(text)?.[1] ?? "");
    const continues =
      current !== null &&
      (isIncomplete(current.lines.join("\n")) || ((/^\s/.test(text) || startsClause) && !STATEMENT_START.test(text)));
    if (continues && current) {
      const last = current.lines.length - 1;
      current.lines[last] = current.lines[last].replace(/\\\s*$/, " ");
      current.lines.push(text);
    } else {
      flush();
      current = { lines: [text], line: idx + 1 };
    }
  });
  flush();
  return out;
}

/** Split a statement on unquoted `|` characters. Newlines inside the text advance the line number. */
export function splitPipes(line: string, lineNo: number): Segment[] {
  const segments: Segment[] = [];
  let quote: string | null = null;
  let start = 0;
  let curLine = lineNo;
  let startLine = lineNo;
  let lineStart = 0; // index of the first character of the current physical line
  let startCol = 1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\" && quote !== "`") i++;
      else if (ch === quote) quote = null;
    } else if (QUOTES.has(ch)) {
      quote = ch;
    } else if (ch === "\n") {
      curLine++;
      lineStart = i + 1;
    } else if (ch === "|") {
      segments.push({ text: line.slice(start, i), line: startLine, col: startCol });
      start = i + 1;
      startLine = curLine;
      startCol = start - lineStart + 1;
    }
  }
  if (quote) throw new DslError(`unterminated ${quote === "`" ? "backtick name" : "string"}`, startLine, startCol);
  segments.push({ text: line.slice(start), line: startLine, col: startCol });
  return segments;
}

/** Split raw command arguments on whitespace, honouring quotes. */
export function splitWords(text: string, lineNo: number, colOffset: number): string[] {
  const words: string[] = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      const end = text.indexOf(ch, i + 1);
      if (end < 0) throw new DslError("unterminated string", lineNo, colOffset + i);
      words.push(text.slice(i + 1, end));
      i = end + 1;
    } else {
      let j = i;
      while (j < text.length && !/\s/.test(text[j])) j++;
      words.push(text.slice(i, j));
      i = j;
    }
  }
  return words;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_-]/;
const DIGIT = /[0-9]/;

/**
 * Tokenize the text of one segment. `colOffset` is the 1-based column of `text[0]`; a newline in
 * the text moves to the next physical line (column 1).
 */
export function tokenize(text: string, lineNo: number, colOffset: number): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let curLine = lineNo;
  let lineStart = 0;
  const col = (idx: number) => idx - lineStart + (curLine === lineNo ? colOffset : 1);

  while (i < text.length) {
    const ch = text[i];
    if (ch === "\n") {
      curLine++;
      lineStart = i + 1;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let out = "";
      let closed = false;
      while (j < text.length) {
        const c = text[j];
        if (c === "\\" && j + 1 < text.length) {
          const n = text[j + 1];
          out += n === "n" ? "\n" : n === "t" ? "\t" : n;
          j += 2;
        } else if (c === ch) {
          closed = true;
          j++;
          break;
        } else {
          out += c;
          j++;
        }
      }
      if (!closed) throw new DslError("unterminated string", curLine, col(i));
      tokens.push({ type: "string", value: out, line: curLine, col: col(i) });
      i = j;
      continue;
    }

    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end < 0) throw new DslError("unterminated backtick name", curLine, col(i));
      tokens.push({ type: "qident", value: text.slice(i + 1, end), line: curLine, col: col(i) });
      i = end + 1;
      continue;
    }

    if (DIGIT.test(ch) || (ch === "-" && i + 1 < text.length && DIGIT.test(text[i + 1]))) {
      let j = i + 1;
      while (j < text.length && DIGIT.test(text[j])) j++;
      if (text[j] === "." && j + 1 < text.length && DIGIT.test(text[j + 1])) {
        j++;
        while (j < text.length && DIGIT.test(text[j])) j++;
      }
      tokens.push({ type: "number", value: text.slice(i, j), line: curLine, col: col(i) });
      i = j;
      continue;
    }

    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < text.length && IDENT_CHAR.test(text[j])) j++;
      tokens.push({ type: "ident", value: text.slice(i, j), line: curLine, col: col(i) });
      i = j;
      continue;
    }

    const two = text.slice(i, i + 2);
    if (two === "==" || two === "!=" || two === "<=" || two === ">=") {
      tokens.push({ type: "op", value: two, line: curLine, col: col(i) });
      i += 2;
      continue;
    }
    if (ch === "=" || ch === "<" || ch === ">") {
      tokens.push({ type: "op", value: ch, line: curLine, col: col(i) });
      i++;
      continue;
    }
    if (ch === "." || ch === "(" || ch === ")" || ch === "[" || ch === "]" || ch === ",") {
      tokens.push({ type: "punct", value: ch, line: curLine, col: col(i) });
      i++;
      continue;
    }

    throw new DslError(`unexpected character '${ch}'`, curLine, col(i));
  }

  tokens.push({ type: "eof", value: "", line: curLine, col: col(text.length) });
  return tokens;
}
