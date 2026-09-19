import type { Command } from "../lang/ast";
import { DslError } from "../lang/errors";
import type { Dataset } from "../surveycore/dataset";
import type { Value } from "./values";

/** Host I/O. The CLI uses the filesystem and `fetch`; the browser uses `fetch` and an in-memory file map. */
export interface IO {
  readJson(path: string): Promise<unknown>;
  fetchJson(url: string): Promise<unknown>;
  /** Returns false when the host cannot write files (browser); the interpreter then reports the content instead. */
  writeText(path: string, text: string): Promise<boolean>;
}

export interface Env {
  /** Default dataset from the last plain `load` (or preloaded by the host). */
  dataset: Dataset | null;
  vars: Map<string, Value>;
  io: IO;
  /** Random source for `sample`; seedable for tests. */
  rng: () => number;
}

/** State threaded through one pipeline. */
export interface PipeContext {
  dataset: Dataset | null;
  value: Value | null;
  /** Variable name the dataset came from, when the pipeline started with one (used by join messages). */
  name?: string;
}

/** `value` commands compute something, `draw` commands produce charts (written `draw pie(q)`), `action` commands do I/O or filtering. */
export type CommandKind = "value" | "draw" | "action";

export interface CommandImpl {
  names: string[];
  kind: CommandKind;
  /** One-line usage string for `:help`. */
  usage?: string;
  /** Plain use at the start of a statement (not inside `let`) makes the resulting dataset the default (`load`, `use`). */
  setsDefault?: boolean;
  run(ctx: PipeContext, cmd: Command, env: Env): Promise<PipeContext> | PipeContext;
}

export function requireDataset(ctx: PipeContext, cmd: Command): Dataset {
  if (!ctx.dataset) {
    throw new DslError(`${cmd.name}: no data loaded; run 'load <survey> <responses>' first`, cmd.line, cmd.col);
  }
  return ctx.dataset;
}
