import { Model, type Question, type SurveyModel } from "survey-core";
import type { Ref } from "../lang/ast";
import { DslError } from "../lang/errors";
import { isEmpty, looseEquals, toNumber } from "./coerce";

export type Row = Record<string, unknown>;

export type ColumnType = "number" | "category" | "multi" | "boolean" | "text" | "date" | "object";

export interface Choice {
  value: unknown;
  text: string;
}

export interface Column {
  /** Dotted key, e.g. "features.price". */
  key: string;
  path: string[];
  title: string;
  type: ColumnType;
  /** Underlying SurveyJS question type, e.g. "checkbox"; "source" / "merged" for columns made by union. */
  questionType: string;
  /** The survey-core question; absent for columns of a combined (union/join) dataset. */
  question?: Question;
  choices?: Choice[];
  /** Which source(s) the column came from, for combined datasets: "baseline, endline". */
  origin?: string;
  /** Read this column's value from a response row. */
  get(row: Row): unknown;
}

const NUMERIC_INPUTS = new Set(["number", "range"]);
const SKIPPED = new Set(["html", "image", "file", "signaturepad", "panel"]);

function choiceList(items: unknown): Choice[] {
  if (!Array.isArray(items)) return [];
  return items.map((it) => {
    const o = it as { value?: unknown; text?: unknown; locText?: unknown };
    const value = o && typeof o === "object" && "value" in o ? o.value : it;
    let text: string;
    if (o && typeof o === "object" && typeof o.text === "string" && o.text !== "") text = o.text;
    else text = String(value);
    return { value, text };
  });
}

function reader(valueName: string, path: string[]): (row: Row) => unknown {
  return (row) => {
    let v: unknown = row[valueName];
    for (const p of path) {
      if (v === null || v === undefined || typeof v !== "object") return undefined;
      v = (v as Record<string, unknown>)[p];
    }
    return v;
  };
}

function booleanReader(q: Question): (row: Row) => unknown {
  const key = q.getValueName();
  const qb = q as unknown as { valueTrue?: unknown; valueFalse?: unknown };
  return (row) => {
    const v = row[key];
    if (v === null || v === undefined || v === "") return undefined;
    if (qb.valueTrue !== undefined && looseEquals(v, qb.valueTrue)) return true;
    if (qb.valueFalse !== undefined && looseEquals(v, qb.valueFalse)) return false;
    if (v === "true") return true;
    if (v === "false") return false;
    return Boolean(v);
  };
}

