/*
 * Bundles the journeys for the runner image and writes the catalog the platform syncs from it.
 *   dist/main.js       k6 script (k6 modules stay external)
 *   dist/catalog.json  RunnerCatalog; image tag = package version + hash of bundle and Dockerfile, so a change never reuses a tag
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { RUNNER_PROTOCOL, type RunnerCatalog } from "@btb/contracts";
import { build } from "esbuild";

import { JOURNEY_CATALOG } from "./src/catalog";

const IMAGE_NAME = "btb-runner";

const result = await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["k6", "k6/*"],
  write: false,
  logLevel: "warning",
});
const bundle = result.outputFiles[0].contents;

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const hash = createHash("sha256").update(bundle).update(readFileSync("Dockerfile")).digest("hex").slice(0, 10);
const catalog: RunnerCatalog = {
  image: { name: IMAGE_NAME, tag: `${version}-${hash}`, protocol: RUNNER_PROTOCOL },
  builtAt: new Date().toISOString(),
  journeys: JOURNEY_CATALOG,
};

mkdirSync("dist", { recursive: true });
writeFileSync("dist/main.js", bundle);
writeFileSync("dist/catalog.json", `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`built ${IMAGE_NAME}:${catalog.image.tag} (${JOURNEY_CATALOG.map((j) => j.id).join(", ")})`);
