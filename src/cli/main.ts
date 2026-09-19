import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createInterpreter } from "../index";
import type { RunResult } from "../interpreter/interpreter";
import { toJsonValue } from "../interpreter/values";
import { loadDataset } from "../surveycore/loader";
import { formatResult } from "./format";
import { NodeIO } from "./io";
import { startRepl } from "./repl";

const USAGE = `surveyql - a tiny language for SurveyJS data

Usage:
  surveyql run <script.svql> [options]
  surveyql eval "<line>[; <line>...]" [options]
  surveyql repl [options]

Options:
  --survey <path|url>   survey definition JSON (skips the need for 'load')
  --data <path|url>     responses JSON
  --out <dir>           write chart specs to <dir>/NN-<type>-<question>.json
  --json                print each result as one JSON line
  --seed <n>            seed for 'sample'
  --color / --no-color  force ANSI colours in terminal charts on or off (default: detect; NO_COLOR honoured)
  -h, --help            show this help
`;

interface CliOptions {
  survey?: string;
  data?: string;
  out?: string;
  json: boolean;
  seed?: number;
  color?: boolean;
}

function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]+/g, "_");
}

async function printResults(results: RunResult[], io: NodeIO, opts: CliOptions): Promise<boolean> {
  let failed = false;
  let chartIndex = 0;
  for (const r of results) {
    if (r.error) failed = true;
    let chartPath: string | undefined;
    if (r.value?.kind === "chart" && opts.out) {
      chartIndex++;
      chartPath = join(opts.out, `${String(chartIndex).padStart(2, "0")}-${r.value.chartType}-${slug(r.value.question)}.json`);
      await io.writeText(chartPath, JSON.stringify(r.value.spec, null, 2));
    }
    if (opts.json) {
      const line = {
        line: r.line,
        source: r.source,
        value: r.value ? toJsonValue(r.value) : undefined,
        error: r.error ? { message: r.error.message, line: r.error.line, col: r.error.col } : undefined,
        chartPath,
      };
      process.stdout.write(JSON.stringify(line) + "\n");
      continue;
    }
    const text = formatResult(r, { chartPath, color: opts.color });
    if (!text) continue;
    if (r.error) process.stderr.write(text + "\n");
    else process.stdout.write(text + "\n");
  }
  return failed;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        survey: { type: "string" },
        data: { type: "string" },
        out: { type: "string" },
        json: { type: "boolean", default: false },
        seed: { type: "string" },
        color: { type: "boolean" },
        "no-color": { type: "boolean" },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const [command, target] = positionals;
  if (values.help || !command) {
    process.stdout.write(USAGE);
    return values.help ? 0 : 2;
  }

  const opts: CliOptions = {
    survey: values.survey,
    data: values.data,
    out: values.out,
    json: values.json ?? false,
    seed: values.seed !== undefined ? Number(values.seed) : undefined,
    color: values["no-color"] ? false : values.color ? true : undefined,
  };

  const io = new NodeIO();
  const interp = createInterpreter(io, { seed: opts.seed });

  if (opts.survey) {
    try {
      interp.dataset = await loadDataset(io, opts.survey, opts.data);
    } catch (e) {
      process.stderr.write(`error: ${(e as Error).message}\n`);
      return 1;
    }
  } else if (opts.data) {
    process.stderr.write("error: --data requires --survey\n");
    return 2;
  }

  switch (command) {
    case "run": {
      if (!target) {
        process.stderr.write("error: run needs a script path\n");
        return 2;
      }
      let source: string;
      try {
        source = await readFile(target, "utf8");
      } catch (e) {
        process.stderr.write(`error: cannot read ${target}: ${(e as Error).message}\n`);
        return 1;
      }
      const results = await interp.run(source);
      return (await printResults(results, io, opts)) ? 1 : 0;
    }
    case "eval": {
      if (!target) {
        process.stderr.write('error: eval needs a line, e.g. eval "avg age"\n');
        return 2;
      }
      const source = target.split(";").map((s) => s.trim()).filter(Boolean).join("\n");
      const results = await interp.run(source);
      return (await printResults(results, io, opts)) ? 1 : 0;
    }
    case "repl":
      await startRepl(interp);
      return 0;
    default:
      process.stderr.write(`error: unknown command '${command}'\n\n${USAGE}`);
      return 2;
  }
}

const isDirect = typeof process !== "undefined" && process.argv[1] && /main\.(js|ts|cjs|mjs)$/.test(process.argv[1]);
if (isDirect) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`fatal: ${(e as Error).stack ?? e}\n`);
      process.exit(1);
    },
  );
}
