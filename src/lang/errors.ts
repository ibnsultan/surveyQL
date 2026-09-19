/** Error raised by the lexer, parser or interpreter, carrying a source position when known. */
export class DslError extends Error {
  line?: number;
  col?: number;

  constructor(message: string, line?: number, col?: number) {
    super(message);
    this.name = "DslError";
    this.line = line;
    this.col = col;
  }

  /** Attach a position if the error does not already have one. */
  at(line?: number, col?: number): this {
    if (this.line === undefined && line !== undefined) this.line = line;
    if (this.col === undefined && col !== undefined) this.col = col;
    return this;
  }

  toString(): string {
    return this.line !== undefined ? `line ${this.line}: ${this.message}` : this.message;
  }
}

export function isDslError(e: unknown): e is DslError {
  return e instanceof DslError || (typeof e === "object" && e !== null && (e as Error).name === "DslError");
}
