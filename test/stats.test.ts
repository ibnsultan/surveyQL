import { describe, expect, it } from "vitest";
import * as S from "../src/surveycore/stats";
import { dataset } from "./helpers";

describe("stats", () => {
  const ds = dataset();

  it("computes aggregates while skipping missing values", () => {
    const income = ds.numbers(ds.resolve(["income"]));
    expect(income.length).toBe(18);
    expect(S.avg(ds.numbers(ds.resolve(["age"])))).toBe(36.6);
    expect(S.sum(income)).toBe(977_000);
    expect(S.min(income)).toBe(15000);
    expect(S.max(income)).toBe(90000);
    expect(S.median([3, 1, 2])).toBe(2);
    expect(S.median([4, 1, 3, 2])).toBe(2.5);
    expect(S.avg([])).toBeNull();
  });

  it("frequency includes zero-count choices in choice order and counts multi-select per choice", () => {
    const f = S.frequency(ds, ds.resolve(["colors"]));
    expect(f.labels).toEqual(["Red", "Green", "Blue", "Yellow"]);
    expect(f.counts).toEqual([10, 8, 9, 5]);
    expect(f.answered).toBe(19);
    expect(f.missing).toBe(1);
    expect(f.percents[0]).toBe(52.6);

    const g = S.frequency(ds, ds.resolve(["gender"]));
    expect(g.counts).toEqual([8, 9, 3]);
  });

  it("frequency for rating uses numeric order and reports missing", () => {
    const f = S.frequency(ds, ds.resolve(["satisfaction"]));
    expect(f.values).toEqual([1, 2, 3, 4, 5]);
    expect(f.counts).toEqual([1, 3, 4, 7, 4]);
    expect(f.missing).toBe(1);
  });

  it("frequency for booleans", () => {
    const f = S.frequency(ds, ds.resolve(["subscribed"]));
    expect(f.labels).toEqual(["Yes", "No"]);
    expect(f.counts).toEqual([12, 8]);
  });

  it("matrixFrequency gives rows x columns", () => {
    const m = S.matrixFrequency(ds, ds.resolve(["features"]));
    expect(m.rowLabels).toEqual(["Price", "Quality", "Support"]);
    expect(m.columnLabels).toEqual(["Bad", "OK", "Good"]);
    expect(m.counts[0]).toEqual([5, 9, 6]);
    expect(m.counts.map((r) => r.reduce((a, b) => a + b))).toEqual([20, 20, 20]);
  });

  it("histogram bins equal widths and puts max in the last bin", () => {
    const h = S.histogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(h.counts).toEqual([2, 2, 2, 2, 2]);
    expect(h.labels[0]).toBe("1–2.8");
    expect(S.histogram([], 3).counts).toEqual([]);
    expect(S.histogram([4, 4, 4]).counts).toEqual([3]);
    expect(S.histogram(ds.numbers(ds.resolve(["age"]))).counts.length).toBe(5); // ceil(sqrt(20)) = 5
  });

  it("groupBy splits rows by category and multi-select", () => {
    const groups = S.groupBy(ds, ds.resolve(["gender"]));
    expect(groups.map((g) => [g.label, g.dataset.rows.length])).toEqual([
      ["Male", 8],
      ["Female", 9],
      ["Other", 3],
    ]);
    const byColor = S.groupBy(ds, ds.resolve(["colors"]));
    expect(byColor.map((g) => g.dataset.rows.length)).toEqual([10, 8, 9, 5]);
  });

  it("describe summarizes by column kind", () => {
    const age = S.describe(ds, ds.resolve(["age"]));
    expect(age).toMatchObject({ type: "number", n: 20, missing: 0, stats: { mean: 36.6, min: 17, max: 63 } });
    const gender = S.describe(ds, ds.resolve(["gender"]));
    expect(gender.stats).toMatchObject({ distinct: 3, top: "Female", "top count": 9 });
    const comment = S.describe(ds, ds.resolve(["comment"]));
    expect(comment.n).toBe(10);
  });
});
