import { describe, expect, it } from "vitest";
import { parseLine } from "../src/lang/parser";
import { compileFilter } from "../src/surveycore/filter";
import type { Value } from "../src/interpreter/values";
import { dataset } from "./helpers";

const ds = dataset();

function count(expr: string, vars?: Map<string, Value>): number {
  const st = parseLine(`filter ${expr}`, 1);
  if (st.kind !== "pipeline") throw new Error(st.kind);
  const pred = compileFilter(st.commands[0].expr!, ds, vars);
  return ds.rows.filter(pred).length;
}

describe("filter", () => {
  it("compares numbers", () => {
    expect(count("age > 30")).toBe(13);
    expect(count("age >= 30")).toBe(13);
    expect(count("age < 30")).toBe(7);
    expect(count("age <= 17")).toBe(1);
    expect(count("age == 25")).toBe(1);
    expect(count("age != 25")).toBe(19);
  });

  it("compares strings loosely and case-sensitively", () => {
    expect(count('gender == "female"')).toBe(9);
    expect(count('gender = "female"')).toBe(9);
    expect(count('gender != "female"')).toBe(11);
    expect(count('gender == "Female"')).toBe(0);
  });

  it("handles booleans and null", () => {
    expect(count("subscribed == true")).toBe(12);
    expect(count("subscribed == false")).toBe(8);
    expect(count("subscribed")).toBe(12);
    expect(count("not subscribed")).toBe(8);
    expect(count("income == null")).toBe(2);
    expect(count("income != null")).toBe(18);
    expect(count("comment == null")).toBe(10);
    expect(count("income > 0")).toBe(18); // empty never compares true
  });

  it("supports contains for arrays and strings, and in for lists", () => {
    expect(count('colors contains "red"')).toBe(10);
    expect(count('comment contains "great"')).toBe(1);
    expect(count('gender in ["male", "other"]')).toBe(11);
    expect(count("satisfaction in [4, 5]")).toBe(11);
    expect(count('colors in ["yellow"]')).toBe(5);
  });

  it("combines with and / or / not and parentheses", () => {
    expect(count('age > 30 and gender == "female"')).toBe(8);
    expect(count('age > 60 or age < 20')).toBe(3);
    expect(count('not (age > 60 or age < 20)')).toBe(17);
  });

  it("uses sub-path refs", () => {
    expect(count("colors.red")).toBe(10);
    expect(count("colors.red == false")).toBe(9);
    expect(count('features.price == "bad"')).toBe(5);
  });

  it("between(a, b) is inclusive and chains", () => {
    expect(count("age between(25, 40)")).toBe(10);
    expect(count("age between 25 and 40")).toBe(10);
    expect(count('age between(25, 40) and gender is "female"')).toBe(5);
    expect(count("age between(25, 40) or age > 60")).toBe(11);
  });

  it("is: case-insensitive by default, strict option, multiple values, not", () => {
    expect(count('gender is "female"')).toBe(9);
    expect(count('gender is "FEMALE"')).toBe(9);
    expect(count('gender is("Female", strict)')).toBe(0);
    expect(count('gender is("female", strict)')).toBe(9);
    expect(count('gender is("male", "other")')).toBe(11);
    expect(count('gender is not "female"')).toBe(11);
    expect(count('gender is not("male", "other")')).toBe(9);
    expect(count("satisfaction is 4")).toBe(7);
    expect(count("satisfaction is(4, 5)")).toBe(11);
    expect(count("subscribed is true")).toBe(12);
    expect(count("income is null")).toBe(2);
    expect(count("income is not null")).toBe(18);
  });

  it("is on multi-select matches any selected choice", () => {
    expect(count('colors is "red"')).toBe(10);
    expect(count('colors is("red", "yellow")')).toBe(13);
    expect(count('colors is not "red"')).toBe(10); // includes the one empty answer
  });

  it("contains with strict and regex options", () => {
    expect(count('comment contains "great"')).toBe(1);
    expect(count('comment contains("great", strict)')).toBe(0);
    expect(count('comment contains("Great", strict)')).toBe(1);
    expect(count('comment contains("great", "nice", "solid")')).toBe(3);
    expect(count('comment contains("^(love|great)", regex)')).toBe(2);
    expect(count('comment contains("expensive$", regex)')).toBe(1);
    expect(count('colors contains("RED")')).toBe(10);
    expect(count('gender is("^(fe)?male$", regex)')).toBe(17);
    expect(() => count('comment contains("(", regex)')).toThrow(/invalid regular expression/);
  });

  it("substitutes scalar variables", () => {
    const vars = new Map<string, Value>([["threshold", { kind: "scalar", label: "threshold", value: 30 }]]);
    expect(count("age > threshold", vars)).toBe(13);
    const bad = new Map<string, Value>([["t", { kind: "table", label: "t", columns: [], rows: [] }]]);
    expect(() => count("age > t", bad)).toThrow(/is a table/);
  });
});
