import { describe, expect, it } from "vitest";
import { isIncomplete, splitPipes, splitStatements, splitWords, stripComment, tokenize } from "../src/lang/lexer";

describe("lexer", () => {
  it("strips comments but not # inside strings", () => {
    expect(stripComment('avg age # mean age')).toBe("avg age ");
    expect(stripComment('filter comment contains "#1"')).toBe('filter comment contains "#1"');
  });

  it("splits on unquoted pipes only", () => {
    const segs = splitPipes('filter comment == "a|b" | avg age', 1);
    expect(segs.map((s) => s.text.trim())).toEqual(['filter comment == "a|b"', "avg age"]);
    expect(segs[1].col).toBe(26);
  });

  it("groups physical lines into statements", () => {
    const src = [
      "draw bar(monitors)",
      "     with line(students, right)",
      "     against school_name    # comment",
      "",
      "get avg(monitors, 1),",
      "    count(all)",
      "  by region",
      "let big = filter students > 400",
      "  and has_lab",
      "avg(income) where age",
      "between(25, 40) and gender",
      "is \"female\"",
      "big | count(all)",
      "avg(cpus",
      "",
      ") by region",
      "avg(students) \\",
      "  by region",
      "schools",
      "  | avg(printers)",
      "  let x = 5",
      "x",
    ].join("\n");
    const st = splitStatements(src);
    expect(st.map((s) => [s.line, s.source])).toEqual([
      [1, "draw bar(monitors) with line(students, right) against school_name"],
      [5, "get avg(monitors, 1), count(all) by region"],
      [8, "let big = filter students > 400 and has_lab"],
      [10, 'avg(income) where age between(25, 40) and gender is "female"'],
      [13, "big | count(all)"],
      [14, "avg(cpus ) by region"],
      [17, "avg(students) by region"],
      [19, "schools | avg(printers)"],
      [21, "let x = 5"],
      [22, "x"],
    ]);
    expect(st[0].text).toBe("draw bar(monitors)\n     with line(students, right)\n     against school_name    ");
  });

  it("knows when a statement is incomplete", () => {
    expect(isIncomplete("avg(income")).toBe(true);
    expect(isIncomplete("get avg(income),")).toBe(true);
    expect(isIncomplete("filter age > 30 |")).toBe(true);
    expect(isIncomplete("avg(income) \\")).toBe(true);
    expect(isIncomplete("avg(income)")).toBe(false);
    expect(isIncomplete('filter comment is "(" ')).toBe(false);
    expect(isIncomplete('filter comment is "(')).toBe(false); // unterminated string: a parse error, not a continuation
  });

  it("tracks line numbers across newlines when splitting pipes and tokenizing", () => {
    const segs = splitPipes("schools\n  | avg(printers)\n  | print", 3);
    expect(segs.map((s) => [s.line, s.col, s.text.trim()])).toEqual([[3, 1, "schools"], [4, 4, "avg(printers)"], [5, 4, "print"]]);
    const t = tokenize("avg(\n  income\n)", 7, 5);
    expect(t.map((x) => [x.value, x.line, x.col])).toEqual([["avg", 7, 5], ["(", 7, 8], ["income", 8, 3], [")", 9, 1], ["", 9, 2]]);
  });

  it("tokenizes idents, numbers, strings, backticks and operators", () => {
    const t = tokenize('avg `How old are you?` >= -3.5 == "x" and colors.red', 1, 1).map((x) => [x.type, x.value]);
    expect(t).toEqual([
      ["ident", "avg"],
      ["qident", "How old are you?"],
      ["op", ">="],
      ["number", "-3.5"],
      ["op", "=="],
      ["string", "x"],
      ["ident", "and"],
      ["ident", "colors"],
      ["punct", "."],
      ["ident", "red"],
      ["eof", ""],
    ]);
  });

  it("reports column positions", () => {
    const t = tokenize("  avg age", 3, 5);
    expect(t[0]).toMatchObject({ value: "avg", line: 3, col: 7 });
    expect(t[1]).toMatchObject({ value: "age", col: 11 });
  });

  it("errors on unterminated strings and bad characters", () => {
    expect(() => tokenize('count "abc', 1, 1)).toThrow(/unterminated string/);
    expect(() => tokenize("count $x", 1, 1)).toThrow(/unexpected character '\$'/);
  });

  it("splits raw words for load/save with quotes", () => {
    expect(splitWords(' ./data/s.json "C:/My Files/r.json"', 1, 1)).toEqual(["./data/s.json", "C:/My Files/r.json"]);
    expect(splitWords("https://x.test/a?b=1 x", 1, 1)).toEqual(["https://x.test/a?b=1", "x"]);
  });
});
