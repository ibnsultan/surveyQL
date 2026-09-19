# Getting started

## Requirements

- Node.js 20 or newer (22 recommended)
- npm

## Install and build

```sh
git clone <repo> surveyql
cd surveyql
npm install
npm run build
```

`npm run build` writes the library and the CLI to `dist/`. To make the `surveyql` command available on your PATH:

```sh
npm link
```

Otherwise call it as `node dist/cli/main.js`.

## Your first script

Create `hello.svql`:

```
load fixtures/survey.json fixtures/responses.json

questions()
avg(age)
count(gender)
sum(income) where subscribed is true
draw bar(satisfaction)
```

Run it:

```sh
surveyql run hello.svql --out charts
```

You get one result per line:

```
Loaded 20 responses, 8 questions
questions
name          question    kind      title                      choices
------------  ----------  --------  -------------------------  ------------------------
age           text        number    How old are you?
gender        radiogroup  category  Gender                     male, female, other
...
avg(age) = 36.6
count(gender)
value   label   count  percent
------  ------  -----  -------
male    Male        8       40
female  Female      9       45
other   Other       3       15
sum(income) = 633000
[chart bar satisfaction] Overall satisfaction -> charts\01-bar-satisfaction.json
```

The chart is drawn right in the terminal as coloured bars, and with `--out charts` its spec also goes to `charts/01-bar-satisfaction.json`: the plotted numbers plus ApexCharts options you can hand to `new ApexCharts(el, spec.apex)`.

## Your own survey

You need two JSON files (or URLs):

1. **The survey definition** — the JSON you give to SurveyJS Creator or `new Model(json)`.
2. **The responses** — an array of `{ questionName: answer }` objects, exactly what `survey.data` holds for each respondent. An object with a `data` or `Data` array (the SurveyJS Service export) is also accepted.

```sh
surveyql repl --survey my-survey.json --data https://example.test/api/results
```

Inside the REPL, type `questions()` to see what you can ask about, then try `count(<name>)` or `avg(<name>)`. `:help` lists the commands, `:quit` exits.

## The playground

The playground's **Sources** panel lists the datasets to load (name, survey, responses). Each row becomes a variable — `let main = load …` — and the first row is the default dataset. Add a second row and combine them in the script with `union(main, other)` or `join(other) on key`.

### Running it

```sh
npm run dev:web
```

Opens `http://localhost:5173` with an editor on the left and results on the right. Press **Run** or `Ctrl+Enter`. The source inputs take a path served by the dev server or any URL with CORS enabled. The **Charts** dropdown switches between ApexCharts (default) and survey-analytics' visualizers.

## Next

- [Language reference](language.md) for everything the language does
- [Cookbook](cookbook.md) for common analyses
