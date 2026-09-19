import { describe, expect, it } from "vitest";
import type { ChartValue, TableValue } from "../src/interpreter/values";
import { parse } from "../src/lang/parser";
import { Dataset } from "../src/surveycore/dataset";
import { fixture, interpreter, MemoryIO } from "./helpers";

/** survey.json with `age` as free text, satisfaction on a 1–10 scale and an extra question. */
function surveyV2(): unknown {
  const s = JSON.parse(JSON.stringify(fixture("survey.json"))) as { pages: { elements: Record<string, unknown>[] }[] };
  for (const e of s.pages[0].elements) {
    if (e.name === "age") e.inputType = "text";
    if (e.name === "satisfaction") e.rateMax = 10;
  }
  s.pages[0].elements.push({ type: "text", name: "referral", title: "How did you hear about us?" });
  return s;
}

function io(): MemoryIO {
  return new MemoryIO({
    "survey.json": fixture("survey.json"),
    "survey-v2.json": surveyV2(),
    "baseline.json": fixture("responses.json"),
    "endline.json": fixture("responses-endline.json"),
    "schools.json": fixture("schools.json"),
    "schools-responses.json": fixture("schools-responses.json"),
    "inventory.json": fixture("inventory.json"),
    "inventory-responses.json": fixture("inventory-responses.json"),
  });
}

async function run(script: string) {
  const { interp } = interpreter({ preload: false, io: io() });
  return { interp, results: await interp.run(script) };
}

const SOURCES = `let baseline = load survey.json baseline.json
let endline = load survey.json endline.json
let schools = load schools.json schools-responses.json
let inventory = load inventory.json inventory-responses.json
`;

describe("parser: on / as / merge / rename", () => {
  it("parses join options, on with one or two keys, merge pairs and rename pairs", () => {
    const [j1, j2, u, r, e1, e2] = parse(`join(inventory, loose, inner) on school_name
join(schools, inventory) on school_name = school
union(a, b) merge age as number, region as text
rename Q5 as age, Q7 as region
avg(age) on x
union(a, b) merge age`).statements;
    if (j1.kind !== "pipeline" || j2.kind !== "pipeline" || u.kind !== "pipeline" || r.kind !== "pipeline") throw new Error();
    expect(j1.commands[0]).toMatchObject({ name: "join", options: ["loose", "inner"], on: { left: { path: ["school_name"] } } });
    expect(j1.commands[0].on?.right).toBeUndefined();
    expect(j2.commands[0].on).toMatchObject({ left: { path: ["school_name"] }, right: { path: ["school"] } });
    expect(u.commands[0].merge?.map((m) => [m.ref.text, m.as])).toEqual([
      ["age", "number"],
      ["region", "text"],
    ]);
    expect(r.commands[0].pairs?.map((m) => [m.ref.text, m.as])).toEqual([
      ["Q5", "age"],
      ["Q7", "region"],
    ]);
    expect(e1.kind === "error" && e1.error.message).toMatch(/'on' is for join/);
    expect(e2.kind === "error" && e2.error.message).toMatch(/expected 'as' after 'age'/);
  });
});

describe("sources and use", () => {
  it("lists bound datasets and switches the default with use", async () => {
    const { results } = await run(`${SOURCES}sources()
use schools
count(all)
sources()
use nope
use baseline endline`);
    const first = results[4].value as TableValue;
    expect(first.columns).toEqual(["name", "responses", "questions", "origin", "default"]);
    expect(first.rows.map((r) => [r[0], r[1], r[4]])).toEqual([
      ["baseline", 20, ""],
      ["endline", 15, ""],
      ["schools", 12, ""],
      ["inventory", 11, ""],
    ]);
    expect(results[5].value).toMatchObject({ kind: "message", text: "Using schools: 12 responses, 11 questions" });
    expect(results[6].value).toMatchObject({ value: 12 });
    expect((results[7].value as TableValue).rows.find((r) => r[0] === "schools")?.[4]).toBe("yes");
    expect(results[8].error?.message).toMatch(/'nope' is not a variable/);
    expect(results[9].error?.message).toMatch(/name one dataset variable/);
  });
});

