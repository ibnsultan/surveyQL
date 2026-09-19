# Language reference

## 1. Structure

A script is a list of statements, one per line. A statement can be spread over several lines (see *Line continuation* below).

```
# a comment; everything after # is ignored (except inside quotes)
avg(age)                              # a value
avg(income) where age > 30            # a value with a clause
draw pie(gender)                      # a chart
filter age > 30 | avg(income)         # a pipeline: commands joined with |
let adults = filter age >= 18         # a variable binding
```

Three shapes, borrowed from SQL:

- **Values** are function calls: `count(gender)`, `avg(income)`, `sample(5)`, `questions()`, or a `get` list: `get avg(income), count(all) by gender`. Clauses come after: `where <expr>`, `by <question>`.
- **Charts** are `draw` followed by a call: `draw pie(gender)`, `draw hist(age, 5) where age > 18`.
- **Actions** are plain words with arguments: `load`, `filter`, `save`, `let`.

Commands separated by `|` form a **pipeline**; each command receives the data the previous one left behind.

### Line continuation

A line belongs to the statement above it when any of these holds:

| Rule                                                                                                                                                                  | Example                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| it is**indented** (starts with a space or tab)                                                                                                                  | `draw bar(monitors)` ⏎ `    with line(students)` |
| it starts with a**reserved word** (`with`, `against`, `where`, `by`, `and`, `or`, `not`, `in`, `is`, `contains`, `between`) or with `\|` | `avg(income)` ⏎ `where age > 30`                 |
| the statement so far is**incomplete**: an open `(`, or a trailing `                                                                                           | `, `,`or`\`                                       |

```
draw bar(number_computers)
     with line(working_computers, faulty_computers)
     against school_name

get avg(income, 1),
    count(all),
    median(age)
  by gender

let seniors = filter age >= 60
  and subscribed

schools
  | filter region is "dodoma"
  | avg(students)
```

A blank line ends the statement (unless a parenthesis is still open), and an indented line that starts with `let` or `draw` always begins a new statement. Comments are stripped per line, so `# …` can sit at the end of any continued line. Errors report the physical line of the offending token; results are labelled with the whole statement collapsed to one line.

