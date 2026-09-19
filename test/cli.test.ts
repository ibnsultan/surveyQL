import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers";

const exec = promisify(execFile);
const ROOT = join(__dirname, "..");
const CLI = join(ROOT, "dist", "cli", "main.js");
const SURVEY = join(FIXTURES, "survey.json");
const DATA = join(FIXTURES, "responses.json");

async function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const r = await exec("node", [CLI, ...args], { cwd: ROOT });
    return { code: 0, ...r };
  } catch (e) {
    const err = e as { code: number; stdout: string; stderr: string };
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}

describe.skipIf(!existsSync(CLI))("cli (requires npm run build)", () => {
  it("evals a line with --json", async () => {
    const r = await cli(["eval", "avg age", "--survey", SURVEY, "--data", DATA, "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toMatchObject({ line: 1, value: { kind: "scalar", value: 36.6 } });
  });

  it("prints tables and exits 1 on an error", async () => {
    const r = await cli(["eval", "count(gender); avg(gender)", "--survey", SURVEY, "--data", DATA]);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/count\(gender\)/);
    expect(r.stdout).toMatch(/Female\s+9/);
    expect(r.stderr).toMatch(/error \(line 2\): avg: 'gender' is a category question/);
  });

  it("runs a script and writes chart specs to --out", async () => {
    const out = mkdtempSync(join(tmpdir(), "svql-"));
    try {
      const r = await cli(["run", join(FIXTURES, "example.svql"), "--out", out, "--seed", "1"]);
      expect(r.stderr).toBe("");
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/Loaded 20 responses/);
      const spec = JSON.parse(readFileSync(join(out, "01-bar-satisfaction.json"), "utf8"));
      expect(spec.apex.chart.type).toBe("bar");
      expect(existsSync(join(out, "02-pie-gender.json"))).toBe(true);
      expect(existsSync(join(out, "03-hist-age.json"))).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
      rmSync(join(ROOT, "charts", "gender.json"), { force: true });
    }
  });

  it("shows usage without a command", async () => {
    const r = await cli([]);
    expect(r.code).toBe(2);
    expect(r.stdout).toMatch(/Usage:/);
  });

  describe("remote sources", () => {
    let server: Server;
    let base = "";
    beforeAll(async () => {
      server = createServer((req, res) => {
        const body = req.url === "/survey.json" ? fixture("survey.json") : req.url === "/responses.json" ? { data: fixture("responses.json") } : null;
        if (!body) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const addr = server.address() as { port: number };
      base = `http://127.0.0.1:${addr.port}`;
    });
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    it("loads survey and data from URLs via flags and via load", async () => {
      const r = await cli(["eval", "count", "--survey", `${base}/survey.json`, "--data", `${base}/responses.json`]);
      expect(r.stderr).toBe("");
      expect(r.stdout.trim()).toBe("count = 20");
      const r2 = await cli(["eval", `load ${base}/survey.json ${base}/responses.json; avg age`]);
      expect(r2.stdout).toMatch(/avg\(age\) = 36.6/);
      const r3 = await cli(["eval", `load ${base}/nope.json`]);
      expect(r3.code).toBe(1);
      expect(r3.stderr).toMatch(/HTTP 404/);
    });
  });
});