describe("union", () => {
  it("stacks compatible questionnaires and adds a source column", async () => {
    const { results, interp } = await run(`${SOURCES}union(baseline, endline)
let waves = union(baseline, endline)
waves | count(all) by source
waves | avg(satisfaction, 2) by source
waves | count(baseline.gender)
waves | questions()
waves | show(1)`);
    expect(results[4].value).toMatchObject({ kind: "message", text: "Combined 35 responses from baseline (20), endline (15). Merged: 8 questions." });
    const waves = interp.env.vars.get("waves");
    expect(waves?.kind === "dataset" && waves.dataset.combined).toBe(true);
    expect(waves?.kind === "dataset" && waves.dataset.origin).toBe("union(baseline, endline)");
    expect((results[6].value as TableValue).rows).toEqual([
      ["baseline", 20],
      ["endline", 15],
    ]);
    expect((results[7].value as TableValue).rows.map((r) => r[0])).toEqual(["baseline", "endline"]);
    // qualified names read only their own source's rows
    const q = results[8].value as TableValue;
    expect(q.rows.find((r) => r[1] === "(no answer)")?.[2]).toBe(15);
    const questions = results[9].value as TableValue;
    expect(questions.columns).toContain("in");
    expect(questions.rows[0].slice(0, 3)).toEqual(["source", "source", "category"]);
    expect(questions.rows.find((r) => r[0] === "age")?.[5]).toBe("baseline, endline");
    // rows projections read through the columns, so the source shows up
    expect((results[10].value as { rows: Record<string, unknown>[] }).rows[0].source).toBe("baseline");
  });

  it("refuses to merge questions whose kind or scale differs, and keeps them reachable qualified", async () => {
    const { results } = await run(`let baseline = load survey.json baseline.json
let endline = load survey-v2.json endline.json
union(baseline, endline)
let waves = union(baseline, endline)
waves | avg(age)
waves | count(satisfaction)
waves | avg(baseline.age)
waves | count(referral)
waves | questions()`);
    expect((results[2].value as { text: string }).text).toBe(
      "Combined 35 responses from baseline (20), endline (15). Merged: 6 questions. Only in endline: referral. Conflicts (not merged): age (number / text); satisfaction (rating 1–5 / rating 1–10). Use <source>.<question>, or merge <question> as number|text|category.",
    );
    expect(results[4].error?.message).toBe("'age' is number in baseline, text in endline; use baseline.age or endline.age, or union(...) merge age as number|text|category");
    expect(results[5].error?.message).toMatch(/rating 1–5 in baseline, rating 1–10 in endline/);
    expect(results[6].value).toMatchObject({ label: "avg(baseline.age)", value: 36.6 });
    expect(results[7].value).toMatchObject({ value: 0 }); // only in endline, and empty there
    const q = results[8].value as TableValue;
    expect(q.rows.find((r) => r[0] === "referral")?.[5]).toBe("endline");
    expect(q.rows.find((r) => r[0] === "age")?.[1]).toBe("(conflict)");
  });

  it("merge … as … opts in to a merged column, explicitly", async () => {
    const { results } = await run(`let baseline = load survey.json baseline.json
let endline = load survey-v2.json endline.json
let waves = union(baseline, endline) merge age as number, satisfaction as number
waves | get avg(age, 1), avg(satisfaction, 1), count(all) by source
union(baseline, endline) merge nope as number
union(baseline, endline) merge age as date
union(baseline)
union(baseline, baseline)`);
    const t = results[3].value as TableValue;
    expect(t.columns).toEqual(["source", "avg(age)", "avg(satisfaction)", "count(all)"]);
    expect(t.rows[0]).toEqual(["baseline", 36.6, 3.5, 20]);
    expect(t.rows[1][3]).toBe(15);
    expect(results[4].error?.message).toMatch(/unknown question 'nope'/);
    expect(results[5].error?.message).toMatch(/expected number, text or category/);
    expect(results[6].error?.message).toMatch(/at least two dataset/);
    expect(results[7].error?.message).toMatch(/listed twice/);
  });

  it("charts and get work on the combined data, drawn with ApexCharts only", async () => {
    const { results } = await run(`${SOURCES}let waves = union(baseline, endline)
waves | draw bar(avg(income)) with line(count(all), right) against source
waves | draw pie(gender)`);
    const chart = results[5].value as ChartValue;
    expect(chart.spec.data.labels).toEqual(["baseline", "endline"]);
    expect(chart.spec.data.series.map((s) => s.label)).toEqual(["avg(income)", "count(all)"]);
    expect(chart.dataset?.combined).toBe(true);
    expect((results[6].value as ChartValue).spec.apex).toMatchObject({ chart: { type: "pie" } });
  });
});

