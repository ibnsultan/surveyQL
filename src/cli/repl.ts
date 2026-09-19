import { createInterface } from "node:readline";
import { isIncomplete } from "../lang/lexer";
import type { Interpreter } from "../interpreter/interpreter";
import { formatResult } from "./format";

const HELP = `Values:
  load <survey> [<responses>]        load a survey definition and responses (paths or URLs)
  questions()                        list questions
  show([n]) / sample(n)              preview rows
  count(all | q) [where ..] [by q]       row count, or frequency table for a question
  avg|sum|min|max|median(q[, dp])    aggregates; 'where <expr>', 'by <q>'; dp = decimal places
  describe([q])                      summary statistics
  get a, b, ... [by q]               several measures in one table, e.g. get avg(income), count(all) by gender
  filter <expr> | <command>          narrow the data for the rest of the pipeline
Charts:
  draw bar|vbar|pie|doughnut(q)      choice, boolean, rating, matrix questions
  draw hist(q[, bins]) / gauge(q)    numeric questions
  draw bar(a, b) against key         series per key value; sum(q), avg(q), count(all) as series
  draw bar(a) with line(b, right) against key   combined chart, 'right' = second axis
Other:
  <value> | save <path>              write a chart spec, table or rows to a file
  let x = <value or pipeline>        bind a variable; then 'x | avg(q)' or use it in expressions
  use x / sources()                  switch the default dataset / list loaded datasets
  union(a, b) [merge q as kind]      stack rounds of one survey (adds 'source'); join(b) on key; rename q as name
  a line ending in ( , | or \\        continues on the next line (prompt '...'); empty line submits
  where: x is v | is not v | is(v1, v2, strict|regex) | contains(v, ..) | between(a, b) | < <= > >= == != | and or not
REPL:
  :help  :questions  :vars  :quit`;

export async function startRepl(interp: Interpreter, out: NodeJS.WritableStream = process.stdout): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: out, prompt: "svql> " });
  out.write("surveyql REPL. Type :help for commands, :quit to exit.\n");
  if (interp.dataset) out.write(`Loaded ${interp.dataset.rows.length} responses, ${interp.dataset.questions.length} questions\n`);
  rl.prompt();

  let lineNo = 0;
  let pending: string[] = []; // lines of a statement that is not complete yet
  for await (const raw of rl) {
    lineNo++;
    if (pending.length) {
      // Keep reading while a parenthesis is open or the last line ends with | , or \
      pending.push(raw);
      const joined = pending.join("\n");
      if (raw.trim() !== "" && isIncomplete(joined)) {
        rl.setPrompt("  ... ");
        rl.prompt();
        continue;
      }
      pending = [];
      rl.setPrompt("svql> ");
      const text = formatResult(await interp.runLine(joined.replace(/\\\s*(\n|$)/g, " "), lineNo - (joined.split("\n").length - 1)));
      if (text) out.write(text + "\n");
      rl.prompt();
      continue;
    }
    const line = raw.trim();
    if (line === "") {
      rl.prompt();
      continue;
    }
    if (!line.startsWith(":") && isIncomplete(line)) {
      pending.push(raw);
      rl.setPrompt("  ... ");
      rl.prompt();
      continue;
    }
    if (line === ":quit" || line === ":q" || line === ":exit") break;
    if (line === ":help" || line === ":h") {
      out.write(HELP + "\n");
    } else if (line === ":questions") {
      out.write(formatResult(await interp.runLine("questions()", lineNo)) + "\n");
    } else if (line === ":vars") {
      const names = [...interp.env.vars.keys()];
      out.write((names.length ? names.join(", ") : "(no variables)") + "\n");
    } else {
      const text = formatResult(await interp.runLine(line, lineNo));
      if (text) out.write(text + "\n");
    }
    rl.prompt();
  }
  rl.close();
}
