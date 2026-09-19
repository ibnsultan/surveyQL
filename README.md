# SurveyQL

A tiny query language for [SurveyJS](https://surveyjs.io) survey data. Point it at a survey definition and its responses, then ask questions in one line each: `avg(age)`, `count(gender)`, `avg(income) where gender is "female"`, `draw pie(gender)`. It answers with numbers, tables and charts — as plain JSON-safe values that the CLI prints, the browser renders, or your own code consumes.

## What it is

SurveyJS is good at collecting responses and poor at letting you *ask things* of them without writing JavaScript against `survey-core` or wiring up dashboards in `survey-analytics`. SurveyQL sits on top of both: a small, readable language for the questions analysts actually ask (how many, on average, in this segment, split by that group, show me), plus the tooling to run it wherever the data is.

It is for anyone who has a SurveyJS survey and wants answers quickly: researchers exploring results in a REPL, developers embedding live stats and charts in a web page, teams keeping a folder of `.svql` scripts that regenerate a report from fresh exports.

## What it does

- **Statistics** — `count`, `sum`, `avg`, `median`, `min`, `max`, `stddev` over any question, with `where` conditions, `filter` pipelines and `by` grouping for cross-tabs. Multiple measures in one table with `get`.
- **Charts** — `draw bar`, `pie`, `hist`, `gauge`, and multi-series charts that plot questions against each other (`draw bar(monitors) with line(students, right) against school_name`). Output is a JSON-safe ApexCharts spec you can render, save or post-process.
- **Composition** — name a segment with `let`, chain steps with `|`, `save` any result to JSON or CSV, `union` survey rounds and `join` surveys on a shared key.
- **Data loading** — the survey definition and responses come from local files or URLs; question types, choices and matrices are understood from the definition, so results use labels rather than raw values.

## Where it runs

- **Standalone**, like R: a `surveyql` CLI with `run` (scripts), `eval` (one-liners) and an interactive `repl`. Charts render as coloured bars in the terminal; `--out` writes the specs to disk.
- **In the browser**: `surveyql/web` exports `run()` and `renderResults()` for embedding in any page, and a Vite playground is included for trying scripts interactively.
- **As a library**: the language, interpreter and each module are importable on their own.

## How it is built

Two independent modules under a shared language:

| Module            | Depends on                                     | Provides                                                                                          |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `surveycore`    | `survey-core`, Node only                     | dataset loading, coercion, statistics, filtering,`union`/`join`, data commands                |
| `visualization` | `apexcharts`, `survey-analytics` (browser) | chart specs,`draw`/`save` commands, renderers for ApexCharts and survey-analytics visualizers |

The lexer, parser and interpreter (`src/lang`, `src/interpreter`) know nothing about surveys or charts; commands from the two modules register into the interpreter. See [Architecture](docs/architecture.md).

## Quick start

```sh
npm install
npm run build
node dist/cli/main.js run fixtures/example.svql --out charts   # or: surveyql run … after npm link
node dist/cli/main.js repl --survey fixtures/survey.json --data fixtures/responses.json
npm run dev:web        # playground at http://localhost:5173
npm test
```

## Documentation

|                                           |                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| [Getting started](docs/getting-started.md) | install, first script, your own survey, the playground                    |
| [Language reference](docs/language.md)     | commands, clauses, expressions, variables, values, errors                 |
| [Cookbook](docs/cookbook.md)               | segments, cross-tabs, charts, exports, remote data                        |
| [CLI](docs/cli.md)                         | `run` / `eval` / `repl`, options, output formats, exit codes        |
| [Web integration](docs/web.md)             | `run()`, `createWebInterpreter()`, `renderResults()`, chart engines |
| [Architecture](docs/architecture.md)       | module layout, pipeline, adding commands and chart kinds                  |

## At a glance

| I want to…                        | Write                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| count responses                    | `count(all)`                                                                                                                                                      |
| see the distribution of a question | `count(gender)`                                                                                                                                                   |
| average a numeric question         | `avg(age)`                                                                                                                                                        |
| restrict to a segment              | `avg(income) where gender is "female"`, `avg(income) where age between(25, 40) and gender is "female"`, or `filter … \| avg(income)`                          |
| compare groups                     | `avg(satisfaction) by gender`                                                                                                                                     |
| choose decimal places              | `avg(income, 2)`                                                                                                                                                  |
| split a long statement             | indent the next line, or start it with a reserved word (`with`, `against`, `where`, `by`, `and`, `is`, …) or `\|`                                     |
| several numbers in one table       | `get avg(income), count(all), median(age) by gender`                                                                                                              |
| chart it                           | `draw bar(satisfaction)`, `draw pie(gender)`, `draw hist(age, 5)`, `draw gauge(satisfaction)`                                                               |
| plot questions against another     | `draw bar(cpus, printers) against school_name`, `draw bar(monitors) with line(students, right) against school_name`, `draw pie(sum(students)) against region` |
| keep a segment for later           | `let adults = filter age >= 18` then `adults \| …`                                                                                                              |
| see a chart in the terminal        | `draw bar(satisfaction)` on the CLI draws coloured bars; `--out DIR` also writes the spec                                                                       |
| save a chart or table              | `draw pie(gender) \| save charts/gender.json`, `count(gender) \| save out.csv`                                                                                    |
| load from a server                 | `load https://host/survey.json https://host/results`                                                                                                              |
| compare survey rounds              | `let waves = union(baseline, endline)` then `waves \| avg(satisfaction) by source`                                                                               |
| enrich with another survey         | `let m = join(schools, inventory) on school_name` then `m \| get students, inventory.cpus by region`                                                             |

## Web in three lines

```ts
import { run, renderResults } from "surveyql/web";
const results = await run("avg(age)\ndraw bar(gender)", { survey, data });
renderResults(results, document.getElementById("out")!);
```

## Layout

```
src/lang            lexer, parser, AST
src/interpreter     values, pipeline context, interpreter
src/surveycore      Dataset, stats, filter, loader, data commands
src/visualization   chart specs, chart/save commands, browser renderers
src/cli             run / eval / repl
src/web             browser entry
playground/         Vite playground
fixtures/           sample survey, responses, example script
docs/               documentation
test/               vitest suites
```

## Status

Version 0.1. Not yet supported: sorting or limiting groups in series charts, survey-analytics rendering of series charts, `matrixdynamic`/`paneldynamic` beyond `show`/`count`, authenticated remote URLs. See [Architecture § Known limitations](docs/architecture.md#known-limitations).