/** Build the analyzable columns for a survey model. */
export function buildColumns(model: SurveyModel): Column[] {
  const cols: Column[] = [];
  const questions = model.getAllQuestions(false, false, true) as Question[];

  for (const q of questions) {
    const type = q.getType();
    if (SKIPPED.has(type)) continue;
    const name = q.name;
    const valueName = q.getValueName();
    const title = (q.title && q.title !== name ? q.title : name) as string;
    const base = { path: [name], title, questionType: type, question: q };
    const qa = q as unknown as Record<string, unknown>;

    switch (type) {
      case "rating":
      case "slider":
      case "expression":
        cols.push({ ...base, key: name, type: "number", choices: type === "rating" ? choiceList(qa.visibleChoices) : undefined, get: reader(valueName, []) });
        break;
      case "text": {
        const inputType = String(qa.inputType ?? "text");
        const ctype: ColumnType = NUMERIC_INPUTS.has(inputType) ? "number" : inputType.startsWith("date") ? "date" : "text";
        cols.push({ ...base, key: name, type: ctype, get: reader(valueName, []) });
        break;
      }
      case "comment":
        cols.push({ ...base, key: name, type: "text", get: reader(valueName, []) });
        break;
      case "radiogroup":
      case "dropdown":
        cols.push({ ...base, key: name, type: "category", choices: choiceList(qa.visibleChoices), get: reader(valueName, []) });
        break;
      case "imagepicker":
        cols.push({ ...base, key: name, type: qa.multiSelect ? "multi" : "category", choices: choiceList(qa.visibleChoices), get: reader(valueName, []) });
        break;
      case "checkbox":
      case "tagbox":
      case "ranking":
        cols.push({ ...base, key: name, type: "multi", choices: choiceList(qa.visibleChoices), get: reader(valueName, []) });
        break;
      case "boolean":
        cols.push({
          ...base,
          key: name,
          type: "boolean",
          choices: [
            { value: true, text: String(qa.labelTrue || "Yes") },
            { value: false, text: String(qa.labelFalse || "No") },
          ],
          get: booleanReader(q),
        });
        break;
      case "matrix": {
        const rows = choiceList(qa.rows);
        const columns = choiceList(qa.columns);
        cols.push({ ...base, key: name, type: "object", choices: columns, get: reader(valueName, []) });
        for (const r of rows) {
          cols.push({
            ...base,
            key: `${name}.${r.value}`,
            path: [name, String(r.value)],
            title: `${title}: ${r.text}`,
            type: "category",
            choices: columns,
            get: reader(valueName, [String(r.value)]),
          });
        }
        break;
      }
      case "matrixdropdown": {
        const rows = choiceList(qa.rows);
        const columns = (qa.columns as unknown[]) ?? [];
        cols.push({ ...base, key: name, type: "object", get: reader(valueName, []) });
        for (const r of rows) {
          for (const c of columns) {
            const col = c as { name: string; title?: string; cellType?: string; choices?: unknown };
            const cellType = col.cellType && col.cellType !== "default" ? col.cellType : String(qa.cellType ?? "dropdown");
            const ctype: ColumnType = cellType === "rating" || cellType === "text" ? (cellType === "rating" ? "number" : "text") : cellType === "checkbox" ? "multi" : cellType === "boolean" ? "boolean" : "category";
            const choices = choiceList(col.choices && (col.choices as unknown[]).length ? col.choices : qa.choices);
            cols.push({
              ...base,
              key: `${name}.${r.value}.${col.name}`,
              path: [name, String(r.value), col.name],
              title: `${title}: ${r.text} / ${col.title || col.name}`,
              type: ctype,
              choices: ctype === "category" || ctype === "multi" ? choices : undefined,
              get: reader(valueName, [String(r.value), col.name]),
            });
          }
        }
        break;
      }
      case "multipletext": {
        const items = (qa.items as { name: string; title?: string; inputType?: string }[]) ?? [];
        cols.push({ ...base, key: name, type: "object", get: reader(valueName, []) });
        for (const it of items) {
          cols.push({
            ...base,
            key: `${name}.${it.name}`,
            path: [name, it.name],
            title: `${title}: ${it.title || it.name}`,
            type: NUMERIC_INPUTS.has(it.inputType ?? "") ? "number" : "text",
            get: reader(valueName, [it.name]),
          });
        }
        break;
      }
      case "matrixdynamic":
      case "paneldynamic":
        cols.push({ ...base, key: name, type: "object", get: reader(valueName, []) });
        break;
      default:
        cols.push({ ...base, key: name, type: "text", get: reader(valueName, []) });
    }
  }
  return cols;
}

/** Normalize the various response payload shapes to a plain row array. */
export function normalizeRows(data: unknown): Row[] {
  if (Array.isArray(data)) return data.filter((r) => r && typeof r === "object") as Row[];
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const key of ["data", "Data", "results", "responses", "rows"]) {
      if (Array.isArray(o[key])) return normalizeRows(o[key]);
    }
  }
  throw new DslError("responses must be an array of objects (or an object with a 'data' array)");
}

export interface DatasetMeta {
  /** Where the data came from: a path/URL, or `union(a, b)` / `join(a, b)`. */
  origin?: string;
  /** Questions that could not be merged by a union: bare name → explanation. */
  conflicts?: Map<string, string>;
}

export class Dataset {
  readonly columns: Column[];
  private byKey: Map<string, Column>;
  readonly origin?: string;
  readonly conflicts: Map<string, string>;

  private constructor(
    /** The survey-core model; null for a combined (union/join) dataset, which has no single questionnaire. */
    readonly model: SurveyModel | null,
    readonly rows: Row[],
    columns?: Column[],
    meta: DatasetMeta = {},
  ) {
    if (!columns && !model) throw new DslError("a dataset needs a survey model or explicit columns");
    this.columns = columns ?? buildColumns(model!);
    this.byKey = new Map(this.columns.map((c) => [c.key, c]));
    this.origin = meta.origin;
    this.conflicts = meta.conflicts ?? new Map();
  }

  static fromJson(survey: unknown, data: unknown = [], origin?: string): Dataset {
    if (!survey || typeof survey !== "object") throw new DslError("survey definition must be a JSON object");
    const model = new Model(survey);
    return new Dataset(model, normalizeRows(data), undefined, { origin });
  }

  /** A dataset assembled from explicit columns (union / join). It has no survey model. */
  static combined(columns: Column[], rows: Row[], meta: DatasetMeta): Dataset {
    return new Dataset(null, rows, columns, meta);
  }

  /** True for union / join results: columns may come from several questionnaires. */
  get combined(): boolean {
    return this.model === null;
  }

