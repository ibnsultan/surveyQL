import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { IO } from "../interpreter/context";
import { DslError } from "../lang/errors";
import { fetchJson } from "../surveycore/loader";

/** Filesystem + fetch backed IO for the CLI. Paths resolve against `cwd`. */
export class NodeIO implements IO {
  constructor(private cwd: string = process.cwd()) {}

  async readJson(path: string): Promise<unknown> {
    const full = resolve(this.cwd, path);
    let text: string;
    try {
      text = await readFile(full, "utf8");
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      throw new DslError(code === "ENOENT" ? `file not found: ${path}` : `cannot read ${path}: ${(e as Error).message}`);
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new DslError(`${path} is not valid JSON: ${(e as Error).message}`);
    }
  }

  fetchJson(url: string): Promise<unknown> {
    return fetchJson(url);
  }

  async writeText(path: string, text: string): Promise<boolean> {
    const full = resolve(this.cwd, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, text, "utf8");
    return true;
  }
}
