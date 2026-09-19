import { describe, expect, it } from "vitest";

/** The core and CLI entry points must never pull survey-analytics (which needs a DOM) into Node. */
describe("node safety", () => {
  it("core entry imports without a DOM", async () => {
    expect(typeof document).toBe("undefined");
    const mod = await import("../src/index");
    expect(typeof mod.createInterpreter).toBe("function");
    const sc = await import("../src/surveycore/index");
    expect(typeof sc.Dataset).toBe("function");
    const vis = await import("../src/visualization/index");
    expect(typeof vis.buildChartSpec).toBe("function");
  });
});
