# Architecture

For people changing the code.

## Overview

```
script text
   │  src/lang            lexer → parser → AST (one Statement per line)
   ▼
Interpreter            src/interpreter   threads a PipeContext { dataset, value } through each command
   │
   ├─ surveycore commands   src/surveycore     load, questions, show, sample, count, avg…, describe, filter
   └─ visualization cmds    src/visualization  draw bar/vbar/pie/doughnut/hist/gauge/line, save
   │
   ▼
RunResult[]            { line, source, value | error }
   │
   ├─ CLI    src/cli   formats to text / JSON, writes chart files
   └─ Web    src/web   renders into the DOM (ApexCharts or survey-analytics)
```

Two hard rules keep the Node path DOM-free:

1. `src/surveycore` never imports `survey-analytics`.
2. Only `src/visualization/render.ts` imports `apexcharts` and `survey-analytics` (both lazily), and only `src/web` imports `render.ts`. `test/node-safety.test.ts` checks that the core entries import in plain Node.

## Modules

### `src/lang`

- `lexer.ts` — `stripComment`, `splitPipes` (respects quotes), `tokenize`, `splitWords` (raw arguments for `load`/`save`). `splitStatements` groups physical lines into statements (indentation, clause words, open parentheses, trailing `|`/`,`/`\`); `tokenize` and `splitPipes` track line numbers across the embedded newlines.
- `parser.ts` — `parse(source)` and `parseLine(text, lineNo)`. Recursive descent; expression precedence is or < and < not < comparison, `between(a, b)` desugars to `>= a and <= b`, and `is` / `contains` (with `strict` / `regex` options) become a `match` node evaluated in `filter.ts`. Accepts the call form `name(arg, …)` (with nested aggregate calls one level deep, `count(all)`, and option words such as `right` inside chart calls), the `with` list and the `against` clause, the space-separated form, records the `draw` prefix, and desugars `where` into a leading `filter` command. A parse error becomes a `Statement` of kind `error`, so later lines still parse.
- `ast.ts` — `Statement`, `Command`, `Arg`, `Ref`, `Expr`.
- `tokens.ts` — reserved words, the `draw` prefix, the raw-argument command set and the expression command set.
- `errors.ts` — `DslError` with `line`/`col`.

### `src/interpreter`

- `values.ts` — the `Value` union: `scalar`, `table`, `rows`, `chart`, `message`, `dataset`.
- `context.ts` — `IO` (host abstraction: `readJson`, `fetchJson`, `writeText`), `Env` (default dataset, variables, IO, RNG), `PipeContext`, `CommandImpl` (with a `kind`: `value`, `draw` or `action`; the interpreter checks that `draw` is written only before `draw` commands).
- `interpreter.ts` — `Interpreter.run/runLine/runStatement/runPipeline`. Handles `let`, variables as the first command of a pipeline, and the rule that a plain `load` updates the default dataset while a `let`-bound one does not. `seededRandom` is a mulberry32 PRNG.

### `src/surveycore`

- `dataset.ts` — `Dataset.fromJson(survey, data, origin)` builds a `survey-core` `Model` and a list of `Column`s (`buildColumns`); `Dataset.combined(columns, rows, meta)` builds one without a model (union/join), with `conflicts` that `resolve` reports for bare names. A column has a `type` (`number`, `category`, `multi`, `boolean`, `text`, `date`, `object`), optional `choices`, and a `get(row)` reader. Sub-paths (matrix rows, matrix-dropdown cells, multiple-text items) are pre-built; checkbox choices (`colors.red`) are derived on demand in `resolve`. `where(pred)` returns a new dataset sharing model and columns.
- `stats.ts` — pure functions over `Dataset` + `Column`: `avg/sum/min/max/median/stddev`, `frequency`, `matrixFrequency`, `histogram`, `groupBy`, `describe`, and for series charts `keyRepeats`, `seriesByKey`, `choiceSeriesByKey`.
- `filter.ts` — `compileFilter(expr, ds, vars)` turns an `Expr` into a `(row) => boolean`; references are resolved once, scalar variables become constants.
- `loader.ts` — `loadSource` (path vs URL), `loadDataset`, and a shared `fetchJson`.
- `coerce.ts` — `toNumber`, `isEmpty`, `looseEquals`, `round`.
- `measures.ts` — `resolveMeasure(arg, cmd, dataset, keyRepeats)` turns an argument (bare question, aggregate call, `count(all)`) into a `Measure`, applying `defaultAggregate` when the group repeats; `measureTable(dataset, key | null, measures)` evaluates them per group. Shared by `get` and by series charts.
- `combine.ts` — `unionDatasets(named[], rules)` (same-kind-and-choices merge rule, `merge … as` coercions, `source` column, qualified `name.q` columns, conflicts), `joinDatasets(left, right, keyL, keyR, options)` (exact/loose/label key matching, left/inner, one-to-many guard, right rows stored under a hidden `$right` property read through the right-hand columns) and `renameColumns`.
- `commands.ts` — the data commands, including `get` (several measures in one table, or a projection), `use` / `sources` and the combine commands. The aggregate commands are generated from one factory. `setsDefault` on a command makes a plain statement change the default dataset (`load`, `use`).

### `src/visualization`

- `spec.ts` — `buildChartSpec(kind, column, dataset, opts)` returns a `ChartValue` whose `spec` holds the plotted `data`, a `layout` (title, horizontal, stacked, legend) and the ApexCharts options built from them (`spec.apex`). No functions anywhere, so specs round-trip through `JSON.stringify` and are golden-testable.
- `apex.ts` — `apexOptions(input)` builds the ApexCharts options from the data and layout (pie/donut, radialBar gauge, bar/column, line, mixed column+line with a second y-axis, stacked groups) in one flat dashboard style (`THEME`: muted palette from `palette.ts`, grey tracks behind bars, values printed instead of a value axis, monospace labels). `independentScales` decides when series are too far apart to share an axis.
- `series.ts` — `buildSeriesChart(parts, keyRef, dataset)` for `against` charts: resolves each series with `surveycore/measures.ts`, evaluates them with `measureTable`, and emits series with per-series `type` (mixed column + line charts), an optional right axis and stack groups. Sets `spec.mode = "series"`.
- `commands.ts` — chart commands (one factory for all kinds; routes to `buildSeriesChart` when `against` is present) and `save` (`serializeValue` picks JSON or CSV by extension).
- `render.ts` — browser only. `renderApex` (lazy import of `apexcharts`) and `renderSurveyAnalytics` (dynamic import of `survey-analytics/survey.analytics.apexcharts`, then `VisualizerFactory.createVisualizer(question, rows, options)` and sets the chart type).
- `palette.ts` — ten colours.

### `src/cli`

`main.ts` parses arguments with `node:util.parseArgs` and dispatches `run` / `eval` / `repl`. `io.ts` is the filesystem + fetch `IO`. `format.ts` renders values as text; `termchart.ts` draws chart values as coloured block bars (24-bit ANSI, `NO_COLOR`/`FORCE_COLOR` aware). `repl.ts` wraps `node:readline`. `index.ts` re-exports these as `surveyql/cli`.

### `src/web`

`WebIO`, `createWebInterpreter`, `run`, `renderResults`.

## Adding a command

1. Implement `CommandImpl`:

   ```ts
   const mode: CommandImpl = {
     names: ["mode"],
     kind: "value",
     usage: "mode(<question>)",
     run(ctx, cmd, env) {
       const ds = requireDataset(ctx, cmd);
       const ref = cmd.args[0];
       if (!ref || ref.kind !== "ref") throw new DslError("mode: missing question", cmd.line, cmd.col);
       const col = ds.resolve(ref);
       const f = stats.frequency(ds, col);
       const i = f.counts.indexOf(Math.max(...f.counts));
       return { ...ctx, value: scalar(`mode(${col.key})`, f.labels[i] ?? null) };
     },
   };
   ```

2. Add it to `surveycoreCommands` or `visualizationCommands`, or pass it through `createInterpreter(io, { commands: [mode] })` from outside.

Both `mode(gender)` and `mode gender` now parse. `where` needs no work: the parser already rewrote it into a `filter` in front of your command. `by` arrives as `cmd.by` (a `Ref`); use `stats.groupBy` if you support it.

Commands that need raw arguments (paths) must be added to `RAW_COMMANDS` in `tokens.ts`; commands that take an expression go in `EXPR_COMMANDS`.

## Adding a chart kind

Add the name to `CHART_KINDS` (the command factory tags it `kind: "draw"`, so `draw` is required in front of it) and a branch in `buildChartSpec` in `spec.ts`, producing `data` + `layout` (and, if the kind needs a new shape, a branch in `apex.ts`). Map it in `SA_CHART_TYPES` in `render.ts` if survey-analytics has an equivalent.

## Build and test

- `tsup.config.ts` builds four bundles: the library (`index`, `surveycore/index`, `visualization/index`; ESM + CJS + d.ts), the web entry (ESM, browser platform), the CLI binary (ESM with a shebang), and `cli/index` (ESM + d.ts).
- `vitest.config.ts` runs `test/**/*.test.ts` in Node; `render.test.ts` opts into jsdom with a file comment and mocks `apexcharts`.
- `test/golden.test.ts` runs `fixtures/example.svql` with a fixed seed and compares to `test/golden/example.expected.json`. Set `UPDATE_GOLDEN=1` to regenerate after an intentional change.
- `test/cli.test.ts` executes the built CLI and starts a local HTTP server to test URL loading. It skips itself if `dist/cli/main.js` is missing, so run `npm run build` first.

## Known limitations

- `matrixdynamic` / `paneldynamic` are typed `object`; only `show`, `count` and `describe` handle them.
- Series charts cannot sort or limit groups, and survey-analytics cannot render them or combined (union/join) data (ApexCharts is used).
- No authentication for remote URLs.
- Gauge is a radial-bar approximation; the real numbers are in `spec.stats`.
