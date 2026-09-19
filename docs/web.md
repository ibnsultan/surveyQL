# Web integration

The browser entry is `surveyql/web`. It bundles the interpreter with a browser `IO` and two chart renderers. Peer dependencies: `survey-core`, `apexcharts`, and `survey-analytics` (only loaded when you pick that engine).

## Quick start

```ts
import { run, renderResults } from "surveyql/web";

const results = await run("avg(age)\ncount(gender)\ndraw bar(satisfaction)", { survey, data });
renderResults(results, document.getElementById("output")!);
```

`survey` is the SurveyJS definition object and `data` the array of responses (or `{ data: [...] }`). Both may also be URL strings; they are fetched before the run.

## API

### `run(script, options): Promise<RunResult[]>`

One-shot execution. Creates a fresh interpreter each call, so variables do not persist.

### `createWebInterpreter(options): Promise<Interpreter>`

Returns an interpreter you keep. Variables and the loaded dataset persist across `interp.run(script)` and `interp.runLine(line)` calls, which is what an interactive page wants.

```ts
const interp = await createWebInterpreter({ survey: "/survey.json", data: "/responses.json" });
await interp.run("let adults = filter age >= 18");
const results = await interp.run("adults | draw pie(gender)");
```

`interp.dataset` is the current default `Dataset` (or `null`); assign it to swap data.

### Options

| Option | Type | Meaning |
|---|---|---|
| `survey` | object or URL string | survey definition |
| `data` | array, `{data: [...]}`, or URL string | responses |
| `files` | `Record<string, unknown>` | in-memory files that `load <name>` can read |
| `seed` | number | deterministic `sample` |
| `commands` | `CommandImpl[]` | extra commands to register |

Inside a script, `load` resolves a name first against `files`, then as a URL relative to the page (so `load /survey.json` fetches from your origin), and absolute `http(s)://` URLs directly.

### `renderResults(results, element, options?)`

Clears `element` and appends one `<section class="sdsl-result">` per result:

| Result | Markup |
|---|---|
| scalar | `<pre class="sdsl-scalar">avg(age) = 36.6</pre>` |
| message | `<pre class="sdsl-message">`; a `save` result adds a `<details>` with the file content |
| table / rows | `<table class="sdsl-table">` (numeric cells get class `num`) |
| chart | `<div class="sdsl-chart">` with an ApexCharts SVG or a survey-analytics visualizer |
| error | the section gets class `error` and a `<pre class="sdsl-error">` |

Each section starts with `<code class="sdsl-source">` showing the line; pass `showSource: false` to omit it.

Options:

| Option | Meaning |
|---|---|
| `engine` | `"apexcharts"` (default) or `"survey-analytics"`. survey-analytics cannot draw series charts (`against`) or combined (union/join) data; those fall back to ApexCharts. |
| `dataset` | fallback data for the survey-analytics engine; charts normally carry their own |
| `showSource` | show the source line above each result |

Style the classes yourself; `playground/style.css` is a starting point.

### `renderApex(chartValue, element): Promise<{ destroy() }>`

Renders one chart value with ApexCharts (imported lazily) from `spec.apex` and returns a handle to destroy it. Number formatters (thousands separators, real values for percentage-scaled bars) are attached here, since they cannot live in the JSON spec. All charts share one flat style: muted colours, a grey track behind each bar, values printed on the chart instead of a value axis, monospace labels; the container gets the same light background via `.sdsl-chart`.

### `renderSurveyAnalytics(chartValue, dataset, element): Promise<{ destroy() }>`

Renders one chart value with survey-analytics' visualizer (its ApexCharts build) for that question. The package is imported lazily on first use. Include its stylesheet once:

```ts
import "survey-analytics/survey.analytics.apexcharts.css";
```

Chart types map as: bar → bar, vbar → vbar, pie → pie, doughnut → doughnut, hist → vhistogram, line → line, gauge → gauge. The visualizer keeps its own toolbar, so users can change the chart type afterwards.

### `WebIO`

The `IO` implementation used above. `readJson(name)` looks in `files`, then fetches; `fetchJson(url)` uses `fetch`; `writeText` returns `false`, which makes `save` return its content in `value.saved` instead of writing.

## Downloads for `save`

```ts
for (const r of results) {
  if (r.value?.kind === "message" && r.value.saved) {
    const blob = new Blob([r.value.saved.text], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: r.value.saved.path });
    a.click();
  }
}
```

## Using the values directly

You do not have to use `renderResults`. Every `RunResult` has `value` (see [Language reference § Result values](language.md#10-result-values)). A chart's `spec.apex` is a plain ApexCharts options object; `spec.data` has `labels` and `series` for any other charting library.

```ts
for (const r of results) {
  if (r.value?.kind === "chart") new ApexCharts(el, r.value.spec.apex).render();
  if (r.value?.kind === "table") console.table(r.value.rows);
}
```

## Bundling notes

- Import `survey-analytics/survey.analytics.apexcharts` (the ESM build); it works alongside the `apexcharts` package this library already uses. Do not import the plotly or chartjs builds; they pull in libraries you do not need.
- `survey-analytics` touches `document` at import time. `surveyql/web` imports it lazily, so server-side rendering of the rest of the page still works; just do not call `renderSurveyAnalytics` on the server.
- Remote URLs need CORS headers from the remote host. Failures say so in the error message.

## The playground

`playground/` is a plain Vite app using this API: `main.ts` creates one interpreter with `createWebInterpreter`, runs the editor contents on **Run**, and calls `renderResults` with the selected engine. `npm run dev:web` serves it; `npm run build:web` writes a static build to `dist-web/`.
