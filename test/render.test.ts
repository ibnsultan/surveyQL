// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

const rendered: unknown[] = [];
vi.mock("apexcharts", () => {
  class ApexCharts {
    constructor(
      public el: HTMLElement,
      public options: unknown,
    ) {
      rendered.push(options);
    }
    async render(): Promise<void> {
      this.el.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    }
    destroy(): void {}
  }
  return { default: ApexCharts };
});

import { renderResults, run, WebIO } from "../src/web/index";
import { fixture } from "./helpers";

describe("web", () => {
  it("run() executes a script against inline survey/data", async () => {
    const results = await run("avg age\ncount gender\nbar gender\nnope", { survey: fixture("survey.json"), data: fixture("responses.json") });
    expect(results[0].value).toMatchObject({ value: 36.6 });
    expect(results[3].error?.message).toMatch(/unknown command/);
  });

  it("renderResults builds sections for each kind", async () => {
    const results = await run("avg age\ncount gender\nbar gender\nsample 2\npie gender | save x.json\nnope", {
      survey: fixture("survey.json"),
      data: fixture("responses.json"),
      seed: 1,
    });
    const el = document.createElement("div");
    renderResults(results, el);
    await new Promise((r) => setTimeout(r, 20)); // charts render after the lazy import
    const sections = [...el.querySelectorAll("section")];
    expect(sections.length).toBe(6);
    expect(sections[0].querySelector(".sdsl-scalar")?.textContent).toBe("avg(age) = 36.6");
    expect(sections[1].querySelectorAll("tbody tr").length).toBe(3);
    expect(sections[2].querySelector(".sdsl-chart svg")).not.toBeNull();
    expect(sections[3].querySelectorAll("tbody tr").length).toBe(2);
    expect(sections[4].querySelector("details summary")?.textContent).toBe("Content of x.json");
    expect(sections[5].classList.contains("error")).toBe(true);
  });

  it("passes the spec's ApexCharts options to the library", async () => {
    const results = await run("draw pie(gender)", { survey: fixture("survey.json"), data: fixture("responses.json") });
    const el = document.createElement("div");
    renderResults(results, el);
    await new Promise((r) => setTimeout(r, 20)); // the library loads lazily
    const box = el.querySelector(".sdsl-chart")!;
    expect(box.querySelector("svg")).not.toBeNull();
    expect(box.querySelector(".sdsl-error")).toBeNull();
    expect(rendered.at(-1)).toMatchObject({ chart: { type: "pie" }, series: [8, 9, 3] });
  });

  it("WebIO reads from provided files", async () => {
    const io = new WebIO({ "s.json": { a: 1 } });
    expect(await io.readJson("s.json")).toEqual({ a: 1 });
    expect(await io.writeText()).toBe(false);
  });
});
