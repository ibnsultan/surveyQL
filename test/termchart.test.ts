import { describe, expect, it } from "vitest";
import { renderChartText } from "../src/cli/termchart";
import { formatValue } from "../src/cli/format";
import type { ChartValue } from "../src/interpreter/values";
import { interpreter } from "./helpers";

async function chart(line: string): Promise<ChartValue> {
  const { interp } = interpreter();
  const [r] = await interp.run(line);
  if (r.error) throw r.error;
  return r.value as ChartValue;
}

describe("terminal charts", () => {
  it("draws bars over a track with the value at the end and the scale note", async () => {
    const text = renderChartText(await chart("draw bar(satisfaction)"), { color: false, width: 60 });
    const lines = text.split("\n");
    expect(lines[0]).toBe("Overall satisfaction");
    expect(lines[1]).toMatch(/^  1  █+░+  1$/);
    expect(lines[4]).toMatch(/^  4  █+  7$/); // the maximum fills the whole track
    expect(lines.at(-1)).toBe("  1 · very unsatisfied   5 · very satisfied");
    // every bar has the same width
    const widths = new Set(lines.slice(1, 6).map((l) => l.replace(/^  \d  /, "").replace(/  \d$/, "").length));
    expect(widths.size).toBe(1);
  });

  it("colours bars with 24-bit escapes only when asked", async () => {
    const v = await chart("draw pie(gender)");
    const plain = renderChartText(v, { color: false, width: 70 });
    const colored = renderChartText(v, { color: true, width: 70 });
    expect(plain).not.toContain("\x1b[");
    expect(colored).toContain("\x1b[38;2;47;158;91m"); // first palette colour
    expect(colored.replace(/\x1b\[[0-9;]*m/g, "")).toBe(plain);
    expect(plain).toMatch(/Male\s+█+░+  8  40\.0%/);
  });

  it("stacks choice counts, scales right-axis and far-apart series on their own, and marks line series", async () => {
    const { interp } = interpreter({ preload: false });
    const results = await interp.run(`load fixtures/schools.json fixtures/schools-responses.json
draw bar(has_lab) against region
draw bar(monitors) with line(students, right) against region
draw bar(avg(it_rating), sum(students)) against region
draw bar(features)`);
    const stacked = renderChartText(results[1].value as ChartValue, { color: false, width: 80 });
    expect(stacked).toContain("■ has_lab: Yes   ■ has_lab: No");
    expect(stacked).toMatch(/Dodoma\s+█+  4 \+ 1 = 5/);
    const right = renderChartText(results[2].value as ChartValue, { color: false, width: 80 });
    expect(right).toMatch(/▬+░*  3,405/);
    expect(right).toContain("series on the right axis have their own scale");
    const independent = renderChartText(results[3].value as ChartValue, { color: false, width: 80 });
    expect(independent).toContain("each series to its own scale");
    expect(results[4].error?.message).toMatch(/unknown question/); // schools has no matrix
  });

  it("formatValue draws charts by default and can fall back to the one-line preview", async () => {
    const v = await chart("draw gauge(satisfaction)");
    expect(formatValue(v, { color: false })).toMatch(/^\[chart gauge satisfaction\]\nOverall satisfaction: avg 3\.5263 \(1–5\)\n  █+░+  3\.5263\n  1 … 5$/);
    expect(formatValue(v, { drawCharts: false, chartPath: "out/x.json" })).toBe(["[chart gauge satisfaction] Overall satisfaction -> out/x.json", "  Average: 3.5263"].join("\n"));
  });
});
