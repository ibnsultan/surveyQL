import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterpreter, Dataset, type IO, type Interpreter } from "../src/index";

export const FIXTURES = join(__dirname, "..", "fixtures");

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

export function fixtureText(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

export function dataset(): Dataset {
  return Dataset.fromJson(fixture("survey.json"), fixture("responses.json"));
}

export function schools(): Dataset {
  return Dataset.fromJson(fixture("schools.json"), fixture("schools-responses.json"));
}

/** In-memory IO for tests. Records written files. */
export class MemoryIO implements IO {
  written = new Map<string, string>();
  constructor(
    public files: Record<string, unknown> = {},
    public remote: Record<string, unknown> = {},
  ) {}
  async readJson(path: string): Promise<unknown> {
    if (path in this.files) return this.files[path];
    throw new Error(`file not found: ${path}`);
  }
  async fetchJson(url: string): Promise<unknown> {
    if (url in this.remote) return this.remote[url];
    throw new Error(`HTTP 404 for ${url}`);
  }
  async writeText(path: string, text: string): Promise<boolean> {
    this.written.set(path, text);
    return true;
  }
}

export function interpreter(opts: { preload?: boolean; seed?: number; io?: MemoryIO } = {}): { interp: Interpreter; io: MemoryIO } {
  const io =
    opts.io ??
    new MemoryIO({
      "fixtures/survey.json": fixture("survey.json"),
      "fixtures/responses.json": fixture("responses.json"),
      "fixtures/schools.json": fixture("schools.json"),
      "fixtures/schools-responses.json": fixture("schools-responses.json"),
      "fixtures/responses-endline.json": fixture("responses-endline.json"),
      "fixtures/inventory.json": fixture("inventory.json"),
      "fixtures/inventory-responses.json": fixture("inventory-responses.json"),
    });
  const interp = createInterpreter(io, { seed: opts.seed ?? 1 });
  if (opts.preload !== false) interp.dataset = dataset();
  return { interp, io };
}
