import "survey-analytics/survey.analytics.apexcharts.css";
import { createWebInterpreter, renderResults, type ChartEngine } from "surveyql/web";
import type { Interpreter, RunResult } from "surveyql";

const editor = document.getElementById("editor") as HTMLTextAreaElement;
const output = document.getElementById("output") as HTMLDivElement;
const runBtn = document.getElementById("run") as HTMLButtonElement;
const reloadBtn = document.getElementById("reload") as HTMLButtonElement;
const addBtn = document.getElementById("add-source") as HTMLButtonElement;
const engineSel = document.getElementById("engine") as HTMLSelectElement;
const sourcesEl = document.getElementById("sources") as HTMLDivElement;
const status = document.getElementById("status") as HTMLSpanElement;

const DEFAULT_SCRIPT = `# Try editing and press Run (Ctrl+Enter)
questions()
avg(age)
count(satisfaction)
sum(income) where gender is "female"
avg(income, 2) where age between(25, 40) and gender is "female"
filter age > 30 | avg(income)
avg(satisfaction) by gender
get avg(income), count(all), median(age) by gender

draw bar(satisfaction)
draw pie(gender)
draw hist(age, 5)
draw gauge(satisfaction)

let adults = filter age >= 18
adults | count(colors)
sample(3)

# Several sources: every row in the Sources panel is a dataset variable.
sources()
let waves = union(main, endline)
waves | count(all) by source
waves | draw bar(avg(satisfaction), avg(income, 0)) against source
`;

interface Source {
  name: string;
  survey: string;
  data: string;
}

/** The Sources panel: each row becomes `let <name> = load <survey> <data>`; the first row is the default. */
const sources: Source[] = [
  { name: "main", survey: "/survey.json", data: "/responses.json" },
  { name: "endline", survey: "/survey.json", data: "/responses-endline.json" },
];

function renderSources(): void {
  sourcesEl.innerHTML = "";
  sources.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "source-row";
    const name = input(s.name, "name", (v) => (s.name = v));
    const survey = input(s.survey, "survey url", (v) => (s.survey = v));
    const data = input(s.data, "responses url", (v) => (s.data = v));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = "×";
    remove.title = "Remove this source";
    remove.disabled = sources.length === 1;
    remove.addEventListener("click", () => {
      sources.splice(i, 1);
      renderSources();
    });
    row.append(name, survey, data, remove);
    if (i === 0) row.title = "The first source is the default dataset";
    sourcesEl.appendChild(row);
  });
}

function input(value: string, placeholder: string, onChange: (v: string) => void): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "text";
  el.value = value;
  el.placeholder = placeholder;
  el.spellcheck = false;
  el.addEventListener("change", () => onChange(el.value.trim()));
  return el;
}

editor.value = DEFAULT_SCRIPT;
renderSources();

let interp: Interpreter | null = null;

function absolute(url: string): string {
  return new URL(url, window.location.href).toString();
}

/** Bind every source as a variable and make the first one the default dataset. */
async function load(): Promise<void> {
  status.textContent = "loading…";
  interp = await createWebInterpreter({});
  const prelude = sources
    .filter((s) => s.name && s.survey)
    .map((s) => `let ${s.name} = load ${absolute(s.survey)}${s.data ? " " + absolute(s.data) : ""}`)
    .concat(sources[0]?.name ? [`use ${sources[0].name}`] : [])
    .join("\n");
  const results = await interp.run(prelude);
  const failed = results.filter((r) => r.error);
  if (failed.length) {
    status.textContent = failed.map((r) => `${sources[r.line - 1]?.name ?? "source"}: ${r.error!.message}`).join("; ");
    renderResults(failed, output, { showSource: true });
    return;
  }
  const ds = interp.dataset;
  status.textContent = ds ? `${sources.length} source${sources.length === 1 ? "" : "s"}; default ${sources[0].name}: ${ds.rows.length} responses, ${ds.questions.length} questions` : "no data";
}

async function run(): Promise<void> {
  if (!interp) await load();
  if (!interp || !interp.dataset) return;
  runBtn.disabled = true;
  try {
    const results: RunResult[] = await interp.run(editor.value);
    renderResults(results, output, { engine: engineSel.value as ChartEngine, dataset: interp.dataset });
  } finally {
    runBtn.disabled = false;
  }
}

runBtn.addEventListener("click", () => void run());
reloadBtn.addEventListener("click", () => void load().then(run));
addBtn.addEventListener("click", () => {
  sources.push({ name: `source${sources.length + 1}`, survey: "", data: "" });
  renderSources();
});
editor.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    void run();
  }
});

void load().then(run);
