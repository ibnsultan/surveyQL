import type { Command, Statement } from "../lang/ast";
import { DslError, isDslError } from "../lang/errors";
import { parse, parseLine } from "../lang/parser";
import type { Dataset } from "../surveycore/dataset";
import type { CommandImpl, Env, IO, PipeContext } from "./context";
import type { Value } from "./values";

export interface RunResult {
  line: number;
  source: string;
  value?: Value;
  error?: DslError;
}

export interface InterpreterOptions {
  /** Seed for the sample RNG. Unseeded uses Math.random. */
  seed?: number;
}

/** Small deterministic PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Interpreter {
  readonly env: Env;
  private commands = new Map<string, CommandImpl>();

  constructor(commands: CommandImpl[], io: IO, options: InterpreterOptions = {}) {
    for (const impl of commands) for (const name of impl.names) this.commands.set(name, impl);
    this.env = {
      dataset: null,
      vars: new Map(),
      io,
      rng: options.seed !== undefined ? seededRandom(options.seed) : Math.random,
    };
  }

  /** Names of all registered commands (for help and the REPL). */
  get commandNames(): string[] {
    return [...new Set([...this.commands.values()].flatMap((c) => c.names))].sort();
  }

  get commandList(): CommandImpl[] {
    return [...new Set(this.commands.values())];
  }

  get dataset(): Dataset | null {
    return this.env.dataset;
  }

  set dataset(ds: Dataset | null) {
    this.env.dataset = ds;
  }

  /** Run a whole script. Never throws for DSL errors; each statement gets its own result. */
  async run(source: string): Promise<RunResult[]> {
    const script = parse(source);
    const results: RunResult[] = [];
    for (const st of script.statements) results.push(await this.runStatement(st));
    return results;
  }

  /** Run a single line (REPL). */
  async runLine(line: string, lineNo = 1): Promise<RunResult> {
    let st: Statement;
    try {
      st = parseLine(line, lineNo);
    } catch (e) {
      return { line: lineNo, source: line.trim(), error: this.wrap(e, lineNo) };
    }
    return this.runStatement(st);
  }

  async runStatement(st: Statement): Promise<RunResult> {
    if (st.kind === "error") return { line: st.line, source: st.source, error: st.error };
    try {
      if (st.kind === "let") {
        const value = await this.evalLet(st);
        this.env.vars.set(st.name, value);
        return { line: st.line, source: st.source, value: { kind: "message", text: `${st.name} = ${describe(value)}` } };
      }
      const ctx = await this.runPipeline(st.commands);
      const value = ctx.value ?? (ctx.dataset && ctx.dataset !== this.env.dataset ? { kind: "dataset", dataset: ctx.dataset } : null);
      return { line: st.line, source: st.source, value: value ?? undefined };
    } catch (e) {
      return { line: st.line, source: st.source, error: this.wrap(e, st.line) };
    }
  }

  private async evalLet(st: Extract<Statement, { kind: "let" }>): Promise<Value> {
    if (st.value.kind === "literal") return { kind: "scalar", label: st.name, value: st.value.value };
    const ctx = await this.runPipeline(st.value.commands, { bindingDataset: true });
    if (ctx.value) {
      if (ctx.value.kind === "message" && ctx.dataset && ctx.dataset !== this.env.dataset) {
        return { kind: "dataset", dataset: ctx.dataset };
      }
      return ctx.value;
    }
    if (ctx.dataset) return { kind: "dataset", dataset: ctx.dataset };
    throw new DslError(`let ${st.name}: the pipeline produced no value`, st.line);
  }

  /** Run one pipeline; the first command may be a variable name. */
  async runPipeline(commands: Command[], opts: { bindingDataset?: boolean } = {}): Promise<PipeContext> {
    let ctx: PipeContext = { dataset: this.env.dataset, value: null };
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      const impl = this.commands.get(cmd.name);
      const variable = this.env.vars.get(cmd.name);

      if (variable && (!impl || i === 0)) {
        if (cmd.args.length || cmd.expr || cmd.by || cmd.rawArgs?.length) {
          throw new DslError(`'${cmd.name}' is a variable and takes no arguments`, cmd.line, cmd.col);
        }
        if (i !== 0) throw new DslError(`variable '${cmd.name}' can only start a pipeline`, cmd.line, cmd.col);
        if (cmd.prefix === "draw" && variable.kind !== "chart") {
          throw new DslError(`draw ${cmd.name}: variable is a ${variable.kind}, not a chart`, cmd.line, cmd.col);
        }
        ctx = variable.kind === "dataset" ? { dataset: variable.dataset, value: null, name: cmd.name } : { dataset: ctx.dataset, value: variable };
        continue;
      }
      if (!impl) {
        throw new DslError(`unknown command '${cmd.name}'`, cmd.line, cmd.col);
      }
      if (cmd.prefix === "draw" && impl.kind !== "draw") {
        throw new DslError(`'draw ${cmd.name}' is not valid: ${cmd.name} is not a chart; write '${cmd.name}(…)' without draw`, cmd.line, cmd.col);
      }
      if (impl.setsDefault && !opts.bindingDataset && i === 0) {
        ctx = await impl.run(ctx, cmd, this.env);
        this.env.dataset = ctx.dataset;
        continue;
      }
      ctx = await impl.run(ctx, cmd, this.env);
    }
    return ctx;
  }

  private wrap(e: unknown, line: number): DslError {
    if (isDslError(e)) return e.at(line);
    const err = new DslError(e instanceof Error ? e.message : String(e), line);
    return err;
  }
}

function describe(v: Value): string {
  switch (v.kind) {
    case "scalar":
      return typeof v.value === "string" ? JSON.stringify(v.value) : String(v.value);
    case "dataset":
      return `dataset (${v.dataset.rows.length} rows)`;
    case "table":
      return `table (${v.rows.length} rows)`;
    case "rows":
      return `rows (${v.rows.length})`;
    case "chart":
      return `chart ${v.chartType} ${v.question}`;
    case "message":
      return v.text;
  }
}
