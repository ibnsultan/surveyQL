import { defineConfig } from "tsup";

const external = ["survey-core", "survey-analytics", "apexcharts", /^survey-analytics\//];

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      "surveycore/index": "src/surveycore/index.ts",
      "visualization/index": "src/visualization/index.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    external,
    outDir: "dist",
  },
  {
    entry: { "web/index": "src/web/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    external,
    outDir: "dist",
    platform: "browser",
  },
  {
    entry: { "cli/main": "src/cli/main.ts" },
    format: ["esm"],
    sourcemap: true,
    external,
    outDir: "dist",
    platform: "node",
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    entry: { "cli/index": "src/cli/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    external,
    outDir: "dist",
    platform: "node",
  },
]);
