import { describe, expect, it } from "vitest";
import { parseLine } from "../src/lang/parser";
import { buildSeriesChart } from "../src/visualization/series";
import type { ChartValue } from "../src/interpreter/values";
import { interpreter, schools } from "./helpers";

const ds = schools();

/** Parse a draw line and build its series chart directly. */
function chart(line: string, data = ds): ChartValue {
  const st = parseLine(line, 1);
  if (st.kind !== "pipeline") throw new Error(st.kind);
  const cmd = st.commands[st.commands.length - 1];
  const parts = [{ name: cmd.name, args: cmd.args, options: cmd.options ?? [], line: cmd.line, col: cmd.col }, ...(cmd.with ?? [])];
  return buildSeriesChart(parts, cmd.against!, data);
}

/** Drop the second Kikuyu Primary row so every school appears once. */
const uniqueSchools = ds.where((r) => !(r.school_name === "Kikuyu Primary" && r.month === "2026-06"));

describe("series charts", () => {
  it("plots a bare numeric question against a unique key as raw values in group order", () => {
    const v = chart("draw bar(cpus) against school_name", uniqueSchools);
    expect(v.spec.mode).toBe("series");
    expect(v.spec.against).toBe("school_name");
    expect(v.spec.data.labels.slice(0, 3)).toEqual(["Kikuyu Primary", "Mlimwa Secondary", "Chamwino Primary"]);
    expect(v.spec.data.series).toEqual([{ label: "cpus", values: [22, 38, 8, 30, 58, 44, 50, 12, 16, 34, 10], type: "bar", axis: "left" }]);
    expect(v.spec.layout).toMatchObject({ horizontal: true, legend: false });
    expect(v.spec.apex).toMatchObject({ chart: { type: "bar" }, plotOptions: { bar: { horizontal: true } } });
    expect(v.title).toBe("bar(cpus) against School name");
  });

  it("applies the intelligent default aggregate when the key repeats and shows it in the legend", () => {
    const v = chart("draw bar(monitors, it_rating, has_lab) against region");
    expect(v.spec.data.labels).toEqual(["Dodoma", "Dar es Salaam", "Arusha"]);
    const [monitors, rating, yes, no] = v.spec.data.series;
    expect(monitors).toMatchObject({ label: "sum(monitors)", values: [130, 169, 63] });
    expect(rating).toMatchObject({ label: "avg(it_rating)", values: [3.4, 3.75, 2.6667] });
    expect(yes).toMatchObject({ label: "has_lab: Yes", values: [4, 3, 2] });
    expect(no).toMatchObject({ label: "has_lab: No", values: [1, 1, 1] });
    // only the choice counts stack with each other; the other series stand beside them, and a
    // grey track series follows for every group (the row's background)
    const apexSeries = (v.spec.apex as { series: { group?: string; track?: number[] }[] }).series;
    expect(apexSeries.slice(0, 4).map((d) => d.group)).toEqual(["s1", "s2", "has_lab", "has_lab"]);
    expect(apexSeries.slice(4).map((d) => d.track)).toEqual([[0], [1], [2, 3]]);
    // the repeated school is summed too
    const s = chart("draw bar(monitors) against school_name");
    expect(s.spec.data.series[0].label).toBe("sum(monitors)");
    expect(s.spec.data.series[0].values[0]).toBe(52);
  });

  it("explicit aggregates override the default, count(all) counts responses", () => {
    const v = chart("draw vbar(avg(cpus), max(cpus), count(all)) against region");
    expect(v.spec.data.series.map((s) => s.label)).toEqual(["avg(cpus)", "max(cpus)", "count(all)"]);
    expect(v.spec.data.series[0].values).toEqual([24.8, 41, 20]);
    expect(v.spec.data.series[2].values).toEqual([5, 4, 3]);
    expect(v.spec.layout.horizontal).toBe(false);
  });

  it("takes any number of series in one call", () => {
    const v = chart("draw bar(monitors, printers, cpus, routers) against school_name", uniqueSchools);
    expect(v.spec.data.series.map((s) => s.label)).toEqual(["monitors", "printers", "cpus", "routers"]);
    expect(new Set((v.spec.apex as { colors: string[] }).colors.slice(0, 4)).size).toBe(4);
  });

  it("combines chart types with 'with', forces vertical bars and adds a right axis", () => {
    const v = chart("draw bar(monitors, printers) with line(students), line(working_computers, right) against school_name", uniqueSchools);
    expect(v.spec.data.series.map((s) => [s.label, s.type, s.axis])).toEqual([
      ["monitors", "bar", "left"],
      ["printers", "bar", "left"],
      ["students", "line", "left"],
      ["working_computers", "line", "right"],
    ]);
    const apex = v.spec.apex as { series: { type: string }[]; yaxis: { opposite: boolean }[]; plotOptions: { bar: { horizontal: boolean } } };
    expect(v.spec.layout.horizontal).toBe(false);
    expect(apex.plotOptions.bar.horizontal).toBe(false);
    expect(apex.series.map((s) => s.type)).toEqual(["column", "column", "line", "line"]);
    expect(apex.yaxis[3]).toMatchObject({ opposite: true, show: true });
    expect(v.title).toBe("bar(monitors, printers) with line(students) with line(working_computers) against School name");
    expect(JSON.parse(JSON.stringify(v.spec))).toEqual(v.spec);
  });

  it("'right' inside a call applies to every series in that call", () => {
    const v = chart("draw bar(cpus) with line(students, working_computers, right) against school_name", uniqueSchools);
    expect(v.spec.data.series.map((s) => s.axis)).toEqual(["left", "right", "right"]);
    const noRight = chart("draw bar(cpus) with line(students) against school_name", uniqueSchools);
    // no explicit right axis: cpus (≤58) and students (hundreds) are far enough apart to get independent hidden scales
    expect(noRight.spec.layout.scales).toBe("independent");
    expect((noRight.spec.apex as { yaxis: { show: boolean; opposite?: boolean }[] }).yaxis.every((y) => y.show === false && !y.opposite)).toBe(true);
  });

  it("pie takes exactly one aggregate series with one slice per group", () => {
    const v = chart("draw pie(sum(students)) against region");
    expect(v.spec.apex).toMatchObject({ chart: { type: "pie" } });
    expect(v.spec.data.labels).toEqual(["Dodoma", "Dar es Salaam", "Arusha"]);
    expect(v.spec.data.series[0].values).toEqual([3405, 3960, 1820]);
    expect(() => chart("draw pie(cpus, students) against region")).toThrow(/exactly one series/);
    expect(() => chart("draw pie(cpus) with line(students) against region")).toThrow(/single ring/);
    expect(() => chart("draw pie(has_lab) against region")).toThrow(/choice question cannot be sliced/);
    expect(() => chart("draw pie(cpus, right) against region")).toThrow(/'right' only applies/);
  });

  it("count(q) as a series: per-choice counts for scaled questions, non-empty counts otherwise", () => {
    const v = chart("draw bar(it_rating, count(it_rating)) against region");
    expect(v.spec.data.series.map((s) => s.label)).toEqual(["avg(it_rating)", "count(it_rating): 1", "count(it_rating): 2", "count(it_rating): 3", "count(it_rating): 4", "count(it_rating): 5"]);
    expect(v.spec.data.series[4].values).toEqual([3, 0, 1]); // rating 4 per region
    const n = chart("draw bar(count(cpus), count(school_name)) against region");
    expect(n.spec.data.series.map((s) => s.values)).toEqual([[5, 4, 3], [5, 4, 3]]);
  });

  it("line of count(all) against a choice key follows choice order", () => {
    const v = chart("draw line(count(all)) against month");
    expect(v.spec.data.labels).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun"]);
    expect(v.spec.data.series[0].values).toEqual([2, 2, 2, 2, 2, 2]);
    expect(v.spec.apex).toMatchObject({ chart: { type: "line" } });
  });

  it("rejects kinds and series that make no sense against a key", () => {
    expect(() => chart("draw hist(cpus) against region")).toThrow(/'hist' cannot be used with against/);
    expect(() => chart("draw bar(cpus) with gauge(students) against region")).toThrow(/'gauge' cannot be used with against/);
    expect(() => chart("draw bar(school_name) against region")).toThrow(/free text/);
    expect(() => chart("draw bar(count(cpus)) against region")).not.toThrow();
    expect(() => chart("draw bar(median(has_lab)) against region")).toThrow(/not numeric/);
    expect(() => chart("draw bar(nope(cpus)) against region")).toThrow(/is not an aggregate/);
    expect(() => chart("draw bar(cpus) against nope")).toThrow(/unknown question 'nope'/);
  });

  it("builds ApexCharts options for mixed, stacked and pie series charts", () => {
    const v = chart("draw bar(monitors, printers) with line(students, right) against school_name", uniqueSchools);
    const apex = v.spec.apex as { chart: { type: string; stacked: boolean }; series: { name: string; type: string }[]; yaxis: { opposite: boolean; show: boolean; seriesName: string }[]; plotOptions: { bar: { horizontal: boolean } } };
    expect(apex.chart).toMatchObject({ type: "line", stacked: false });
    expect(apex.series.map((s) => [s.name, s.type])).toEqual([
      ["monitors", "column"],
      ["printers", "column"],
      ["students", "line"],
    ]);
    expect(apex.yaxis.map((y) => [y.seriesName, y.opposite, y.show])).toEqual([
      ["monitors", false, true],
      ["monitors", false, false],
      ["students", true, true],
    ]);
    expect(apex.plotOptions.bar.horizontal).toBe(false);
    // stacked choice counts share a group; a horizontal bar chart stays horizontal
    const stacked = chart("draw bar(has_lab, monitors) against region");
    const sApex = stacked.spec.apex as { chart: { stacked: boolean }; series: { group?: string; track?: number[] }[]; plotOptions: { bar: { horizontal: boolean } } };
    expect(sApex.chart.stacked).toBe(true);
    expect(sApex.series.slice(0, 3).map((s) => s.group)).toEqual(["has_lab", "has_lab", "s3"]);
    expect(sApex.series.slice(3).map((s) => s.track)).toEqual([[0, 1], [2]]);
    expect(sApex.plotOptions.bar.horizontal).toBe(true);
    const pie = chart("draw pie(sum(students)) against region");
    expect(pie.spec.apex).toMatchObject({ chart: { type: "pie" }, labels: ["Dodoma", "Dar es Salaam", "Arusha"] });
    expect(JSON.parse(JSON.stringify(pie.spec.apex))).toEqual(pie.spec.apex);
  });

  it("gives series of very different magnitude independent scales", () => {
    // monitors and cpus (both around a hundred per region): shared axis. it_rating (≤5) next to students: independent.
    const shared = chart("draw bar(monitors, cpus) against region");
    expect(shared.spec.layout.scales).toBe("shared");
    const h = chart("draw bar(avg(it_rating), sum(students)) against region");
    expect(h.spec.layout.scales).toBe("independent");
    // horizontal: lengths are percentages of each series' maximum, the real numbers stay in data;
    // several bars per row are shrunk a little so whitespace separates them
    type Point = { x: string; y: number; barHeightOffset: number };
    const hApex = h.spec.apex as { series: { data: Point[] }[]; xaxis: { max: number }; dataLabels: { enabled: boolean } };
    expect(hApex.series[0].data.map((d) => d.y)).toEqual([90.67, 100, 71.11]);
    expect(hApex.series[1].data.map((d) => d.y)).toEqual([85.98, 100, 45.96]);
    expect(hApex.series[0].data[0]).toEqual({ x: "Dodoma", y: 90.67, barHeightOffset: -4 });
    expect(hApex.xaxis.max).toBe(120);
    expect(hApex.dataLabels.enabled).toBe(true);
    expect(h.spec.data.series[0].values).toEqual([3.4, 3.75, 2.6667]);
    // vertical: one hidden axis per series, real values plotted
    const v = chart("draw vbar(avg(it_rating), sum(students)) against region");
    const vApex = v.spec.apex as { series: { data: number[] }[]; yaxis: { seriesName: string; show: boolean }[] };
    expect(vApex.series[1].data).toEqual([3405, 3960, 1820]);
    expect(vApex.yaxis.map((y) => [y.seriesName, y.show])).toEqual([
      ["avg(it_rating)", false],
      ["sum(students)", false],
    ]);
    // stacked choice counts are one group measured by their total; an explicit right axis switches it off
    const stacked = chart("draw bar(has_lab, sum(students)) against region");
    expect(stacked.spec.layout.scales).toBe("independent");
    expect((stacked.spec.apex as { series: { data: Point[] }[] }).series[0].data.map((d) => d.y)).toEqual([80, 60, 40]); // Yes counts 4,3,2 over stack totals 5,4,3, scaled to the tallest stack
    expect(chart("draw bar(avg(it_rating)) with line(sum(students), right) against region").spec.layout.scales).toBe("shared");
  });

  it("runs end to end through the interpreter, with where and save", async () => {
    const { interp, io } = interpreter({ preload: false });
    const results = await interp.run(`load fixtures/schools.json fixtures/schools-responses.json
draw bar(cpus) against school_name where region is "dodoma"
draw bar(monitors) with line(students, right) against school_name | save out/schools.json
draw bar(cpus) with line(students)
draw bar(cpus, right)
count(all)
count(all) by region
count()
avg(cpus) by region`);
    const errors = results.map((r) => r.error?.message);
    expect(errors[1]).toBeUndefined();
    expect((results[1].value as ChartValue).spec.data.labels).toEqual(["Kikuyu Primary", "Mlimwa Secondary", "Chamwino Primary", "Msalato Girls"]);
    expect(results[2].value).toEqual({ kind: "message", text: "Saved out/schools.json" });
    const saved = JSON.parse(io.written.get("out/schools.json")!);
    expect(saved.apex.series).toHaveLength(2);
    expect(saved.data.series).toHaveLength(2);
    expect(errors[3]).toMatch(/'with' needs 'against'/);
    expect(errors[4]).toMatch(/'right' only applies to charts drawn against/);
    expect(results[5].value).toMatchObject({ kind: "scalar", value: 12 });
    expect(results[6].value).toMatchObject({ kind: "table", rows: [["Dodoma", 5], ["Dar es Salaam", 4], ["Arusha", 3]] });
    expect(results[7].value).toMatchObject({ kind: "scalar", value: 12 });
    expect(results[8].value).toMatchObject({ kind: "table" });
  });
});
