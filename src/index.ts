import { Interpreter, type InterpreterOptions } from "./interpreter/interpreter";
import type { CommandImpl, IO } from "./interpreter/context";
import { surveycoreCommands } from "./surveycore/commands";
import { visualizationCommands } from "./visualization/commands";

export { Interpreter, seededRandom } from "./interpreter/interpreter";
export type { RunResult, InterpreterOptions } from "./interpreter/interpreter";
export type { IO, Env, PipeContext, CommandImpl, CommandKind } from "./interpreter/context";
export * from "./interpreter/values";
export { parse, parseLine, splitStatements, isIncomplete, DslError, isDslError } from "./lang";
export type { Script, Statement, Command, Expr, Ref, Arg } from "./lang/ast";
export { Dataset } from "./surveycore/dataset";
export type { Column, ColumnType, Choice, Row } from "./surveycore/dataset";
export { loadDataset, loadSource, fetchJson, isUrl } from "./surveycore/loader";
export { surveycoreCommands } from "./surveycore/commands";
export { visualizationCommands } from "./visualization/commands";
export { buildChartSpec } from "./visualization/spec";

export interface CreateOptions extends InterpreterOptions {
  /** Extra commands to register on top of the built-in ones. */
  commands?: CommandImpl[];
}

/** Create an interpreter with the surveycore and visualization command sets. */
export function createInterpreter(io: IO, options: CreateOptions = {}): Interpreter {
  return new Interpreter([...surveycoreCommands, ...visualizationCommands, ...(options.commands ?? [])], io, options);
}
