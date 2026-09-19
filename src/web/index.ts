import { createInterpreter, type CreateOptions } from "../index";
import type { IO } from "../interpreter/context";
import type { Interpreter, RunResult } from "../interpreter/interpreter";
import type { Value } from "../interpreter/values";
import { DslError } from "../lang/errors";
import { Dataset } from "../surveycore/dataset";
import { fetchJson, isUrl, loadSource } from "../surveycore/loader";
import { renderApex, renderSurveyAnalytics } from "../visualization/render";

export { renderApex, renderSurveyAnalytics } from "../visualization/render";
export type { ChartHandle } from "../visualization/render";
export { formatTable, formatValue } from "../cli/format";
export type { RunResult, Value };

export interface WebOptions extends CreateOptions {
  /** Survey definition object, or a URL to fetch it from. */
  survey?: unknown;
  /** Responses array (or {data: [...]}) or a URL. */
  data?: unknown;
  /** Named in-memory files that `load <name>` can read. */
  files?: Record<string, unknown>;
}

/** Browser IO: `load` resolves names from `files`, or fetches URLs. Nothing is written to disk. */
export class WebIO implements IO {
  constructor(private files: Record<string, unknown> = {}) {}

  async readJson(path: string): Promise<unknown> {
    if (path in this.files) return this.files[path];
    // A relative path in the browser is fetched relative to the page.
    if (typeof window !== "undefined") return fetchJson(new URL(path, window.location.href).toString());
    throw new DslError(`file '${path}' not provided; pass it in options.files or use a URL`);
  }

  fetchJson(url: string): Promise<unknown> {
    return fetchJson(url);
  }

  async writeText(): Promise<boolean> {
    return false;
  }
}

/** Create a reusable interpreter for the browser; variables persist across `run` calls. */
export async function createWebInterpreter(opts: WebOptions = {}): Promise<Interpreter> {
  const io = new WebIO(opts.files);
  const interp = createInterpreter(io, opts);
  if (opts.survey !== undefined) {
    const survey = typeof opts.survey === "string" && isUrl(opts.survey) ? await loadSource(io, opts.survey) : opts.survey;
    const data = typeof opts.data === "string" && isUrl(opts.data) ? await loadSource(io, opts.data) : (opts.data ?? []);
    interp.dataset = Dataset.fromJson(survey, data);
  }
  return interp;
}

/** One-shot: run a script against a survey and its responses. */
export async function run(script: string, opts: WebOptions = {}): Promise<RunResult[]> {
  const interp = await createWebInterpreter(opts);
  return interp.run(script);
}

export type ChartEngine = "apexcharts" | "survey-analytics";

export interface RenderOptions {
  /** `apexcharts` (default) draws `spec.apex`; `survey-analytics` uses its visualizers where it can (not for series charts or combined data). */
  engine?: ChartEngine;
  /** Fallback data for the survey-analytics engine when a chart carries none. */
  dataset?: Dataset | null;
  /** Show the source line above each result. */
  showSource?: boolean;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function renderTable(columns: string[], rows: unknown[][]): HTMLTableElement {
  const tbl = h("table", "sdsl-table");
  const thead = tbl.createTHead();
  const hr = thead.insertRow();
  for (const c of columns) hr.appendChild(h("th", undefined, c));
  const tbody = tbl.createTBody();
  for (const r of rows) {
    const tr = tbody.insertRow();
    r.forEach((v) => {
      const td = tr.insertCell();
      td.textContent = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      if (typeof v === "number") td.className = "num";
    });
  }
  return tbl;
}

/** Render results into `el` (cleared first). Charts render asynchronously for the survey-analytics engine. */
export function renderResults(results: RunResult[], el: HTMLElement, opts: RenderOptions = {}): void {
  el.innerHTML = "";
  for (const r of results) {
    const section = h("section", "sdsl-result");
    if (opts.showSource !== false) section.appendChild(h("code", "sdsl-source", r.source));
    if (r.error) {
      section.classList.add("error");
      section.appendChild(h("pre", "sdsl-error", `line ${r.line}: ${r.error.message}`));
      el.appendChild(section);
      continue;
    }
    const v = r.value;
    if (!v) {
      el.appendChild(section);
      continue;
    }
    switch (v.kind) {
      case "scalar":
        section.appendChild(h("pre", "sdsl-scalar", `${v.label} = ${v.value === null ? "null" : String(v.value)}`));
        break;
      case "message": {
        section.appendChild(h("pre", "sdsl-message", v.text));
        if (v.saved) {
          const details = h("details");
          details.appendChild(h("summary", undefined, `Content of ${v.saved.path}`));
          details.appendChild(h("pre", "sdsl-saved", v.saved.text));
          section.appendChild(details);
        }
        break;
      }
      case "table":
        section.appendChild(h("div", "sdsl-label", v.label));
        section.appendChild(renderTable(v.columns, v.rows));
        break;
      case "rows":
        section.appendChild(renderTable(v.columns, v.rows.map((row) => v.columns.map((c) => row[c]))));
        section.appendChild(h("div", "sdsl-label", `${v.rows.length} of ${v.total} rows`));
        break;
      case "dataset":
        section.appendChild(h("pre", "sdsl-message", `dataset: ${v.dataset.rows.length} rows`));
        break;
      case "chart": {
        const box = h("div", "sdsl-chart");
        section.appendChild(box);
        const engine = opts.engine ?? "apexcharts";
        const ds = v.dataset ?? opts.dataset;
        if (engine === "survey-analytics" && ds && ds.model && v.spec.mode !== "series") {
          renderSurveyAnalytics(v, ds, box).catch((e) => {
            box.appendChild(h("pre", "sdsl-error", `survey-analytics failed: ${(e as Error).message}; falling back to ApexCharts`));
            void renderApex(v, box);
          });
        } else {
          renderApex(v, box).catch((e) => {
            box.appendChild(h("pre", "sdsl-error", `ApexCharts failed: ${(e as Error).message}`));
          });
        }
        break;
      }
    }
    el.appendChild(section);
  }
}
