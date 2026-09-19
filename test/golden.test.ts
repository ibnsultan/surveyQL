import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toJsonValue } from "../src/interpreter/values";
import { fixtureText, interpreter } from "./helpers";

const GOLDEN = join(__dirname, "golden", "example.expected.json");

describe("golden end-to-end", () => {
  it("matches the recorded output of fixtures/example.svql (UPDATE_GOLDEN=1 to regenerate)", async () => {
    const { interp } = interpreter({ preload: false, seed: 42 });
    const results = await interp.run(fixtureText("example.svql"));
    const actual = results.map((r) => ({
      line: r.line,
      source: r.source,
      value: r.value ? toJsonValue(r.value) : undefined,
      error: r.error ? r.error.message : undefined,
    }));
    for (const r of actual) expect(r.error, `line ${r.line}: ${r.source}`).toBeUndefined();

    if (process.env.UPDATE_GOLDEN || !existsSync(GOLDEN)) {
      mkdirSync(join(__dirname, "golden"), { recursive: true });
      writeFileSync(GOLDEN, JSON.stringify(actual, null, 2) + "\n");
    }
    const expected = JSON.parse(readFileSync(GOLDEN, "utf8"));
    expect(actual).toEqual(expected);
  });
});
