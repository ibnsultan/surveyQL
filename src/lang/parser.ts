import type { AliasPair, Arg, BinaryOp, ChartPart, Command, Expr, Literal, MatchOptions, Ref, Script, Statement } from "./ast";
import { DslError, isDslError } from "./errors";
import { splitPipes, splitStatements, splitWords, tokenize, type Segment } from "./lexer";
import { CALL_OPTIONS, EXPR_COMMANDS, MATCH_OPTIONS, PAIR_COMMANDS, PREFIXES, RAW_COMMANDS, RESERVED, SERIES_OPTIONS, type Prefix, type Token } from "./tokens";

const LET_RE = /^(\s*)let\s+([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*([\s\S]*)$/;
const WORD_RE = /^(\s*)([A-Za-z_][A-Za-z0-9_-]*)/;

/**
 * Parse a whole script. Physical lines are grouped into statements by `splitStatements`
 * (indentation, clause words, open parentheses and trailing `|`, `,` or `\` continue a
 * statement); parse errors are captured per statement.
 */
export function parse(source: string): Script {
  const statements: Statement[] = [];
  for (const st of splitStatements(source)) {
    try {
      statements.push(parseLine(st.text, st.line));
    } catch (e) {
      const err = isDslError(e) ? e : new DslError(String((e as Error).message ?? e));
      err.at(st.line, 1);
      statements.push({ kind: "error", line: st.line, source: st.source, error: err });
    }
  }
  return { statements };
}

/** Parse a single comment-free statement (possibly spanning lines joined with `\n`). */
export function parseLine(text: string, lineNo: number): Statement {
  const source = text.trim().replace(/\s*\n\s*/g, " ");
  const letMatch = LET_RE.exec(text);
  if (letMatch) {
    const [, lead, name, rest] = letMatch;
    const restCol = text.length - rest.length + 1;
    const segments = splitPipes(rest, lineNo).map((s) => ({ ...s, col: s.col + restCol - 1 }));
    if (name === "let" || RESERVED.has(name) || PREFIXES.has(name)) {
      throw new DslError(`'${name}' cannot be used as a variable name`, lineNo, lead.length + 5);
    }
    if (segments.length === 1) {
      const literal = tryLiteral(segments[0]);
      if (literal) return { kind: "let", line: lineNo, source, name, value: literal };
    }
    if (rest.trim() === "") throw new DslError(`let ${name}: missing value`, lineNo, restCol);
    return { kind: "let", line: lineNo, source, name, value: { kind: "pipeline", commands: parseSegments(segments) } };
  }
  const commands = parseSegments(splitPipes(text, lineNo));
  return { kind: "pipeline", line: lineNo, source, commands };
}

function tryLiteral(seg: Segment): Literal | null {
  let tokens: Token[];
  try {
    tokens = tokenize(seg.text, seg.line, seg.col);
  } catch {
    return null; // e.g. a path after `let x = load ./a/b.json`; not a literal
  }
  if (tokens.length !== 2) return null;
  const t = tokens[0];
  if (t.type === "number") return { kind: "literal", value: Number(t.value) };
  if (t.type === "string") return { kind: "literal", value: t.value };
  if (t.type === "ident" && (t.value === "true" || t.value === "false")) return { kind: "literal", value: t.value === "true" };
  return null;
}

function parseSegments(segments: Segment[]): Command[] {
  const commands: Command[] = [];
  for (const seg of segments) {
    if (seg.text.trim() === "") throw new DslError("empty command between pipes", seg.line, seg.col);
    commands.push(...parseCommand(seg));
  }
  return commands;
}

/** Parse one segment. Returns one command, or two when a `where` clause is desugared to `filter`. */
function parseCommand(seg: Segment): Command[] {
  const word = WORD_RE.exec(seg.text);
  if (!word) {
    const tokens = tokenize(seg.text, seg.line, seg.col);
    const t = tokens[0];
    throw new DslError(`expected a command, got ${describeToken(t)}`, t.line, t.col);
  }
  let name = word[2];
  let nameCol = seg.col + word[1].length;
  let rest = seg.text.slice(word[0].length);
  let restCol = seg.col + word[0].length;
  let prefix: Prefix | undefined;

  if (PREFIXES.has(name)) {
    const second = WORD_RE.exec(rest);
    if (!second) throw new DslError(`${name}: missing chart command, e.g. 'draw pie(gender)'`, seg.line, nameCol);
    prefix = name as Prefix;
    name = second[2];
    nameCol = restCol + second[1].length;
    restCol += second[0].length;
    rest = rest.slice(second[0].length);
  }

  if (RAW_COMMANDS.has(name)) {
    return [{ name, prefix, line: seg.line, col: nameCol, args: [], rawArgs: splitWords(rest, seg.line, restCol) }];
  }

  const p = new TokenParser(tokenize(rest, seg.line, restCol));
  const cmd: Command = { name, prefix, line: seg.line, col: nameCol, args: [] };

  if (EXPR_COMMANDS.has(name)) {
    if (p.atEnd()) throw new DslError(`${name}: missing expression`, seg.line, restCol);
    cmd.expr = p.parseExpr();
    p.expectEnd();
    return [cmd];
  }

  if (PAIR_COMMANDS.has(name)) {
    // rename Q5 as age, Q7 as region
    cmd.pairs = p.parsePairs(name);
  } else if (p.isPunct("(")) {
    // Call form: name(arg, arg) [with …] [against …] [where …] [by …]
    const { args, options } = p.parseCallArgs(name, prefix === "draw");
    cmd.args = args;
    if (options.length) cmd.options = options;
  } else {
    // Bare form: name arg arg …  or, SQL-like, name arg, arg, … (commas optional)
    while (!p.atEnd() && !p.atClause()) {
      cmd.args.push(p.parseArg());
      if (p.isPunct(",")) p.next();
    }
  }

  if (p.isKeyword("with")) {
    const kw = p.next();
    if (prefix !== "draw") throw new DslError("'with' is only valid after draw, e.g. draw bar(a) with line(b) against x", kw.line, kw.col);
    cmd.with = [];
    for (;;) {
      const t = p.next();
      if (t.type !== "ident") throw new DslError(`with: expected a chart call, got ${describeToken(t)}`, t.line, t.col);
      if (!p.isPunct("(")) {
        const n = p.peek();
        throw new DslError(`with: expected '(' after '${t.value}', got ${describeToken(n)}`, n.line, n.col);
      }
      const { args, options } = p.parseCallArgs(t.value, true);
      cmd.with.push({ name: t.value, args, options, line: t.line, col: t.col });
      if (p.isPunct(",")) p.next();
      else break;
    }
  }

  let where: Expr | undefined;
  while (!p.atEnd()) {
    if (p.isKeyword("where")) {
      const kw = p.next();
      if (where) throw new DslError("only one 'where' clause is allowed", kw.line, kw.col);
      where = p.parseExpr();
    } else if (p.isKeyword("by")) {
      const kw = p.next();
      if (cmd.by) throw new DslError("only one 'by' clause is allowed", kw.line, kw.col);
      cmd.by = p.parseRef();
    } else if (p.isKeyword("against")) {
      const kw = p.next();
      if (prefix !== "draw") throw new DslError("'against' is for charts; use 'by' here, e.g. avg(x) by gender", kw.line, kw.col);
      if (cmd.against) throw new DslError("only one 'against' clause is allowed", kw.line, kw.col);
      cmd.against = p.parseRef();
    } else if (p.isKeyword("with")) {
      const kw = p.next();
      throw new DslError("only one 'with' is allowed; list the extra charts after it separated by commas", kw.line, kw.col);
    } else if (p.isKeyword("on")) {
      const kw = p.next();
      if (name !== "join") throw new DslError("'on' is for join, e.g. join(inventory) on school_name", kw.line, kw.col);
      if (cmd.on) throw new DslError("only one 'on' clause is allowed", kw.line, kw.col);
      const left = p.parseRef();
      cmd.on = { left };
      if (p.isOp("=") || p.isOp("==")) {
        p.next();
        cmd.on.right = p.parseRef();
      }
    } else if (p.isKeyword("merge")) {
      const kw = p.next();
      if (name !== "union") throw new DslError("'merge' is for union, e.g. union(a, b) merge age as number", kw.line, kw.col);
      if (cmd.merge) throw new DslError("only one 'merge' clause is allowed", kw.line, kw.col);
      cmd.merge = p.parsePairs("merge");
    } else {
      const t = p.peek();
      throw new DslError(`unexpected ${describeToken(t)}`, t.line, t.col);
    }
  }

  if (where) {
    const filter: Command = { name: "filter", line: seg.line, col: nameCol, args: [], expr: where };
    return [filter, cmd];
  }
  return [cmd];
}

/** Source-like text of an argument, for labels and messages. */
export function argText(a: Arg): string {
  switch (a.kind) {
    case "ref":
      return a.text;
    case "number":
      return String(a.value);
    case "string":
      return JSON.stringify(a.value);
    case "call":
      return a.text;
    case "all":
      return "all";
  }
}

function describeToken(t: Token): string {
  if (t.type === "eof") return "end of line";
  if (t.type === "string") return `string "${t.value}"`;
  return `'${t.value}'`;
}

class TokenParser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  peek(): Token {
    return this.tokens[this.pos];
  }

  next(): Token {
    return this.tokens[this.pos++];
  }

  atEnd(): boolean {
    return this.peek().type === "eof";
  }

  isKeyword(word: string): boolean {
    const t = this.peek();
    return t.type === "ident" && t.value === word;
  }

  isPunct(ch: string): boolean {
    const t = this.peek();
    return t.type === "punct" && t.value === ch;
  }

  isOp(op: string): boolean {
    const t = this.peek();
    return t.type === "op" && t.value === op;
  }

  /** At a clause word that ends a command's own arguments. */
  atClause(): boolean {
    return ["where", "by", "against", "with", "on", "merge"].some((w) => this.isKeyword(w));
  }

  /** `ref as name, ref as name, …` up to the end or the next clause. */
  parsePairs(cmd: string): AliasPair[] {
    const pairs: AliasPair[] = [];
    while (!this.atEnd() && !this.atClause()) {
      const ref = this.parseRef();
      const kw = this.peek();
      if (!this.isKeyword("as")) throw new DslError(`${cmd}: expected 'as' after '${ref.text}', e.g. ${cmd} ${ref.text} as …`, kw.line, kw.col);
      this.next();
      const t = this.next();
      if (t.type !== "ident" && t.type !== "qident") throw new DslError(`${cmd}: expected a name after 'as', got ${describeToken(t)}`, t.line, t.col);
      if (t.type === "ident" && RESERVED.has(t.value)) throw new DslError(`${cmd}: '${t.value}' is a reserved word and cannot be used as a name`, t.line, t.col);
      pairs.push({ ref, as: t.value, line: ref.line, col: ref.col });
      if (this.isPunct(",")) this.next();
    }
    if (!pairs.length) {
      const t = this.peek();
      throw new DslError(`${cmd}: expected 'question as name', got ${describeToken(t)}`, t.line, t.col);
    }
    return pairs;
  }

  expectEnd(): void {
    if (!this.atEnd()) {
      const t = this.peek();
      throw new DslError(`unexpected ${describeToken(t)}`, t.line, t.col);
    }
  }

  /**
   * Parse `( arg, arg, option )`. Option words (`right`) are only recognised when `allowOptions`
   * is set (chart calls). Nested calls such as `sum(q)` are parsed one level deep.
   */
  parseCallArgs(name: string, allowOptions: boolean, depth = 0): { args: Arg[]; options: string[] } {
    const open = this.next();
    const args: Arg[] = [];
    const options: string[] = [];
    while (!this.isPunct(")")) {
      if (this.atEnd()) throw new DslError(`${name}: missing ')'`, open.line, open.col);
      const t = this.peek();
      const optionWords = allowOptions ? SERIES_OPTIONS : CALL_OPTIONS[name];
      if (optionWords && t.type === "ident" && optionWords.has(t.value)) {
        this.next();
        if (!options.includes(t.value)) options.push(t.value);
      } else if (t.type === "ident" && t.value === "all" && name !== "count") {
        throw new DslError("'all' is only valid as count(all)", t.line, t.col);
      } else {
        args.push(this.parseArg(depth));
      }
      if (this.isPunct(",")) this.next();
      else if (!this.isPunct(")")) {
        const n = this.peek();
        throw new DslError(`${name}: expected ',' or ')', got ${describeToken(n)}`, n.line, n.col);
      }
    }
    this.next();
    return { args, options };
  }

  parseArg(depth = 0): Arg {
    const t = this.peek();
    if (t.type === "number") {
      this.next();
      return { kind: "number", value: Number(t.value), line: t.line, col: t.col };
    }
    if (t.type === "string") {
      this.next();
      return { kind: "string", value: t.value, line: t.line, col: t.col };
    }
    if (t.type === "ident" && t.value === "all") {
      this.next();
      return { kind: "all", line: t.line, col: t.col };
    }
    if (t.type === "ident" && this.tokens[this.pos + 1]?.type === "punct" && this.tokens[this.pos + 1].value === "(") {
      // Nested call, e.g. sum(number_computers) inside bar(...)
      if (depth >= 1) throw new DslError(`'${t.value}(...)' cannot be nested this deep`, t.line, t.col);
      this.next();
      const { args } = this.parseCallArgs(t.value, false, depth + 1);
      const text = `${t.value}(${args.map(argText).join(", ")})`;
      return { kind: "call", name: t.value, args, options: [], text, line: t.line, col: t.col };
    }
    if (t.type === "ident" || t.type === "qident") return this.parseRef();
    throw new DslError(`unexpected ${describeToken(t)}`, t.line, t.col);
  }

  parseRef(): Ref {
    const t = this.next();
    if (t.type === "ident" && t.value === "all") {
      throw new DslError("'all' is only valid as count(all)", t.line, t.col);
    }
    if (t.type === "ident" && RESERVED.has(t.value)) {
      throw new DslError(`'${t.value}' is a reserved word; write it as \`${t.value}\` to refer to a question`, t.line, t.col);
    }
    if (t.type === "ident" && MATCH_OPTIONS.has(t.value)) {
      throw new DslError(`'${t.value}' is an option word for is(...) / contains(...); write it as \`${t.value}\` to refer to a question`, t.line, t.col);
    }
    if (t.type !== "ident" && t.type !== "qident") {
      throw new DslError(`expected a question name, got ${describeToken(t)}`, t.line, t.col);
    }
    const path = [t.value];
    let text = t.type === "qident" ? `\`${t.value}\`` : t.value;
    while (this.isPunct(".")) {
      this.next();
      const n = this.next();
      if (n.type !== "ident" && n.type !== "qident" && n.type !== "number") {
        throw new DslError(`expected a name after '.', got ${describeToken(n)}`, n.line, n.col);
      }
      path.push(n.value);
      text += "." + (n.type === "qident" ? `\`${n.value}\`` : n.value);
    }
    return { kind: "ref", path, text, line: t.line, col: t.col };
  }

  // expr := or
  parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.isKeyword("or")) {
      const t = this.next();
      const right = this.parseAnd();
      left = { kind: "binary", op: "or", left, right, line: t.line, col: t.col };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.isKeyword("and")) {
      const t = this.next();
      const right = this.parseNot();
      left = { kind: "binary", op: "and", left, right, line: t.line, col: t.col };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.isKeyword("not")) {
      const t = this.next();
      return { kind: "not", expr: this.parseNot(), line: t.line, col: t.col };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    const left = this.parsePrimary();
    const t = this.peek();
    if (t.type === "ident" && t.value === "between") {
      // x between(a, b)  or  x between a and b   →   x >= a and x <= b
      this.next();
      let lo: Expr;
      let hi: Expr;
      if (this.isPunct("(")) {
        const { values, options } = this.parseMatchArgs("between");
        if (Object.keys(options).length || values.length !== 2) {
          throw new DslError("between(...) takes exactly two values, e.g. between(25, 40)", t.line, t.col);
        }
        [lo, hi] = values;
      } else {
        lo = this.parsePrimary();
        if (!this.isKeyword("and")) {
          const n = this.peek();
          throw new DslError(`expected 'and' after 'between', got ${describeToken(n)}; or write between(a, b)`, n.line, n.col);
        }
        this.next();
        hi = this.parsePrimary();
      }
      return {
        kind: "binary",
        op: "and",
        left: { kind: "binary", op: ">=", left, right: lo, line: t.line, col: t.col },
        right: { kind: "binary", op: "<=", left, right: hi, line: t.line, col: t.col },
        line: t.line,
        col: t.col,
      };
    }
    if (t.type === "ident" && (t.value === "is" || t.value === "contains")) {
      // x is v | x is not v | x is(v1, v2, strict) | x contains(v, regex)
      this.next();
      let negate = false;
      if (this.isKeyword("not")) {
        this.next();
        negate = true;
      }
      let values: Expr[];
      let options: MatchOptions = {};
      if (this.isPunct("(")) {
        ({ values, options } = this.parseMatchArgs(t.value));
        if (!values.length) throw new DslError(`${t.value}(...) needs at least one value`, t.line, t.col);
      } else {
        values = [this.parsePrimary()];
      }
      return { kind: "match", op: t.value, left, values, options, negate, line: t.line, col: t.col };
    }
    let op: BinaryOp | null = null;
    if (t.type === "op") {
      op = (t.value === "=" ? "==" : t.value) as BinaryOp;
    } else if (t.type === "ident" && t.value === "in") {
      op = t.value;
    }
    if (!op) return left;
    this.next();
    const right = this.parsePrimary();
    return { kind: "binary", op, left, right, line: t.line, col: t.col };
  }

  /** Parse `( value, value, option )` after is / contains / between. */
  private parseMatchArgs(name: string): { values: Expr[]; options: MatchOptions } {
    const open = this.next();
    const values: Expr[] = [];
    const options: MatchOptions = {};
    while (!this.isPunct(")")) {
      if (this.atEnd()) throw new DslError(`${name}: missing ')'`, open.line, open.col);
      const t = this.peek();
      if (t.type === "ident" && MATCH_OPTIONS.has(t.value)) {
        this.next();
        options[t.value as keyof MatchOptions] = true;
      } else {
        values.push(this.parsePrimary());
      }
      if (this.isPunct(",")) this.next();
      else if (!this.isPunct(")")) {
        const n = this.peek();
        throw new DslError(`${name}: expected ',' or ')', got ${describeToken(n)}`, n.line, n.col);
      }
    }
    this.next();
    return { values, options };
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    if (t.type === "number") {
      this.next();
      return { kind: "literal", value: Number(t.value), line: t.line, col: t.col };
    }
    if (t.type === "string") {
      this.next();
      return { kind: "literal", value: t.value, line: t.line, col: t.col };
    }
    if (t.type === "ident" && (t.value === "true" || t.value === "false" || t.value === "null")) {
      this.next();
      const value = t.value === "null" ? null : t.value === "true";
      return { kind: "literal", value, line: t.line, col: t.col };
    }
    if (this.isPunct("(")) {
      this.next();
      const e = this.parseExpr();
      if (!this.isPunct(")")) {
        const n = this.peek();
        throw new DslError(`expected ')', got ${describeToken(n)}`, n.line, n.col);
      }
      this.next();
      return e;
    }
    if (this.isPunct("[")) {
      const open = this.next();
      const items: Expr[] = [];
      while (!this.isPunct("]")) {
        if (this.atEnd()) throw new DslError("unterminated list", open.line, open.col);
        items.push(this.parsePrimary());
        if (this.isPunct(",")) this.next();
        else if (!this.isPunct("]")) {
          const n = this.peek();
          throw new DslError(`expected ',' or ']', got ${describeToken(n)}`, n.line, n.col);
        }
      }
      this.next();
      return { kind: "list", items, line: open.line, col: open.col };
    }
    if (t.type === "ident" || t.type === "qident") return this.parseRef();
    throw new DslError(`unexpected ${describeToken(t)}`, t.line, t.col);
  }
}
