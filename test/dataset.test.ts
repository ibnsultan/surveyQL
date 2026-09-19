import { describe, expect, it } from "vitest";
import { Dataset, normalizeRows } from "../src/surveycore/dataset";
import { dataset, fixture } from "./helpers";

describe("Dataset", () => {
  const ds = dataset();

  it("types every fixture question", () => {
    const types = Object.fromEntries(ds.questions.map((q) => [q.key, q.type]));
    expect(types).toEqual({
      age: "number",
      gender: "category",
      satisfaction: "number",
      colors: "multi",
      subscribed: "boolean",
      income: "number",
      features: "object",
      comment: "text",
    });
  });

  it("exposes choices and matrix row columns", () => {
    expect(ds.resolve(["gender"]).choices?.map((c) => c.text)).toEqual(["Male", "Female", "Other"]);
    expect(ds.resolve(["satisfaction"]).choices?.map((c) => c.value)).toEqual([1, 2, 3, 4, 5]);
    const price = ds.resolve(["features", "price"]);
    expect(price.type).toBe("category");
    expect(price.choices?.map((c) => c.value)).toEqual(["bad", "ok", "good"]);
    expect(price.get(ds.rows[0])).toBe("ok");
  });

  it("derives a boolean column for a checkbox choice", () => {
    const red = ds.resolve(["colors", "red"]);
    expect(red.type).toBe("boolean");
    expect(red.get(ds.rows[0])).toBe(true);
    expect(red.get(ds.rows[2])).toBe(false);
    expect(red.get(ds.rows[7])).toBeUndefined(); // empty selection
  });

  it("resolves by title and by valueName", () => {
    expect(ds.resolve(["How old are you?"]).key).toBe("age");
    const survey = { elements: [{ type: "text", name: "q1", valueName: "answer" }] };
    const d = Dataset.fromJson(survey, [{ answer: "x" }]);
    expect(d.resolve(["answer"]).key).toBe("q1");
    expect(d.resolve(["q1"]).get(d.rows[0])).toBe("x");
  });

  it("gives helpful errors for unknown refs", () => {
    expect(() => ds.resolve(["agee"])).toThrow(/unknown question 'agee'; did you mean 'age'/);
    expect(() => ds.resolve(["colors", "purple"])).toThrow(/has no choice 'purple'/);
    expect(() => ds.resolve(["age", "x"])).toThrow(/unknown field 'age.x'/);
  });

  it("normalizes response payload shapes", () => {
    expect(normalizeRows([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(normalizeRows({ data: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(normalizeRows({ Data: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(() => normalizeRows("nope")).toThrow(/array of objects/);
  });

  it("normalizes boolean valueTrue/valueFalse", () => {
    const survey = { elements: [{ type: "boolean", name: "b", valueTrue: "yes", valueFalse: "no" }] };
    const d = Dataset.fromJson(survey, [{ b: "yes" }, { b: "no" }, {}]);
    const col = d.resolve(["b"]);
    expect(d.rows.map((r) => col.get(r))).toEqual([true, false, undefined]);
  });

  it("where() keeps model and columns", () => {
    const sub = ds.where((r) => (r.age as number) > 50);
    expect(sub.rows.length).toBe(3);
    expect(sub.columns).toBe(ds.columns);
    expect(fixture("survey.json")).toBeTruthy();
  });
});
