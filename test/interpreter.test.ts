import { describe, expect, it } from "vitest";
import type { Value } from "../src/interpreter/values";
import { interpreter } from "./helpers";

async function one(script: string, opts?: Parameters<typeof interpreter>[0]): Promise<Value | undefined> {
  const { interp } = interpreter(opts);
  const results = await interp.run(script);
  const last = results[results.length - 1];
  if (last.error) throw last.error;
  return last.value;
}

describe("interpreter", () => {
  it("loads from files via IO", async () => {
    const v = await one("load fixtures/survey.json fixtures/responses.json", { preload: false });
    expect(v).toEqual({ kind: "message", text: "Loaded 20 responses, 8 questions" });
  });

  it("errors when nothing is loaded", async () => {
    const { interp } = interpreter({ preload: false });
    const [r] = await interp.run("avg age");
    expect(r.error?.message).toMatch(/no data loaded/);
  });

  it("computes scalars, with where and pipes", async () => {
    expect(await one("avg age")).toEqual({ kind: "scalar", label: "avg(age)", value: 36.6 });
    expect(await one('sum income where gender == "female"')).toMatchObject({ value: 473000 });
    expect(await one("filter age > 30 | avg income")).toMatchObject({ value: 64833.3333 });
    expect(await one("filter age > 30 | filter subscribed | count")).toMatchObject({ value: 8 });
    expect(await one("count")).toMatchObject({ value: 20 });
    expect(await one("count income")).toMatchObject({ value: 18 });
    expect(await one("median age")).toMatchObject({ value: 34.5 });
  });

  it("call form and bare form give the same results", async () => {
    expect(await one("avg(age)")).toEqual(await one("avg age"));
    expect(await one("count()")).toMatchObject({ value: 20 });
    expect(await one('sum(income) where gender == "female"')).toMatchObject({ value: 473000 });
    expect(await one("avg(income) where age between 25 and 40")).toMatchObject({ value: 50222.2222 });
    expect(await one("avg(income) where age < 30 or age > 60")).toMatchObject({ value: 36285.7143 });
    expect(await one("sample(2)")).toMatchObject({ kind: "rows" });
    expect(await one("questions()")).toMatchObject({ kind: "table" });
    expect(await one("hist(age, 4)")).toMatchObject({ kind: "chart", chartType: "hist" });
  });

  it("validates the draw prefix", async () => {
    const { interp } = interpreter();
    const results = await interp.run(`draw pie(gender)
draw avg(age)
draw filter age > 1
let c = draw bar(gender)
draw c
let n = 1
draw n`);
    expect(results[0].value).toMatchObject({ kind: "chart", chartType: "pie" });
    expect(results[1].error?.message).toMatch(/'draw avg' is not valid: avg is not a chart/);
    expect(results[2].error?.message).toMatch(/'draw filter' is not valid/);
    expect(results[4].value).toMatchObject({ kind: "chart", chartType: "bar" });
    expect(results[6].error?.message).toMatch(/draw n: variable is a scalar, not a chart/);
  });

  it("get: several measures in one table, grouped or not, and projections", async () => {
    const grouped = await one("get avg(income), count(all), median(age) by gender");
    expect(grouped).toMatchObject({ kind: "table", columns: ["gender", "avg(income)", "count(all)", "median(age)"] });
    expect((grouped as { rows: unknown[][] }).rows).toEqual([
      ["Male", 50571.4286, 8, 31],
      ["Female", 59125, 9, 37],
      ["Other", 50000, 3, 26],
    ]);
    const single = await one("get avg(income), count(all)");
    expect(single).toMatchObject({ kind: "table", columns: ["avg(income)", "count(all)"], rows: [[54277.7778, 20]] });
    // bare questions use the chart defaults; the key itself is skipped; choice questions expand
    const defaults = await one("get gender, income, satisfaction, subscribed by gender");
    expect((defaults as { columns: string[] }).columns).toEqual(["gender", "sum(income)", "avg(satisfaction)", "subscribed: Yes", "subscribed: No"]);
    // projection
    const proj = await one("get age, gender, income where age > 50");
    expect(proj).toMatchObject({ kind: "rows", columns: ["age", "gender", "income"], total: 3 });
    expect((proj as { rows: Record<string, unknown>[] }).rows.map((r) => r.age)).toEqual([52, 63, 58]);
    // commas are optional in the bare form; parentheses also work
    expect(await one("get avg(income) count(all)")).toMatchObject({ columns: ["avg(income)", "count(all)"] });
    expect(await one("get(avg(income), count(all))")).toMatchObject({ columns: ["avg(income)", "count(all)"] });
  });

  it("get: errors", async () => {
    const { interp } = interpreter();
    const results = await interp.run(`get income, count(all)
get
get 5
get nope(age)`);
    expect(results[0].error?.message).toMatch(/needs 'by <question>'/);
    expect(results[1].error?.message).toMatch(/name what to get/);
    expect(results[2].error?.message).toMatch(/expected a question or an aggregate, got 5/);
    expect(results[3].error?.message).toMatch(/'nope' is not an aggregate/);
  });

  it("aggregates take an optional number of decimal places", async () => {
    expect(await one("avg(income)")).toMatchObject({ value: 54277.7778 });
    expect(await one("avg(income, 2)")).toMatchObject({ label: "avg(income)", value: 54277.78 });
    expect(await one("avg(income, 0)")).toMatchObject({ value: 54278 });
    expect(await one("stddev(income, 8)")).toMatchObject({ value: 19943.46584888 });
    expect(await one("avg(income, 1) by gender")).toMatchObject({ rows: [["Male", 50571.4, 8], ["Female", 59125, 9], ["Other", 50000, 3]] });
    // in get and in series charts too; the header stays avg(income)
    expect(await one("get avg(income, 2), median(age, 0) by gender")).toMatchObject({
      columns: ["gender", "avg(income)", "median(age)"],
      rows: [["Male", 50571.43, 31], ["Female", 59125, 37], ["Other", 50000, 26]],
    });
    const chart = (await one("draw bar(avg(income, 1)) against gender")) as { spec: { data: { series: { label: string; values: number[] }[] } } };
    expect(chart.spec.data.series[0]).toMatchObject({ label: "avg(income)", values: [50571.4, 59125, 50000] });
    // a variable works as the number of places
    const { interp } = interpreter();
    const [, r] = await interp.run(`let dp = 2
avg(income, dp)`);
    expect(r.value).toMatchObject({ value: 54277.78 });
    const bad = await interp.run(`avg(income, 2.5)
avg(income, 11)
avg(income, gender)
get avg(income, -1)
avg(income, 2, 3)`);
    for (const b of bad.slice(0, 4)) expect(b.error?.message).toMatch(/decimal places must be a whole number from 0 to 10/);
    expect(bad[4].error?.message).toMatch(/unexpected argument 3/);
  });

  it("builds frequency tables and cross-tabs", async () => {
    const t = await one("count gender");
    expect(t).toMatchObject({ kind: "table", columns: ["value", "label", "count", "percent"] });
    expect((t as { rows: unknown[][] }).rows.map((r) => r[2])).toEqual([8, 9, 3]);

    const by = await one("count subscribed by gender");
    expect(by).toMatchObject({ kind: "table", columns: ["gender", "Yes", "No"] });
    expect((by as { rows: unknown[][] }).rows).toEqual([
      ["Male", 3, 5],
      ["Female", 7, 2],
      ["Other", 2, 1],
    ]);
  });

  it("aggregates by a group", async () => {
    const t = await one("avg satisfaction by gender");
    expect((t as { rows: unknown[][] }).rows).toEqual([
      ["Male", 3, 8],
      ["Female", 4, 9],
      ["Other", 3.5, 3],
    ]);
  });

  it("returns typed errors for wrong question kinds", async () => {
    const { interp } = interpreter();
    const [r] = await interp.run("avg gender");
    expect(r.error?.message).toMatch(/category question, not numeric; use 'count\(gender\)'/);
    const [r2] = await interp.run("nonsense age");
    expect(r2.error?.message).toMatch(/unknown command 'nonsense'/);
    expect(r2.error?.line).toBe(1);
  });

  it("samples deterministically with a seed", async () => {
    const a = await one("sample 3", { seed: 7 });
    const b = await one("sample 3", { seed: 7 });
    expect(a).toEqual(b);
    expect((a as { rows: unknown[] }).rows.length).toBe(3);
  });

  it("binds and uses variables", async () => {
    const { interp } = interpreter({ seed: 3 });
    const results = await interp.run(`let n = 3
let adults = filter age >= 18
let avgIncome = avg income
sample n
adults | count
adults | avg income
avgIncome
filter age > n | count
let g = "female"
count where gender == g`);
    const values = results.map((r) => (r.error ? `ERR ${r.error.message}` : r.value));
    expect(values[0]).toEqual({ kind: "message", text: "n = 3" });
    expect(values[1]).toEqual({ kind: "message", text: "adults = dataset (19 rows)" });
    expect(values[2]).toEqual({ kind: "message", text: "avgIncome = 54277.7778" });
    expect(values[3]).toMatchObject({ kind: "rows" });
    expect((values[3] as { rows: unknown[] }).rows.length).toBe(3);
    expect(values[4]).toMatchObject({ value: 19 });
    expect(values[5]).toMatchObject({ value: 54277.7778 });
    expect(values[6]).toEqual({ kind: "scalar", label: "avg(income)", value: 54277.7778 });
    expect(values[7]).toMatchObject({ value: 20 });
    expect(values[9]).toMatchObject({ value: 9 });
  });

  it("does not let a let-bound load replace the default dataset", async () => {
    const { interp, io } = interpreter();
    io.files["./data/other.json"] = { elements: [{ type: "text", name: "x", inputType: "number" }] };
    io.files["./data/other-data.json"] = [{ x: 1 }, { x: 3 }];
    const results = await interp.run(`let other = load ./data/other.json ./data/other-data.json
other | avg x
avg age`);
    expect(results[0].value).toEqual({ kind: "message", text: "other = dataset (2 rows)" });
    expect(results[1].value).toMatchObject({ value: 2 });
    expect(results[2].value).toMatchObject({ value: 36.6 });
  });

  it("rejects arguments on variables and unknown names", async () => {
    const { interp } = interpreter();
    const results = await interp.run(`let n = 3
n 5
avg n
sample m`);
    expect(results[1].error?.message).toMatch(/takes no arguments/);
    expect(results[2].error?.message).toMatch(/is a variable, not a question/);
    expect(results[3].error?.message).toMatch(/sample: expected a number, got m/);
  });

  it("keeps running after a bad line", async () => {
    const { interp } = interpreter();
    const results = await interp.run('avg age\ncount "x\nsum income');
    expect(results.map((r) => !!r.error)).toEqual([false, true, false]);
  });

  it("describes a question and the whole survey", async () => {
    const one1 = await one("describe age");
    expect((one1 as { rows: unknown[][] }).rows).toContainEqual(["mean", 36.6]);
    const all = await one("describe");
    expect((all as { rows: unknown[][] }).rows.length).toBe(8);
  });

  it("can list questions and flag shadowed names", async () => {
    const { interp } = interpreter();
    await interp.run("let age = 1");
    const [r] = await interp.run("questions");
    expect((r.value as { rows: unknown[][] }).rows[0][0]).toBe("age (shadowed by variable)");
  });
});
