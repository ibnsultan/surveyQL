import { describe, expect, it } from "vitest";
import { buildChartSpec } from "../src/visualization/spec";
import { serializeValue } from "../src/visualization/commands";
import { dataset, interpreter } from "./helpers";

const ds = dataset();

describe("chart specs", () => {
  it("bar spec is JSON-safe and carries labels and counts", () => {
    const v = buildChartSpec("bar", ds.resolve(["satisfaction"]), ds);
    expect(v.chartType).toBe("bar");
    expect(v.spec.data.labels).toEqual(["1", "2", "3", "4", "5"]);
    expect(v.spec.data.series[0].values).toEqual([1, 3, 4, 7, 4]);
    expect(JSON.parse(JSON.stringify(v.spec))).toEqual(v.spec);
    expect(v.spec.layout).toMatchObject({ horizontal: true, legend: false, note: "1 · very unsatisfied   5 · very satisfied" });
    expect(v.spec.apex).toMatchObject({ chart: { type: "bar", stacked: true }, plotOptions: { bar: { horizontal: true } }, xaxis: { categories: ["1", "2", "3", "4", "5"], title: { text: "1 · very unsatisfied   5 · very satisfied" } } });
    // a single series gets a grey "track" series that fills the row and carries the value label
    const apex = v.spec.apex as { series: { name: string; data: number[]; track?: number[] }[]; dataLabels: { enabledOnSeries: number[] } };
    expect(apex.series.map((s) => s.name)).toEqual(["Responses", ""]);
    expect(apex.series[1].track).toEqual([0]);
    expect(apex.series[1].data.map((x, i) => Math.round((x + apex.series[0].data[i]) * 100) / 100)).toEqual([7.14, 7.14, 7.14, 7.14, 7.14]); // every row fills to max * 1.02
    expect(apex.dataLabels.enabledOnSeries).toEqual([1]);
    expect(buildChartSpec("bar", ds.resolve(["gender"]), ds).spec.layout.note).toBeUndefined();
    expect(buildChartSpec("vbar", ds.resolve(["satisfaction"]), ds).spec.apex).toMatchObject({ xaxis: { title: { text: "1 · very unsatisfied   5 · very satisfied" } } });
    expect(buildChartSpec("pie", ds.resolve(["satisfaction"]), ds).spec.apex).toMatchObject({ subtitle: { text: "1 · very unsatisfied   5 · very satisfied" } });
    const line = buildChartSpec("line", ds.resolve(["satisfaction"]), ds);
    expect(line.spec.data.labels).toEqual(["1", "2", "3", "4", "5"]); // a rating keeps its scale, it is not binned
    expect(line.spec.apex).toMatchObject({ chart: { type: "line" }, xaxis: { title: { text: "1 · very unsatisfied   5 · very satisfied" } } });
  });

  it("pie/doughnut use per-slice colors; vbar is vertical", () => {
    const pie = buildChartSpec("pie", ds.resolve(["gender"]), ds);
    expect(pie.spec.apex).toMatchObject({ chart: { type: "pie" }, series: [8, 9, 3], labels: ["Male", "Female", "Other"] });
    expect((pie.spec.apex as { colors: string[] }).colors.length).toBe(3);
    const donut = buildChartSpec("doughnut", ds.resolve(["gender"]), ds);
    expect(donut.spec.apex).toMatchObject({ chart: { type: "donut" } });
    const vbar = buildChartSpec("vbar", ds.resolve(["colors"]), ds);
    expect(vbar.spec.apex).toMatchObject({ chart: { type: "bar" }, plotOptions: { bar: { horizontal: false } } });
  });

  it("matrix bar is stacked with one series per column", () => {
    const v = buildChartSpec("bar", ds.resolve(["features"]), ds);
    expect(v.spec.data.labels).toEqual(["Price", "Quality", "Support"]);
    expect(v.spec.data.series.map((s) => s.label)).toEqual(["Bad", "OK", "Good"]);
    expect(v.spec.layout.stacked).toBe(true);
    expect(v.spec.apex).toMatchObject({ chart: { type: "bar", stacked: true }, xaxis: { categories: ["Price", "Quality", "Support"] } });
  });

  it("hist bins numbers and gauge summarizes", () => {
    const h = buildChartSpec("hist", ds.resolve(["age"]), ds, { bins: 4 });
    expect(h.spec.data.series[0].values.reduce((a, b) => a + b)).toBe(20);
    expect(h.spec.data.labels.length).toBe(4);
    const g = buildChartSpec("gauge", ds.resolve(["satisfaction"]), ds);
    expect(g.spec.stats).toMatchObject({ min: 1, max: 5, avg: 3.5263 });
  });

  it("rejects mismatched kinds with hints", () => {
    expect(() => buildChartSpec("hist", ds.resolve(["gender"]), ds)).toThrow(/not numeric; try 'draw bar\(gender\)'/);
    expect(() => buildChartSpec("pie", ds.resolve(["income"]), ds)).toThrow(/try 'draw hist\(income\)'/);
    expect(() => buildChartSpec("bar", ds.resolve(["comment"]), ds)).toThrow(/cannot be charted/);
  });

  it("chart commands and save work through the interpreter", async () => {
    const { interp, io } = interpreter();
    const results = await interp.run(`pie gender | save out/gender.json
count gender | save out/gender.csv
hist age 3 where subscribed == true
let c = bar colors
c | save out/colors.json`);
    for (const r of results) expect(r.error).toBeUndefined();
    expect(results[0].value).toEqual({ kind: "message", text: "Saved out/gender.json" });
    expect(JSON.parse(io.written.get("out/gender.json")!)).toMatchObject({ apex: { chart: { type: "pie" } } });
    expect(io.written.get("out/gender.csv")).toBe("value,label,count,percent\nmale,Male,8,40\nfemale,Female,9,45\nother,Other,3,15\n");
    expect(results[2].value).toMatchObject({ kind: "chart", chartType: "hist" });
    expect((results[2].value as { spec: { data: { series: { values: number[] }[] } } }).spec.data.series[0].values.reduce((a, b) => a + b)).toBe(12);
    expect(JSON.parse(io.written.get("out/colors.json")!)).toMatchObject({ apex: { chart: { type: "bar" } } });
  });

  it("serializeValue rejects CSV for scalars", () => {
    expect(() => serializeValue({ kind: "scalar", label: "x", value: 1 }, "a.csv")).toThrow(/only tables and rows/);
  });
});
