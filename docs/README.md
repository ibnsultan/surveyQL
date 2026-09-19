# SurveyQL documentation

| Document | Read it when you want to… |
|---|---|
| [Getting started](getting-started.md) | install, run the first script, open the playground |
| [Language reference](language.md) | know every command, clause, operator and value type |
| [Cookbook](cookbook.md) | copy a recipe: cross-tabs, segments, saving charts, variables |
| [CLI](cli.md) | use `run`, `eval` and `repl`, flags, output formats, exit codes |
| [Web integration](web.md) | embed the interpreter in a page or app and render results |
| [Architecture](architecture.md) | change the code: modules, pipeline, adding a command |

Quick taste:

```
load fixtures/survey.json fixtures/responses.json
avg(age)
count(satisfaction)
sum(income) where gender is "female"
filter age > 30 | avg(income)
draw bar(satisfaction)
```
