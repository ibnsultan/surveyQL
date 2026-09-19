# Cookbook

All recipes use the bundled fixtures (`fixtures/survey.json`, 20 responses). Run any of them with:

```sh
surveyql eval "<line>; <line>" --survey fixtures/survey.json --data fixtures/responses.json
```

## Headline numbers

```
count(all)                     # responses
avg(satisfaction)           # mean rating
median(income)
describe()                  # one row per question: n, missing, summary
```

## Distribution of one question

```
count(gender)               # value, label, count, percent
count(colors)               # multi-select: one row per choice, percent of respondents
count(features)             # matrix: rows × columns counts
freq(age)                   # force a frequency table on a numeric question
```

## Segment, then measure

```
avg(income) where gender is "female"
avg(income, 2)              # two decimal places (default is 4)
filter gender is "female" | avg(income)             # same thing
avg(income) where age between(30, 49)
avg(income) where age < 30 or age > 60              # several conditions
avg(income) where age between(25, 40) and gender is "female"
count(colors) where age >= 30 and age < 50
avg(satisfaction) where colors is "red" and subscribed
sample(5) where comment is not null                 # only respondents who left a comment
count(gender) where satisfaction is(4, 5)           # promoters by gender
count(gender) where comment contains("great", "love", "excellent")
count(gender) where comment contains("^(great|love)", regex)
count(gender) where gender is("Female", strict)     # case-sensitive
```

## Compare groups

```
avg(satisfaction) by gender         # one row per gender: avg, n
count(subscribed) by gender         # cross-tab: gender × yes/no
count(colors) by gender             # cross-tab with a multi-select
count(all) by satisfaction             # responses per rating
avg(income) by colors               # a respondent contributes to every colour they picked
avg(income) where subscribed by gender
```

## Several numbers in one table

```
get avg(income), count(all), median(age) by gender          # like SQL: select ... group by gender
get avg(income), min(income), max(income)                    # one summary row
get income, satisfaction, subscribed by gender               # bare questions: sum / avg / per-choice counts
get avg(satisfaction), count(satisfaction) by gender         # average plus the rating distribution
get age, gender, income where age > 50                       # just those columns of the matching responses
get avg(income), count(all) by gender | save out/summary.csv
```

## Drill into choices and matrix rows

```
count(colors.red)                   # selected / not selected / no answer
avg(age) where colors.red           # people who picked red
count(features.price)               # one matrix row as a category
count(gender) where features.support is "bad"
```

## Reuse a segment

```
let adults = filter age >= 18
let promoters = adults | filter satisfaction >= 4
adults | count(all)
promoters | avg(income)
promoters | draw pie(gender)
```

## Parameterize a script

```
let cutoff = 40
let n = 3
count(all) where age > cutoff
sample(n)
draw hist(income, n)
```

## Charts

```
draw bar(satisfaction)              # horizontal bars
draw vbar(gender)                   # vertical
draw pie(gender)
draw doughnut(subscribed)
draw hist(age, 5)                   # five bins
draw hist(income)                   # automatic bins
draw gauge(satisfaction)            # average on a 1–5 dial
draw bar(features)                  # stacked bars, one series per matrix column
draw pie(gender) where age > 40     # charts accept where
```

Save them:

```
draw pie(gender) | save charts/gender.json
let ages = draw hist(age, 5)
ages | save charts/age.json
```

Or let the CLI number them for you:

```sh
surveyql run report.svql --out charts/
# charts/01-bar-satisfaction.json, charts/02-pie-gender.json, ...
```

## Plot one question against another

The bundled `fixtures/schools.json` has one response per school (one school reports twice):

```
load fixtures/schools.json fixtures/schools-responses.json

draw bar(cpus) against school_name                          # one bar per school
draw bar(monitors, printers, cpus, routers) against school_name
draw bar(monitors) with line(working_computers) against school_name
draw bar(monitors, printers) with line(students, right) against school_name   # students on a 2nd axis

draw bar(monitors, printers)                       # the same, one part per line
     with line(students, right)
     against school_name
draw bar(sum(cpus)) against region                          # totals per region
draw bar(avg(it_rating)) against region                     # average rating per region
draw bar(it_rating, cpus) against region                    # defaults: avg for the rating, sum for cpus
draw bar(has_lab) against region                            # stacked yes/no per region
draw pie(sum(students)) against region
draw line(count(all)) against month                         # responses per month
draw vbar(cpus) against school_name where region is "dodoma"
```

Save one like any other chart:

```
draw bar(monitors) with line(students, right) against school_name | save charts/schools.json
```

## Export tables and rows

```
count(gender) | save out/gender.csv
avg(income) by gender | save out/income-by-gender.csv
filter subscribed | save out/subscribers.json
sample(50) | save out/sample.csv
```

## Load from a server

```
load https://example.test/surveys/42/definition https://example.test/surveys/42/results
count(all)
```

or keep the schema local and fetch only the answers:

```sh
surveyql repl --survey survey.json --data https://example.test/api/results
```

The responses endpoint may return a plain array or `{ "Data": [...] }`.

## Work with two surveys at once

```
load wave1-survey.json wave1.json
let wave2 = load wave2-survey.json wave2.json
avg(satisfaction)
wave2 | avg(satisfaction)
sources()                       # what is loaded, and which is the default
use wave2                       # switch the default
```

## Compare survey rounds (union)

```
let baseline = load survey.json 2025-baseline.json
let endline  = load survey.json 2026-endline.json
let waves = union(baseline, endline)                  # adds a `source` question

waves | count(all) by source
waves | get avg(satisfaction, 1), avg(income, 0), count(all) by source
waves | draw bar(avg(satisfaction)) against source
waves | draw bar(has_lab) against source              # stacked Yes/No, before vs after
waves | count(respondent_id)                          # ids with count 2 answered both rounds

# a question changed kind between rounds: strict by default, opt in explicitly
waves | avg(age)                                      # error: 'age' is number in baseline, text in endline …
waves | avg(baseline.age)
let waves2 = union(baseline, endline) merge age as number
waves2 | avg(age) by source

# same question, different names
let endline2 = endline | rename Q5 as age
let waves3 = union(baseline, endline2)
```

## Enrich one survey with another (join)

```
let schools   = load schools.json schools-responses.json
let inventory = load inventory.json inventory-responses.json
let merged = join(schools, inventory) on school_name
# Joined 10 of 12 schools rows with inventory on school_name. No match for 2: …

merged | get school_name, students, inventory.cpus, tablets, lab_type
merged | draw bar(inventory.cpus, tablets) with line(students, right) against school_name
merged | count(lab_type) by region

schools | join(inventory, loose) on school_name         # case-insensitive keys
schools | join(inventory, inner) on school_name | count(all)   # only schools present in both
schools | join(inventory, many) on school_name          # several inventory rows per school
join(schools, districts) on district = district_name    # different key names
```

## A full report script

```
# report.svql
load fixtures/survey.json fixtures/responses.json

describe()
count(gender)
avg(satisfaction) by gender
count(colors)
avg(income) where age between(25, 40)

let subscribers = filter subscribed
subscribers | avg(income)
subscribers | count(satisfaction)

draw bar(satisfaction)
draw pie(gender)
draw hist(age, 5)
draw bar(features)
count(gender) | save out/gender.csv
```

```sh
surveyql run report.svql --out out/charts --seed 1
```
