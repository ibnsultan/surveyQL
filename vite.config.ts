import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: "playground",
  publicDir: "../fixtures",
  resolve: {
    alias: {
      "surveyql/web": `${root}src/web/index.ts`,
      "surveyql": `${root}src/index.ts`,
    },
  },
  build: {
    outDir: "../dist-web",
    emptyOutDir: true,
  },
  server: { open: true },
});
