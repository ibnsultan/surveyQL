import { describe, expect, it } from "vitest";
import { parse, parseLine } from "../src/lang/parser";

function cmds(line: string) {
  const st = parseLine(line, 1);
  if (st.kind !== "pipeline") throw new Error(`expected pipeline, got ${st.kind}`);
  return st.commands;
}

describe("parser", () => {
  it("parses a simple command with a ref", () => {
    const [c] = cmds("avg age");
    expect(c.name).toBe("avg");
    expect(c.args).toEqual([{ kind: "ref", path: ["age"], text: "age", line: 1, col: 5 }]);
  });

  it("parses raw args for load and save", () => {
    const [c] = cmds("load ./fixtures/survey.json https://example.test/data.json");
    expect(c.rawArgs).toEqual(["./fixtures/survey.json", "https://example.test/data.json"]);
    expect(c.args).toEqual([]);
  });

  it("desugars where into a leading filter", () => {
    const list = cmds('sum income where gender == "female"');
    expect(list.map((c) => c.name)).toEqual(["filter", "sum"]);
    expect(list[0].expr).toMatchObject({ kind: "binary", op: "==" });
    expect(list[1].args[0]).toMatchObject({ path: ["income"] });
  });

  it("parses pipes and by clauses", () => {
    const list = cmds("filter age > 30 | avg income by gender");
    expect(list.map((c) => c.name)).toEqual(["filter", "avg"]);
    expect(list[1].by).toMatchObject({ path: ["gender"] });
  });

  it("parses sub-path refs and backtick names", () => {
    const [c] = cmds("count colors.red");
    expect(c.args[0]).toMatchObject({ path: ["colors", "red"] });
    const [d] = cmds("avg `How old are you?`");
    expect(d.args[0]).toMatchObject({ path: ["How old are you?"], text: "`How old are you?`" });
  });

  it("respects precedence: or < and < not < comparison", () => {
    const [c] = cmds("filter a == 1 or not b > 2 and c in [1, 2]");
    expect(c.expr).toMatchObject({
      kind: "binary",
      op: "or",
      left: { kind: "binary", op: "==" },
      right: {
        kind: "binary",
        op: "and",
        left: { kind: "not", expr: { kind: "binary", op: ">" } },
        right: { kind: "binary", op: "in", right: { kind: "list" } },
      },
    });
  });

  it("treats single = as ==", () => {
    const [c] = cmds('filter gender = "male"');
    expect(c.expr).toMatchObject({ op: "==" });
  });

  it("rejects reserved words as refs with a hint", () => {
    expect(() => cmds("avg and")).toThrow(/reserved word/);
    expect(() => cmds("avg where")).toThrow(/unexpected end of line/);
    expect(cmds("avg `where`")[0].args[0]).toMatchObject({ path: ["where"] });
  });

  it("parses let with literals and pipelines", () => {
    expect(parseLine("let n = 3", 1)).toMatchObject({ kind: "let", name: "n", value: { kind: "literal", value: 3 } });
    expect(parseLine('let g = "female"', 1)).toMatchObject({ kind: "let", value: { kind: "literal", value: "female" } });
    expect(parseLine("let adults = filter age >= 18 | avg income", 1)).toMatchObject({
      kind: "let",
      name: "adults",
      value: { kind: "pipeline", commands: [{ name: "filter" }, { name: "avg" }] },
    });
  });

  it("captures errors per line and keeps parsing", () => {
    const script = parse('avg age\ncount "oops\n\n# comment only\nsum income');
    expect(script.statements.map((s) => s.kind)).toEqual(["pipeline", "error", "pipeline"]);
    const err = script.statements[1];
    if (err.kind !== "error") throw new Error();
    expect(err.error.line).toBe(2);
    expect(err.error.message).toMatch(/unterminated string/);
  });

  it("parses statements that span several lines and reports errors on the right line", () => {
    const script = parse("draw bar(monitors)\n  with line(students, right)\n  against school_name\navg(income)\n  where age > 30\navg(nope(x)\n  by region");
    expect(script.statements.map((s) => s.kind)).toEqual(["pipeline", "pipeline", "error"]);
    const [chart, filtered, err] = script.statements;
    if (chart.kind !== "pipeline" || filtered.kind !== "pipeline" || err.kind !== "error") throw new Error();
    expect(chart.source).toBe("draw bar(monitors) with line(students, right) against school_name");
    expect(chart.commands[0]).toMatchObject({ name: "bar", prefix: "draw", against: { path: ["school_name"] }, with: [{ name: "line", options: ["right"] }] });
    expect(filtered.line).toBe(4);
    expect(filtered.commands.map((c) => c.name)).toEqual(["filter", "avg"]);
    expect(filtered.commands[0].expr).toMatchObject({ line: 5 });
    expect(err.line).toBe(6);
    expect(err.error.line).toBe(7); // the stray 'by' is on line 7
  });

  it("parses the call form with zero, one and several arguments", () => {
    expect(cmds("count()")[0]).toMatchObject({ name: "count", args: [] });
    expect(cmds("avg(income)")[0]).toMatchObject({ name: "avg", args: [{ path: ["income"] }] });
    expect(cmds("hist(age, 5)")[0]).toMatchObject({ name: "hist", args: [{ path: ["age"] }, { kind: "number", value: 5 }] });
    expect(cmds("count(colors.red)")[0].args[0]).toMatchObject({ path: ["colors", "red"] });
    const list = cmds('avg(income) where gender == "female" by subscribed');
    expect(list.map((c) => c.name)).toEqual(["filter", "avg"]);
    expect(list[1].by).toMatchObject({ path: ["subscribed"] });
    expect(() => cmds("avg(income")).toThrow(/expected ',' or '\)', got end of line/);
    expect(() => cmds("avg(income 5)")).toThrow(/expected ',' or '\)'/);
  });

  it("parses the draw prefix", () => {
    expect(cmds("draw pie(gender)")[0]).toMatchObject({ name: "pie", prefix: "draw", args: [{ path: ["gender"] }] });
    expect(cmds("draw hist(age, 4) where age > 18").map((c) => c.name)).toEqual(["filter", "hist"]);
    expect(() => cmds("draw")).toThrow(/missing chart command/);
    expect(() => parseLine("let draw = 1", 1)).toThrow(/cannot be used as a variable name/);
  });

  it("desugars between into a range check", () => {
    const [c] = cmds("filter age between 20 and 30 or subscribed");
    expect(c.expr).toMatchObject({
      op: "or",
      left: { op: "and", left: { op: ">=", right: { value: 20 } }, right: { op: "<=", right: { value: 30 } } },
      right: { kind: "ref", path: ["subscribed"] },
    });
    expect(() => cmds("filter age between 20 30")).toThrow(/expected 'and' after 'between'/);
  });

  it("parses between(a, b) and chains it with other conditions", () => {
    const [c] = cmds('filter age between(25, 40) and gender is "female"');
    expect(c.expr).toMatchObject({
      op: "and",
      left: { op: "and", left: { op: ">=", right: { value: 25 } }, right: { op: "<=", right: { value: 40 } } },
      right: { kind: "match", op: "is", values: [{ value: "female" }], negate: false },
    });
    expect(() => cmds("filter age between(25)")).toThrow(/exactly two values/);
    expect(() => cmds("filter age between(25, 40, strict)")).toThrow(/exactly two values/);
  });

  it("parses is / is not / is(...) with options and contains(...)", () => {
    expect(cmds('filter region is "dodoma"')[0].expr).toMatchObject({ kind: "match", op: "is", negate: false, options: {} });
    expect(cmds('filter region is not "dodoma"')[0].expr).toMatchObject({ kind: "match", op: "is", negate: true });
    expect(cmds('filter region is("dodoma", "dar es salaam", strict)')[0].expr).toMatchObject({
      kind: "match",
      op: "is",
      values: [{ value: "dodoma" }, { value: "dar es salaam" }],
      options: { strict: true },
    });
    expect(cmds('filter comment contains("slow", regex)')[0].expr).toMatchObject({ op: "contains", options: { regex: true } });
    expect(cmds('filter comment contains "slow"')[0].expr).toMatchObject({ kind: "match", op: "contains", values: [{ value: "slow" }] });
    expect(cmds("filter income is null")[0].expr).toMatchObject({ op: "is", values: [{ value: null }] });
    expect(() => cmds("filter region is()")).toThrow(/needs at least one value/);
    expect(() => cmds("avg strict")).toThrow(/option word/);
  });

  it("parses nested aggregate calls, count(all) and series options", () => {
    const [c] = cmds("draw bar(sum(monitors), avg(it_rating), count(all)) against region");
    expect(c.args.map((a) => a.kind)).toEqual(["call", "call", "call"]);
    expect(c.args[0]).toMatchObject({ kind: "call", name: "sum", args: [{ path: ["monitors"] }], text: "sum(monitors)" });
    expect(c.args[2]).toMatchObject({ kind: "call", name: "count", args: [{ kind: "all" }], text: "count(all)" });
    expect(c.against).toMatchObject({ path: ["region"] });
    expect(cmds("count(all)")[0].args[0]).toMatchObject({ kind: "all" });
    expect(cmds("draw line(students, right) against school_name")[0]).toMatchObject({ options: ["right"], args: [{ path: ["students"] }] });
    expect(() => cmds("draw bar(sum(avg(x))) against y")).toThrow(/cannot be nested this deep/);
    expect(() => cmds("avg(all)")).toThrow(/only valid as count\(all\)/);
  });

  it("parses with as a comma-separated list of chart calls", () => {
    const list = cmds('draw bar(monitors, printers) with line(students), line(staff, right) against school_name where region is "dodoma"');
    expect(list.map((x) => x.name)).toEqual(["filter", "bar"]);
    const c = list[1];
    expect(c.with).toHaveLength(2);
    expect(c.with![0]).toMatchObject({ name: "line", args: [{ path: ["students"] }], options: [] });
    expect(c.with![1]).toMatchObject({ name: "line", args: [{ path: ["staff"] }], options: ["right"] });
    expect(c.against).toMatchObject({ path: ["school_name"] });
    expect(cmds('draw bar(a) with line(b) against x where y is "z"').map((x) => x.name)).toEqual(["filter", "bar"]);
    expect(() => cmds("bar(a) with line(b) against x")).toThrow(/'with' is only valid after draw/);
    expect(() => cmds("draw bar(a) with line(b) with line(c) against x")).toThrow(/only one 'with'/);
    expect(() => cmds("draw bar(a) with 5 against x")).toThrow(/expected a chart call/);
    expect(() => cmds("avg(x) against y")).toThrow(/'against' is for charts; use 'by'/);
    expect(() => cmds("draw bar(a) against x against y")).toThrow(/only one 'against'/);
  });

  it("rejects empty pipe segments and duplicate clauses", () => {
    expect(() => cmds("avg age |")).toThrow(/empty command/);
    expect(() => cmds("avg age where a == 1 where b == 2")).toThrow(/only one 'where'/);
  });
});
