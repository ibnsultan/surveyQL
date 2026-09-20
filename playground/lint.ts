/**
 * A simple static linter for SurveyQL scripts, playground only.
 *
 * It reports, without running anything:
 *   - parse errors, one per statement, straight from the language's parser;
 *   - unknown command names, and `draw` in front of something that is not a chart;
 *   - question references that the loaded dataset cannot resolve (as warnings).
 *
 * The question check is deliberately conservative: it skips statements that operate on a
 * different dataset (a variable at the head of the pipeline, or union / join / rename /
 * use) since their columns are not known without running the script.
 */
import { parse, type Arg, type Command, type Dataset, type Expr, type Ref, type Statement } from "surveyql";
import type { CommandImpl } from "surveyql";

export interface Diagnostic {
  line: number;
  col?: number;
  message: string;
  severity: "error" | "warning";
}

export interface LintOptions {
  /** Registered commands; when given, unknown names are reported. */
  commands?: CommandImpl[];
  /** The default dataset; when given, unknown question names are reported. */
  dataset?: Dataset | null;
  /** Names bound outside the script (the playground's sources); never reported as unknown. */
  variables?: string[];
}

/** Commands after which the pipeline's columns differ from the default dataset's. */
const CHANGES_COLUMNS = new Set(["union", "join", "rename", "use", "load", "save", "export"]);

export function lint(source: string, opts: LintOptions = {}): Diagnostic[] {
  const out: Diagnostic[] = [];
  const script = parse(source);
  const impls = new Map<string, CommandImpl>();
  for (const impl of opts.commands ?? []) for (const name of impl.names) impls.set(name, impl);
  const vars = new Set(opts.variables ?? []);

  for (const st of script.statements) {
    if (st.kind === "error") {
      out.push({ line: st.error.line ?? st.line, col: st.error.col, message: st.error.message, severity: "error" });
      continue;
    }
    const commands = statementCommands(st);
    checkCommands(commands, impls, vars, opts.commands !== undefined, out);
    if (opts.dataset) checkQuestions(commands, opts.dataset, vars, out);
    if (st.kind === "let") vars.add(st.name);
  }
  return out.sort((a, b) => a.line - b.line || (a.col ?? 0) - (b.col ?? 0));
}

function statementCommands(st: Statement): Command[] {
  if (st.kind === "pipeline") return st.commands;
  if (st.kind === "let" && st.value.kind === "pipeline") return st.value.commands;
  return [];
}

function checkCommands(commands: Command[], impls: Map<string, CommandImpl>, vars: Set<string>, haveImpls: boolean, out: Diagnostic[]): void {
  commands.forEach((cmd, i) => {
    const impl = impls.get(cmd.name);
    const isVar = vars.has(cmd.name) && (!impl || i === 0);
    if (isVar) {
      if (i !== 0) out.push({ line: cmd.line, col: cmd.col, message: `variable '${cmd.name}' can only start a pipeline`, severity: "error" });
      else if (cmd.args.length || cmd.expr || cmd.by) out.push({ line: cmd.line, col: cmd.col, message: `'${cmd.name}' is a variable and takes no arguments`, severity: "error" });
      return;
    }
    if (!haveImpls) return;
    if (!impl) {
      out.push({ line: cmd.line, col: cmd.col, message: `unknown command '${cmd.name}'`, severity: "error" });
      return;
    }
    if (cmd.prefix === "draw" && impl.kind !== "draw") {
      out.push({ line: cmd.line, col: cmd.col, message: `'draw ${cmd.name}' is not valid: ${cmd.name} is not a chart`, severity: "error" });
    }
  });
}

function checkQuestions(commands: Command[], dataset: Dataset, vars: Set<string>, out: Diagnostic[]): void {
  if (!commands.length) return;
  if (vars.has(commands[0].name)) return; // another dataset (or a stored value): columns unknown
  if (commands.some((c) => CHANGES_COLUMNS.has(c.name))) return;

  const seen = new Set<string>();
  const check = (ref: Ref) => {
    if (vars.has(ref.path[0])) return; // a `let` variable used as a value
    if (seen.has(ref.text)) return;
    seen.add(ref.text);
    try {
      dataset.resolve(ref);
    } catch (e) {
      out.push({ line: ref.line, col: ref.col, message: (e as Error).message, severity: "warning" });
    }
  };

  for (const cmd of commands) {
    cmd.args.forEach((a) => walkArg(a, check));
    if (cmd.expr) walkExpr(cmd.expr, check);
    if (cmd.by) check(cmd.by);
    if (cmd.against) check(cmd.against);
    cmd.with?.forEach((part) => part.args.forEach((a) => walkArg(a, check)));
  }
}

function walkArg(arg: Arg, visit: (ref: Ref) => void): void {
  if (arg.kind === "ref") visit(arg);
  else if (arg.kind === "call") arg.args.forEach((a) => walkArg(a, visit));
}

function walkExpr(expr: Expr, visit: (ref: Ref) => void): void {
  switch (expr.kind) {
    case "ref":
      visit(expr);
      break;
    case "binary":
      walkExpr(expr.left, visit);
      walkExpr(expr.right, visit);
      break;
    case "match":
      walkExpr(expr.left, visit);
      expr.values.forEach((v) => walkExpr(v, visit));
      break;
    case "not":
      walkExpr(expr.expr, visit);
      break;
    case "list":
      expr.items.forEach((v) => walkExpr(v, visit));
      break;
    case "literal":
      break;
  }
}