  private meta(): DatasetMeta {
    return { origin: this.origin, conflicts: this.conflicts };
  }

  /** A dataset with a subset of rows sharing this one's model and columns. */
  where(pred: (row: Row) => boolean): Dataset {
    return new Dataset(this.model, this.rows.filter(pred), this.columns, this.meta());
  }

  withRows(rows: Row[]): Dataset {
    return new Dataset(this.model, rows, this.columns, this.meta());
  }

  /** Same rows, different column list (rename). */
  withColumns(columns: Column[], meta: DatasetMeta = this.meta()): Dataset {
    return new Dataset(this.model, this.rows, columns, meta);
  }

  /** Top-level columns (one per question). */
  get questions(): Column[] {
    return this.columns.filter((c) => c.path.length === 1);
  }

  has(key: string): boolean {
    return this.byKey.has(key) || this.byKey.has(this.resolveValueName(key));
  }

  /** Map a valueName or a question title to the question name; returns the input when nothing matches. */
  private resolveValueName(name: string): string {
    const q = this.model ? (this.model.getQuestionByValueName(name) as Question | null) : null;
    if (q && this.byKey.has(q.name)) return q.name;
    const byTitle = this.questions.find((c) => c.title === name || c.title.toLowerCase() === name.toLowerCase());
    return byTitle ? byTitle.key : name;
  }

  /** Resolve a question reference (with optional sub-path) to a column. Throws a DslError when unknown. */
  resolve(ref: Ref | string[]): Column {
    const path = Array.isArray(ref) ? ref : ref.path;
    const pos = Array.isArray(ref) ? undefined : ref;
    const text = Array.isArray(ref) ? ref.join(".") : ref.text;
    const head = this.byKey.has(path[0]) ? path[0] : this.resolveValueName(path[0]);
    const key = [head, ...path.slice(1)].join(".");
    const direct = this.byKey.get(key);
    if (direct) return direct;

    const parent = this.byKey.get(head);
    if (!parent) {
      const conflict = this.conflicts.get(path[0]);
      if (conflict) throw new DslError(conflict, pos?.line, pos?.col);
      const hint = this.suggest(path[0]);
      throw new DslError(`unknown question '${path[0]}'${hint ? `; did you mean '${hint}'?` : ""}`, pos?.line, pos?.col);
    }

    // `colors.red` on a multi/category column: derived boolean column "was this choice selected?"
    if (path.length === 2 && (parent.type === "multi" || parent.type === "category")) {
      const sub = path[1];
      const choice = parent.choices?.find((c) => looseEquals(c.value, sub) || c.text === sub);
      if (!choice && parent.choices?.length) {
        throw new DslError(`'${parent.key}' has no choice '${sub}'; choices: ${parent.choices.map((c) => c.value).join(", ")}`, pos?.line, pos?.col);
      }
      const target = choice ? choice.value : sub;
      const get = parent.get;
      return {
        key,
        path,
        title: `${parent.title}: ${choice ? choice.text : sub}`,
        type: "boolean",
        questionType: parent.questionType,
        question: parent.question,
        choices: [
          { value: true, text: "Selected" },
          { value: false, text: "Not selected" },
        ],
        get: (row) => {
          const v = get(row);
          if (isEmpty(v)) return undefined;
          const arr = Array.isArray(v) ? v : [v];
          return arr.some((x) => looseEquals(x, target));
        },
      };
    }

    throw new DslError(`unknown field '${text}'`, pos?.line, pos?.col);
  }

  private suggest(name: string): string | null {
    const lower = name.toLowerCase();
    let best: string | null = null;
    let bestScore = 0;
    for (const c of this.questions) {
      const k = c.key.toLowerCase();
      let score = 0;
      if (k === lower) score = 100;
      else if (k.startsWith(lower) || lower.startsWith(k)) score = 50;
      else if (k.includes(lower) || lower.includes(k)) score = 25;
      if (score > bestScore) {
        bestScore = score;
        best = c.key;
      }
    }
    return best;
  }

  /** Numeric values of a column, skipping empty/non-numeric cells. */
  numbers(col: Column): number[] {
    const out: number[] = [];
    for (const row of this.rows) {
      const n = toNumber(col.get(row));
      if (n !== null) out.push(n);
    }
    return out;
  }

  /** Human-readable label for a value of a column (choice text when known). */
  label(col: Column, value: unknown): string {
    if (value === null || value === undefined) return "(empty)";
    const choice = col.choices?.find((c) => looseEquals(c.value, value));
    if (choice) return choice.text;
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
  }
}