There is no statement terminator: `;` is not part of the language (the CLI's `eval` uses it only to separate arguments).

## 2. Tokens

| Token       | Form                                               | Examples                                |
| ----------- | -------------------------------------------------- | --------------------------------------- |
| name        | letter or`_`, then letters, digits, `_`, `-` | `age`, `q1`, `first-name`         |
| quoted name | backticks                                          | `` `How old are you?` ``, `` `where` `` |
| number      | optional`-`, digits, optional decimals           | `3`, `-2.5`                         |
| string      | double or single quotes,`\"` escapes             | `"female"`, `"it's"`                |
| operators   | `== = != < <= > >=`                              |                                         |
| punctuation | `. ( ) [ ] ,`                                    |                                         |

Reserved words, only in argument and expression positions: `where by against with on as all and or not in is contains between true false null`. A question with one of those names is written in backticks: ``count(`where`)``. `strict` and `regex` are option words inside `is(...)` / `contains(...)` and need backticks there too. `draw` and `let` cannot be variable names.

## 3. Referring to questions

| Reference                | Meaning                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `age`                  | the question named`age`; falls back to matching `valueName`, then the title (case-insensitive) |
| `` `How old are you?` `` | any name, including spaces and punctuation                                                         |
| `colors.red`           | one choice of a checkbox, tagbox, ranking or radiogroup, as a yes/no column ("was it selected?")   |
| `features.price`       | one row of a single-choice matrix, as a category column                                            |
| `grid.row1.col1`       | one cell of a matrix dropdown                                                                      |
| `contact.email`        | one item of a multiple-text question                                                               |

An unknown name produces `unknown question 'agee'; did you mean 'age'?`.

### Question kinds

Every question is given a kind that decides which commands accept it:

| Kind         | SurveyJS types                                                                                             | Value in a response                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `number`   | `rating`, `slider`, `expression`, `text` with `inputType: number` or `range`                   | number                                                       |
| `date`     | `text` with a date input type                                                                            | string                                                       |
| `category` | `radiogroup`, `dropdown`, `imagepicker` (single), matrix rows, matrix-dropdown cells                 | one value                                                    |
| `multi`    | `checkbox`, `tagbox`, `ranking`, `imagepicker` with `multiSelect`                                | array of values                                              |
| `boolean`  | `boolean`                                                                                                | `true`/`false` (`valueTrue`/`valueFalse` normalized) |
| `text`     | `text`, `comment`, multiple-text items                                                                 | string                                                       |
| `object`   | `matrix`, `matrixdropdown`, `matrixdynamic`, `paneldynamic`, `multipletext` (the whole question) | object                                                       |

`html`, `image`, `file`, `signaturepad` and panels are skipped. `questions()` prints the kind of every question.

## 4. Values

### 4.1 Loading

```
load <survey> [<responses>]
```

Arguments are taken verbatim (no tokenizing), split on whitespace; quote a path with spaces. Each may be a local path or an `http://` / `https://` URL.

- Survey: the SurveyJS definition JSON.
- Responses: an array of `{ name: value }` objects, or an object whose `data`, `Data`, `results`, `responses` or `rows` field is such an array. Omitted means zero responses.

Result: `Loaded 20 responses, 8 questions`. A plain `load` sets the default dataset for the rest of the script. `let x = load …` binds a dataset without changing the default. See § 6.1 for working with several sources.

### 4.2 Inspecting

| Call                                  | Result                                                                                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `questions()` (alias `columns()`) | table: name, SurveyJS type, kind, title, choices. Names shadowed by a variable are flagged. On combined data (§ 6.1) an`in` column shows the source(s) and conflicts are listed. |
| `sources()` (alias `datasets()`)  | every dataset bound to a variable: name, responses, questions, origin (path, URL or`union(...)` / `join(...)`), and which one is the default                                    |
| `show([n])` (alias `head`)        | first`n` responses (default 10)                                                                                                                                                   |
| `sample(n)`                         | `n` random responses (default 5); `--seed` on the CLI makes it repeatable                                                                                                       |
| `describe([q])` (alias `summary`) | for one question: n, missing, mean/median/min/max/stddev or distinct/top; for all questions: one row each                                                                           |

### 4.3 Counting

```
count(all | q) [where <expr>] [by <q>]
freq(q)    [where <expr>] [by <q>]
```

| Form                                                 | Result                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `count(all)`                                       | number of responses (scalar)                                                                                              |
| `count(q)` for category / multi / boolean / rating | frequency table: value, label, count, percent of respondents who answered; a final`(no answer)` row when some are empty |
| `count(q)` for number / text                       | number of non-empty answers (scalar)                                                                                      |
| `count(q)` for a matrix                            | rows × columns table of counts                                                                                           |
| `freq(q)`                                          | always the frequency table, even for numeric questions                                                                    |
| `count(all) by q`                                  | responses per group                                                                                                       |
| `count(q) by q2`                                   | cross-tab: one row per`q2` group, one column per choice of `q`                                                        |

Percentages are relative to respondents with a non-empty answer, so multi-select percentages can add up to more than 100.

### 4.4 Aggregates

```
avg(q[, dp]) [where <expr>] [by <q>]     alias: mean
sum(q[, dp]) …
min(q[, dp]) …
max(q[, dp]) …
median(q[, dp]) …
stddev(q[, dp]) …                         sample standard deviation
```

The question must be numeric (kind `number`, or a rating). Empty and non-numeric answers are skipped. With `by`, the result is a table with one row per group: group label, the aggregate, and `n` (responses in the group). Without matching values the scalar is `null`.

**Decimal places.** Results are rounded to 4 places. A second argument sets the number of places, from 0 to 10, and may be a number or a scalar variable:

```
avg(income, 2)                 # 54277.78
avg(income, 0) by gender       # whole numbers per group
let dp = 1
median(age, dp)
```

The same argument works wherever an aggregate call appears: in `get` (`get avg(income, 2), count(all) by gender`) and in chart series (`draw bar(avg(income, 1)) against gender`). The label stays `avg(income)`.

### 4.5 Several measures at once: `get`

```
get <measure>, <measure>, ... [where <expr>] [by <q>]
```

`get` is the SQL `select`: name what you want, separated by commas, and get one table.

```
get avg(income), count(all), median(age) by gender     # one row per gender
get avg(income), count(all)                           # one summary row
get income, satisfaction, subscribed by gender         # bare questions summarised per group
get age, gender, income where age > 50                # only questions, no by: those columns of every response
```

A **measure** is anything a chart series can be (see § 5.1): an aggregate call (`sum(q)`, `avg(q)`, `min`, `max`, `median`, `stddev`, each with an optional `, dp` for decimal places, `count(all)`, `count(q)`) or a bare question. With `by`, a bare question is summarised with the same defaults as charts (rating/slider → `avg`, other numbers → `sum`, choice/boolean → one column per choice), and the column header shows what was applied. Naming the `by` question itself among the measures is allowed and simply refers to the group column.

Without `by`:

- only aggregates → a single row;
- only bare questions → a projection: the chosen columns of every (filtered) response, as rows;
- a bare question mixed with aggregates → an error asking for `by` or an explicit aggregate.

The bare form accepts commas or spaces between measures; `get(...)` with parentheses also parses.

### 4.6 Filtering

```
filter <expr>
<call> where <expr>
```

`filter` keeps the responses matching the expression for the rest of the pipeline. If it is the last command on the line, the result is the filtered dataset (printed as a row count on the CLI). `x where <expr>` is rewritten to `filter <expr> | x`, so both forms behave identically. Only one `where` per command; combine conditions with `and` / `or`.

## 5. Charts

```
draw bar(q)       [where <expr>]
draw vbar(q)      …      vertical bars
draw pie(q)       …
draw doughnut(q)  …
draw hist(q[, bins]) …   alias: histogram
draw gauge(q)     …
draw line(q[, bins]) …
```

| Chart                                    | Accepts                                  | Shows                                                                                                  |
| ---------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `bar`, `vbar`, `pie`, `doughnut` | category, multi, boolean, rating, matrix | counts per choice; a matrix gives stacked bars (one series per column) or, for pies, totals per column |
| `hist`                                 | number, date                             | counts per equal-width bin; default bins = min(10, ⌈√n⌉)                                            |
| `gauge`                                | number, rating                           | the average on a half-dial from the minimum to the maximum (rating scale bounds when known)            |
| `line`                                 | number (binned) or choice                | the same data as a line                                                                                |

`draw` is required in front of a chart and rejected in front of anything else: `draw avg(age)` is an error. The result is a **chart value** holding JSON-safe ApexCharts options plus the plain data (`labels`, `series`) and a few stats.

### 5.1 Series charts: `against` and `with`

A chart of one question shows its distribution. To plot one or more questions **against** another question, name the series inside the call and the key after `against`:

```
draw bar(number_computers) against school_name
draw bar(monitors, printers, cpus, routers) against school_name        # any number of series
draw bar(sum(monitors)) against region                                 # explicit aggregate per group
draw bar(avg(it_rating)) against region                                # the chart form of "by"
draw bar(satisfaction, count(satisfaction)) against gender             # average, plus counts per rating value
draw pie(sum(students)) against region                                 # one slice per group
draw line(count(all)) against month                                    # responses per month
draw vbar(cpus) against school_name where region is "dodoma"
```

```
draw <chart>(<series>, ...[, right]) [with <chart>(<series>, ...), ...] against <question> [where <expr>]
```

**Series.** Each argument is one series:

| Argument                                                                     | Meaning                                                                                                                                                        |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a numeric question, e.g.`cpus`                                             | its value per group (see the default aggregate below)                                                                                                          |
| `sum(q)`, `avg(q)`, `min(q)`, `max(q)`, `median(q)`, `stddev(q)` | that aggregate of`q` per group; `avg(q, 2)` sets the decimal places                                                                                        |
| `count(all)`                                                               | number of responses per group                                                                                                                                  |
| `count(q)`                                                                 | for a choice, boolean or rating question: one series per choice with its count per group (stacked); for a number or text question: non-empty answers per group |
| a choice or boolean question, e.g.`has_lab`                                | same as`count(q)`: one stacked series per choice                                                                                                             |

**Key.** `against` takes any question except matrices and panels: free text (`school_name`), a choice question (`region`, `month`), a boolean, a number. Groups follow choice order for choice questions and first-seen order otherwise.

**Default aggregate.** When several responses share a key value (two reports for the same school, or a region with many schools), a bare question has to be summarised. The default depends on the question:

| Question                                    | Default           | Why                 |
| ------------------------------------------- | ----------------- | ------------------- |
| rating, slider                              | `avg`           | it is a scale       |
| other numeric (`text` number, expression) | `sum`           | it is a quantity    |
| choice, boolean                             | counts per choice | a stacked cross-tab |

The legend shows what was applied (`sum(monitors)`), and an explicit aggregate always wins: `bar(avg(monitors))`. When every key value is unique the raw values are plotted and the legend shows the plain name.

**Look.** Every chart uses one flat style: muted colours, a grey track behind each horizontal bar, the values printed on the chart instead of a value axis, square legend markers. A chart of a rating question that describes its ends (`minRateDescription` / `maxRateDescription`) gets them as a footnote (under the title for pies): `1 · very unsatisfied   5 · very satisfied`.

**Scales.** Series on one axis share it. When their magnitudes are more than 20× apart (an average rating of 3.6 next to an income of 49,800), a shared axis would hide the small series, so each series — or each stacked group of choice counts — is drawn to its own scale and the values are printed on the bars (`spec.layout.scales = "independent"`). Horizontal bars then have lengths relative to each series' own maximum; vertical charts keep one hidden axis per series. To compare two series on real, separate axes instead, put one on the right: `bar(avg(it_rating)) with line(sum(students), right) against region`.

**Combined charts with `with`.** After the first call, `with` introduces a comma-separated list of further chart calls drawn on the same axes:

```
draw bar(monitors, printers) with line(students) against school_name
draw bar(monitors, printers) with line(students), line(staff, right) against school_name
```

Chart types that can be combined: `bar`, `vbar`, `line`. A combined chart with a line is always vertical. `pie`/`doughnut` take exactly one series and cannot be combined.

**Options.** Inside a chart call, the word `right` puts every series of that call on a secondary y-axis: `line(staff, right)`. To send only one of several series to the right axis, give it its own call: `line(students), line(staff, right)`.

Series charts are always drawn by ApexCharts, also in the playground when the survey-analytics engine is selected (survey-analytics has no mixed charts). `with` without `against`, `against` on a value command, and `hist`/`gauge` with `against` are errors that say what to write instead.

## 6. Actions

### 6.1 Several sources: `use`, `union`, `join`, `rename`

Every `let x = load …` binds a dataset; `x | …` queries it. To combine sources:

```
use <dataset>                                            make a bound dataset the default
union(<a>, <b>, ...) [merge <q> as number|text|category, ...]   stack responses of the same questionnaire
join([<left>,] <right>[, inner|many|loose|labels]) on <q> [= <q2>]   attach another survey's answers on a key
rename <q> as <name>, ...                                rename questions (sub-fields follow)
```

The rules are deliberately strict: nothing is merged or matched unless it is unambiguous, and the message of each command says what was merged, skipped or refused. Combined datasets have no single questionnaire, so their charts always draw through ApexCharts, never survey-analytics.

**`use`**

```
let staff = load staff.json staff-data.json
use staff            # Using staff: 84 responses, 14 questions
count(all)           # now runs on staff
```

**`union`** stacks rows and adds a `source` question (a category whose choices are the variable names; called `_source` if the survey already has a `source`), so `by source` / `against source` separate the waves.

```
let baseline = load survey.json 2025.json
let endline  = load survey.json 2026.json
let waves = union(baseline, endline)
# Combined 640 responses from baseline (312), endline (328). Merged: 29 questions.
waves | avg(satisfaction, 1) by source
waves | draw bar(has_lab) against source
```

A question with the same name in several sources becomes one column only when its **kind matches and, for choice and rating questions, the choices/scale are identical**. Otherwise it is a *conflict*: the bare name errors, and each side stays reachable under a qualified name, `baseline.age` / `endline.age` (qualified names exist for every question, not only conflicts). Questions present in only some sources are kept and empty for the other rows. Nothing is de-duplicated: a respondent in both waves is two rows.

```
waves | avg(age)
# 'age' is number in baseline, text in endline; use baseline.age or endline.age, or union(...) merge age as number|text|category
waves | avg(baseline.age)
```

`merge <q> as <kind>` opts in to a merged column where the sources disagree — you take responsibility for the coercion, in the script where a reader can see it:

- `as number`: values that parse as numbers; everything else is empty
- `as text`: every value as a string (arrays joined with `, `)
- `as category`: raw values with the union of both sides' choices

```
let waves = union(y2025, y2026) merge satisfaction as number, age as number
```

Message parts: `Merged: n questions`, `Merged by rule: …`, `Only in <source>: …`, `Conflicts (not merged): q (number / text); …`. `questions()` on the result adds an `in` column and lists conflicts as `(conflict)` rows.

**`join`** attaches the columns of `right` to the rows of `left` where the key question matches. `left` is the piped-in data (`schools | join(inventory) on school_name`) or named explicitly (`join(schools, inventory) on school_name`). Different key names: `on school_name = school`.

```
let merged = join(schools, inventory) on school_name
# Joined 10 of 12 schools rows with inventory on school_name. No match for 2: Chamwino Primary, Monduli Secondary. Also in inventory (use inventory.<question>): cpus.
merged | get school_name, students, inventory.cpus, tablets by region
merged | draw bar(inventory.cpus) with line(students, right) against school_name
```

| Rule                       | Default                                                                           | Opt in                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| key comparison             | exact after trimming whitespace                                                   | `loose`: case-insensitive                                                                               |
| key kinds                  | must be the same kind on both sides, and single-valued (no multi-select / matrix) | `labels`: also match a choice's label, so a dropdown value can meet free text                           |
| unmatched left rows        | kept, with empty right-hand columns; the message counts them                      | `inner`: drop them                                                                                      |
| several right rows per key | error (`'Kikuyu Primary' matches 2 rows in inventory`)                          | `many`: repeat the left row for each match                                                              |
| name clashes               | the unqualified name is the left side                                             | the right side is always reachable as`inventory.cpus`; non-clashing right columns also work unqualified |

**`rename`** changes question names in the piped-in data; sub-fields (`f.price`) follow. Useful before a union when the same question has different names:

```
let endline2 = endline | rename Q5 as age, Q7 as region
let waves = union(baseline, endline2)
```

### `save`

```
<value> | save <path>      alias: export
```

Writes the value piped into it. Format by extension:

| Value                     | `.json`                                 | `.csv`                      |
| ------------------------- | ----------------------------------------- | ----------------------------- |
| chart                     | the spec (`data`, `layout`, `apex`) | error                         |
| table                     | `{columns, rows}`                       | comma-separated with a header |
| rows                      | the rows                                  | one line per response         |
| dataset (after`filter`) | the rows                                  | —                            |
| scalar / message          | the value object                          | error                         |

In the browser nothing is written; the result carries the text so the page can offer a download.

### `print`

`<value> | print` (alias `echo`) passes the value through unchanged. A bare variable name does the same thing.

## 7. Clauses

### `where <expr>`

Allowed once per command, after the call. Applies before the command runs. Not allowed on `load`, `save`, `filter`.

### `by <q>`

Allowed on `count` and the aggregates. Groups by a category, boolean, rating or multi question. A multi-select response belongs to every group it selected. Groups follow choice order; empty groups are omitted.

## 8. Expressions

Used by `filter` and `where`. An expression is a boolean test applied to each response. It is built from comparisons joined with `and`, `or` and `not`.

**Comparisons** — each takes a value on the left (usually a question reference):

| Form                                                        | Example                                                                                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `value` on its own                                        | `subscribed` — truthiness test                                                                                                                       |
| `value op value` with `op` one of `== = != < <= > >=` | `age >= 18`                                                                                                                                           |
| `value in [v1, v2, …]`                                   | `satisfaction in [4, 5]`                                                                                                                              |
| `value between(lo, hi)`                                   | `age between(25, 40)`                                                                                                                                 |
| `value between lo and hi`                                 | `age between 25 and 40` — same thing, SQL spelling                                                                                                   |
| `value is v` / `value is not v`                         | `gender is "female"`                                                                                                                                  |
| `value contains v` / `value contains not v`             | `comment contains "slow"`                                                                                                                             |
| `value is(v1, v2, …)` / `value contains(v1, v2, …)`   | `region is("dodoma", "arusha")` — any of the values; `not` goes before the parenthesis (`is not(…)`), the options `strict` / `regex` inside |

**Values** — what can appear on either side of a comparison:

| Value                                 | Example                                                     |
| ------------------------------------- | ----------------------------------------------------------- |
| question reference, optionally dotted | `age`, `f.price`, `` `How old are you?` `` (see §2–3) |
| number                                | `30`, `-2.5`                                            |
| string                                | `"female"`, `"it's"`, `'say \"hi\"'`                  |
| `true`, `false`, `null`         | `subscribed == true`                                      |
| parenthesised expression              | `(age > 30 or income > 1000)`                             |
| variable (§9)                        | `age > cutoff`                                            |

Lists `[…]` are only used after `in`.

**Combining** — loosest to tightest binding: `or`, `and`, `not`, then a comparison.

| Form        | Meaning                      |
| ----------- | ---------------------------- |
| `a and b` | both hold                    |
| `a or b`  | either holds                 |
| `not a`   | `a` does not hold          |
| `( … )`  | group to override precedence |

So `not a or b and c` reads as `(not a) or (b and c)`; parenthesise to change it. Comparisons do not chain: `a < b < c` is an error.

The left-hand side of a comparison is normally a question reference and the right-hand side a literal or a variable (§9), but both sides accept any `value`. Lists appear only after `in`.

### Comparisons

| Operator                     | Behaviour                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `is v`                     | the friendly equality: numbers compare numerically, strings compare**case-insensitively**, booleans exactly. `gender is "Female"` matches `female`. |
| `is not v`                 | the negation                                                                                                                                                  |
| `is(v1, v2, …)`           | matches any of the values:`gender is("male", "other")`                                                                                                      |
| `between(a, b)`            | inclusive range:`age between(25, 40)` is `age >= 25 and age <= 40`. Bounds may be variables.                                                              |
| `contains v`               | string: substring, case-insensitive; multi-select: one of the selected choices equals`v`                                                                    |
| `contains(v1, v2, …)`     | any of the values                                                                                                                                             |
| `in [v1, v2]`              | exact membership (same rules as`==`)                                                                                                                        |
| `==`, `=`, `!=`        | exact equality: numeric when both sides are numeric, else case-sensitive string comparison.`1 == "1"` is true, `"Female" == "female"` is false.           |
| `<`, `<=`, `>`, `>=` | numeric when both sides are numeric, otherwise lexicographic                                                                                                  |
| `and`, `or`, `not`     | boolean logic with short-circuit;`and` binds tighter than `or`; parentheses group                                                                         |
| bare reference               | truthy when the answer is a non-empty value, a true boolean, or a non-zero number                                                                             |

### Options for `is(...)` and `contains(...)`

Option words go inside the parentheses, in any position:

| Option     | Effect                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `strict` | case-sensitive:`gender is("Female", strict)` matches only `Female`                                                                             |
| `regex`  | each value is a regular expression (case-insensitive unless`strict`): `comment contains("^(love\|great)", regex)`, `region is("^dar", regex)` |

```
region is "dodoma"
region is("dodoma", "dar es salaam")
region is not("dodoma", "arusha")
age between(25, 40) and region is "dodoma"
comment contains("slow", "expensive")
email contains("@gmail\\.com$", regex)
colors is("red", "blue")                   # multi-select: picked red or blue
```

A question named `strict` or `regex` is written in backticks inside these calls.

### Multi-select answers

For a checkbox/tagbox answer (an array), `is`, `contains` and `in` succeed when **any selected choice** matches. `==` compares the whole selection: `colors == "red"` is true only when red is the sole choice.

### Empty answers

`null`, missing, `""` and `[]` never satisfy a comparison, except `is null` / `== null` (true) and `is not null` / `!= null` (false). So `income > 0` excludes respondents who left income blank.

**Variables** holding a number, string or boolean can be used anywhere a literal can: `filter age > cutoff`, `age between(lo, hi)`.

Examples:

```
avg(income) where age < 30 or age > 60
avg(income) where age between(25, 40) and subscribed
count(gender) where colors is "red" and comment is not null
count(all) where satisfaction in [4, 5]
count(gender) where comment contains("great", "love", "excellent")
```

## 9. Variables

```
let <name> = <number | string | true | false>
let <name> = <pipeline>
```

| Bound value               | Comes from                                                | How to use it                                                                                  |
| ------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| number / string / boolean | a literal, or a scalar-producing call like`avg(income)` | in expressions, as`sample(n)`, `show(n)`, `draw hist(q, n)`; alone on a line to print it |
| dataset                   | a pipeline ending in`filter` or `load`                | as the first command:`adults \| avg(income)`, `adults \| draw pie(gender)`                   |
| table / rows / chart      | `count(gender)`, `sample(5)`, `draw bar(gender)`    | alone to print, or`x \| save file`                                                            |

Rules:

- Names follow the identifier rules; reserved words, `let` and `draw` are not allowed.
- Variables persist for the rest of the script, the REPL session, or the web interpreter instance.
- Rebinding replaces the old value.
- A variable can only start a pipeline and takes no arguments; `n 5` is an error. `draw c` works only when `c` holds a chart.
- In argument position a variable wins over a question with the same name; write the question in backticks to reach it.
- `let x = load a.json b.json` binds a second dataset and leaves the default one alone.

```
let cutoff = 30
let seniors = filter age >= 60
let seniorIncome = avg(income) where age >= 60
let chart = draw pie(gender)

filter age > cutoff | count(all)
seniors | count(colors)
seniorIncome
draw chart
chart | save charts/gender.json
```

## 10. Result values

Every line produces one value (or an error):

| Kind        | Fields                                                                                                                                                                    | Printed as                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `scalar`  | `label`, `value`                                                                                                                                                      | `avg(age) = 36.6`                         |
| `table`   | `label`, `columns`, `rows`                                                                                                                                          | an aligned table                            |
| `rows`    | `columns`, `rows`, `total`                                                                                                                                          | a table of responses plus`(5 of 20 rows)` |
| `chart`   | `chartType`, `question`, `title`, `spec` (`mode`, `against`, `layout`, `data.labels`, `data.series[].{label, values, type, axis}`, `stats`, `apex`) | its spec (CLI) or a rendered chart (web)    |
| `dataset` | `dataset`                                                                                                                                                               | `dataset: 13 rows, 8 questions`           |
| `message` | `text`, optional `saved`                                                                                                                                              | the text                                    |

Numbers are rounded to 4 decimals for display.

## 11. Errors

Errors carry the line (and usually the column). A failing line does not stop the script; the remaining lines still run and the CLI exits with code 1 at the end. Typical messages:

```
line 3: avg: 'gender' is a category question, not numeric; use 'count(gender)'
line 4: unknown question 'agee'; did you mean 'age'?
line 5: 'colors' has no choice 'purple'; choices: red, green, blue, yellow
line 6: unknown command 'averge'
line 7: 'draw avg' is not valid: avg is not a chart; write 'avg(…)' without draw
line 8: hist: 'gender' is a category question, not numeric; try 'draw bar(gender)'
line 9: no data loaded; run 'load <survey> <responses>' first
line 10: between(...) takes exactly two values, e.g. between(25, 40)
line 11: invalid regular expression '(': Unterminated group
line 12: 'with' needs 'against', e.g. draw bar(a) with line(b) against school_name
line 13: 'against' is for charts; use 'by' here, e.g. avg(x) by gender
line 14: cannot load 'https://x.test/data': request to … failed with HTTP 404
```

## 12. Grammar summary

A script is a sequence of statements, one per line (continuation rules in §1). Square brackets mark optional parts; `…` means the previous item may repeat.

**Statements**

| Form | Example |
|---|---|
| `let NAME = literal` | `let cutoff = 30` |
| `let NAME = pipeline` | `let adults = filter age >= 18` |
| `pipeline` | `filter age > 30 \| avg(income)` |

A pipeline is one or more commands joined with `\|`; each command receives what the previous one produced.

**Commands**

| Command | Form | Example |
|---|---|---|
| load | `load <survey> [<responses>]` | `load survey.json responses.json` |
| save / export | `save <path>` | `draw pie(gender) \| save pie.json` |
| filter | `filter expr` | `filter age > 30 and subscribed` |
| use | `use NAME` | `use schools` |
| union | `union(ref, ref, …) [merge ref as NAME, …]` | `union(baseline, endline) merge age as number` |
| join | `join([left,] right [, inner \| many \| loose \| labels …]) on ref [= ref]` | `join(inventory, inner) on school_name = school` |
| rename | `rename ref as NAME [, ref as NAME …]` | `rename Q5 as age, Q7 as region` |
| value call | `NAME(arg, …) [where expr] [by ref]` | `avg(income) where age > 30 by gender` |
| get | `get arg, arg, … [where expr] [by ref]` | `get avg(income), count(all) by gender` |
| draw | `draw chart [with chart, …] [against ref] [where expr]` | `draw bar(a) with line(b, right) against school_name` |
| print / echo | `print` | `adults \| print` |
| variable | `NAME` | `adults` |

`with` must directly follow the chart call; the other clauses (`where`, `by`, `against`, `on`, `merge`) may come in any order but each at most once.

**Pieces**

| Piece | Form | Example |
|---|---|---|
| chart | `NAME(arg, … [, right])` | `line(staff, right)` |
| arg | a ref, number, string, `all`, or a nested call `NAME(arg, …)` (one level deep) | `income`, `5`, `"x"`, `all`, `avg(income)` |
| ref | a name or `` `quoted name` ``, followed by any number of `.part` segments where part is a name, quoted name or number | `age`, `colors.red`, `` `Q 1`.row1.col1 `` |
| literal | number, string, `true` or `false` | `30`, `"female"`, `true` |
| expr | see §8 | `age between(25, 40)` |

The parser also accepts the older space-separated form (`avg age`, `pie gender`) so existing scripts keep running; new scripts should use the call form shown throughout this document.