describe("join", () => {
  it("attaches right-hand columns on an exact key, keeping unmatched left rows", async () => {
    const { results } = await run(`${SOURCES}schools | join(inventory) on school_name
let merged = join(schools, inventory) on school_name
merged | get school_name, cpus, inventory.cpus, tablets, lab_type where region is "dodoma"
merged | count(all)
merged | questions()`);
    expect(results[4].value).toMatchObject({
      kind: "message",
      text: "Joined 10 of 12 schools rows with inventory on school_name. No match for 2: Chamwino Primary, Monduli Secondary. Also in inventory (use inventory.<question>): cpus.",
    });
    const rows = (results[6].value as { rows: Record<string, unknown>[] }).rows;
    expect(rows.map((r) => r.school_name)).toEqual(["Kikuyu Primary", "Mlimwa Secondary", "Chamwino Primary", "Msalato Girls", "Kikuyu Primary"]);
    expect(rows[0]["inventory.cpus"]).toBeDefined();
    expect(rows[0].cpus).toBe(22); // left wins for a clashing name
    expect(rows[2]["inventory.cpus"]).toBeUndefined(); // CHAMWINO PRIMARY does not match exactly
    expect(results[7].value).toMatchObject({ value: 12 });
    const q = results[8].value as TableValue;
    expect(q.rows.find((r) => r[0] === "lab_type")?.[5]).toBe("inventory");
    expect(q.rows.find((r) => r[0] === "cpus")?.[5]).toBe("schools");
  });

  it("options: loose, labels, inner, many", async () => {
    const { results } = await run(`${SOURCES}schools | join(inventory, loose) on school_name
schools | join(inventory, inner) on school_name | count(all)
inventory | join(schools) on school_name
inventory | join(schools, many) on school_name | count(all)
schools | join(inventory) on school_name = lab_type
schools | join(inventory, labels) on school_name = lab_type`);
    expect((results[4].value as { text: string }).text).toMatch(/^Joined 11 of 12 schools rows/);
    expect(results[5].value).toMatchObject({ value: 10 });
    expect(results[6].error?.message).toBe("join: 'Kikuyu Primary' matches 2 rows in schools; use join(..., many) to keep every match");
    expect(results[7].value).toMatchObject({ value: 12 }); // 11 inventory rows, Kikuyu twice
    expect(results[8].error?.message).toBe("join: 'school_name' is text in schools but 'lab_type' is category in inventory; use join(..., labels) to match on choice labels");
    expect((results[9].value as { text: string }).text).toMatch(/^Joined 0 of 12 schools rows with inventory on school_name = lab_type/);
  });

  it("refuses unusable keys and reports missing ones per side", async () => {
    const { results } = await run(`${SOURCES}schools | join(inventory) on region
join(inventory) on school_name
schools | join(inventory)
let both = union(baseline, endline)
both | join(inventory) on colors = school_name
schools | join(schools) on school_name`);
    expect(results[4].error?.message).toBe("join: inventory: unknown question 'region'");
    expect(results[5].error?.message).toMatch(/no data loaded/);
    expect(results[6].error?.message).toMatch(/missing 'on <question>'/);
    expect(results[8].error?.message).toBe("join: cannot join on 'colors': it is a multi-select question in both");
    expect(results[9].error?.message).toMatch(/cannot join 'schools' with itself/);
  });
});

describe("rename", () => {
  it("renames questions and their sub-fields", async () => {
    const { results } = await run(`${SOURCES}let r = schools | rename it_rating as rating, cpus as computers
r | avg(rating)
r | avg(it_rating)
let b = baseline | rename features as f
b | count(f.price)
schools | rename cpus as monitors
schools | rename cpus as monitors2, cpus as x`);
    expect(results[5].value).toMatchObject({ label: "avg(rating)", value: 3.3333 });
    expect(results[6].error?.message).toMatch(/unknown question 'it_rating'/);
    expect((results[8].value as TableValue).label).toBe("count(f.price)");
    expect(results[9].error?.message).toBe("rename: 'monitors' already exists");
    expect(results[10].error?.message).toBe("rename: 'cpus' is renamed twice");
  });
});

describe("Dataset.combined", () => {
  it("needs columns and reports no model", () => {
    const ds = Dataset.combined([], [], { origin: "test" });
    expect(ds.combined).toBe(true);
    expect(ds.model).toBeNull();
    expect(ds.questions).toEqual([]);
  });
});
