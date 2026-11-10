/*
 * Bundles the worker into one file for the container image (Dockerfile): dist/main.mjs, run with plain node.
 * Workspace packages ship TypeScript source, so the image would otherwise need tsx and the whole workspace.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.mjs",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
  // CommonJS dependencies (pg, ioredis) call require(); give the ESM bundle one.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  // Optional native binding pg tries to load; not used.
  external: ["pg-native"],
  logLevel: "warning",
});
console.log("built dist/main.mjs");
