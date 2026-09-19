# CLI

After `npm run build`, the command is `node dist/cli/main.js`, or `surveyql` after `npm link`. While developing, `npm run dev:cli -- <args>` runs the TypeScript source directly (via `tsx`), so no rebuild is needed between edits.

```
surveyql run <script.svql> [options]
surveyql eval "<line>[; <line>...]" [options]
surveyql repl [options]
surveyql --help
```

## Options

| Option | Description |
|---|---|
| `--survey <path or URL>` | Survey definition JSON. Pre-loads the dataset so the script does not need a `load` line. |
| `--data <path or URL>` | Responses JSON. Requires `--survey`. |
| `--out <dir>` | Write each chart to `<dir>/NN-<type>-<question>.json` (created if missing) and name the file under the chart's header line. |
| `--json` | Print one JSON object per result line (see below). |
| `--seed <n>` | Seed the random generator used by `sample`. |
| `--color`, `--no-color` | Force ANSI colours in terminal charts on or off. Default: on when stdout is a terminal; `NO_COLOR` and `FORCE_COLOR` are honoured. |
| `-h`, `--help` | Usage. |

Local paths are relative to the current directory. URLs are fetched with Node's `fetch`.

## `run`

Executes a script file, one line at a time, printing each result. Errors are printed to stderr as `error (line N): message` and do not stop the run.

```sh
surveyql run fixtures/example.svql --out charts --seed 42
```

## `eval`

Runs one or more statements given on the command line. Separate statements with `;`.

```sh
surveyql eval "count(gender); avg(income) where gender is 'female'" --survey s.json --data d.json
```

Watch your shell's quoting: use single quotes inside double quotes (or the reverse). In PowerShell, escape inner double quotes with a backtick.

## `repl`

An interactive prompt. Variables and the loaded dataset persist between lines.

```
$ surveyql repl --survey fixtures/survey.json --data fixtures/responses.json
surveyql REPL. Type :help for commands, :quit to exit.
Loaded 20 responses, 8 questions
svql> avg(age)
avg(age) = 36.6
svql> let adults = filter age >= 18
adults = dataset (19 rows)
svql> adults | count(colors)
...
svql> :quit
```

Meta commands:

| | |
|---|---|
| `:help`, `:h` | command summary |
| `:questions` | same as `questions()` |
| `:vars` | names of bound variables |
| `:quit`, `:q`, `:exit` | leave |

When a line is incomplete (an open parenthesis, or a trailing `|`, `,` or `\`) the REPL asks for more with a `...` prompt; an empty line submits what you have so far:

```
svql> get avg(income, 1),
  ...   count(all) by gender
```

You can also pipe a script into the REPL: `Get-Content lines.txt | surveyql repl --survey …`.

## Output formats

### Default

- Scalars: `avg(age) = 36.6`
- Tables: aligned columns, numbers right-aligned, header underlined
- Rows: a table of responses followed by `(5 of 20 rows)`; long cells are truncated
- Charts: drawn in the terminal as coloured bars (see below); with `--out`, the header line also names the file the spec went to: `[chart bar satisfaction] -> charts\01-bar-satisfaction.json`
- Messages: the text (`Loaded 20 responses, 8 questions`, `Saved out/gender.csv`, `n = 3`)

### Terminal charts

Every chart is drawn in the terminal, in the same style as the web charts: block bars in the palette colours over a dim track, the values in a column on the right, a legend line for several series, and the scale footnote for ratings.

```
[chart bar satisfaction]
Overall satisfaction
  1  █████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  1
  2  ██████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  3
  3  ██████████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░  4
  4  ████████████████████████████████████████████████████████████  7
  5  ██████████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░  4
  1 · very unsatisfied   5 · very satisfied
```

- Pies and doughnuts become one bar per slice with the count and percentage; gauges a single bar over the scale; vertical bars, histograms and lines are drawn as horizontal rows (line series use `▬`).
- Stacked choice counts share one bar (`5 + 9 + 6 = 20`); series on a `right` axis, and series whose magnitudes are too far apart to share a scale, are scaled on their own and the chart says so.
- Colours are 24-bit ANSI codes, emitted when stdout is a terminal. `--color` forces them (for example when piping to `less -R`), `--no-color` suppresses them, and the `NO_COLOR` / `FORCE_COLOR` environment variables are honoured. The width follows the terminal, up to 60 cells per bar.

### `--json`

One line per statement, always to stdout:

```json
{"line":2,"source":"avg(age)","value":{"kind":"scalar","label":"avg(age)","value":36.6}}
{"line":3,"source":"avg(gender)","error":{"message":"avg: 'gender' is a category question, not numeric; use 'count(gender)'","line":3,"col":1}}
{"line":4,"source":"draw bar(gender)","value":{"kind":"chart","chartType":"bar","question":"gender","title":"Gender","spec":{...}},"chartPath":"charts/01-bar-gender.json"}
```

Datasets are summarized as `{"kind":"dataset","rows":13,"columns":[...]}`. See [Language reference § Result values](language.md#10-result-values) for the shapes.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | every statement succeeded |
| 1 | at least one statement failed, or the survey/data could not be loaded |
| 2 | usage error (unknown command, missing argument, `--data` without `--survey`) |

## Chart files

A chart file is the chart's spec: the plotted numbers plus ready-made ApexCharts options.

```json
{
  "mode": "distribution",
  "layout": { "title": "Gender", "legend": true },
  "data": { "labels": ["Male", "Female", "Other"], "series": [{ "label": "Responses", "values": [8, 9, 3] }] },
  "apex": { "chart": { "type": "pie" }, "series": [8, 9, 3], "labels": [...] }
}
```

`apex` goes straight to `new ApexCharts(el, spec.apex)`; `data` has the plain numbers for any other library. Two things to know when using `apex` directly for horizontal bars: a chart with one series (or one stack) carries an extra unnamed "track" series (`track: [indexes]`) that fills each row to the same end and whose data label is meant to show the real value; and when `layout.scales` is `"independent"` the bar lengths are percentages of each series' maximum (ApexCharts cannot give horizontal bars several axes). `renderApex` attaches formatters that print the real values from `data`, and so should you. Series charts add `"mode": "series"` and `"against"`. Gauges are radial bars; the average and the scale bounds are in the title text and `stats`.

## Using the CLI pieces from Node

```ts
import { NodeIO, formatResult } from "surveyql/cli";
import { createInterpreter } from "surveyql";

const io = new NodeIO(process.cwd());
const interp = createInterpreter(io, { seed: 1 });
for (const r of await interp.run("load s.json d.json\navg(age)")) console.log(formatResult(r));
```
