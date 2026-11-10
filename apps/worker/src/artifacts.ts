import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { runArtifacts } from "@btb/core/db";
import { artifactKey, objectStore } from "@btb/core/env";
import type { Executor } from "@btb/core/executor";

import type { Ctx } from "./context";
import { errorMessage, log } from "./log";
import { splitRunnerLog } from "./plan";

/*
 * Artifacts (E5.7): before the runners are deleted, each runner's k6 summary JSON and log tail go to the
 * bucket, keyed in run_artifacts. Best effort: a run never fails because of its artifacts.
 */

const LOG_LINES = 2000;

export class ArtifactStore {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(cfg = objectStore()) {
    this.bucket = cfg.bucket;
    this.s3 = new S3Client({ region: cfg.region, endpoint: cfg.endpoint, credentials: cfg.credentials, forcePathStyle: Boolean(cfg.endpoint) });
  }

  async put(key: string, body: string, contentType: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
}

interface File {
  name: string;
  label: string;
  body: string;
  contentType: string;
}

export async function collectArtifacts(executor: Executor, ctx: Ctx, runId: string, scope: string) {
  try {
    const pods = (await executor.runners(scope, runId)).sort((a, b) => a.name.localeCompare(b.name));
    const files: File[] = [];
    for (const [i, pod] of pods.entries()) {
      const n = i + 1;
      const { summary, log: text } = splitRunnerLog(await executor.logTail(scope, pod.name, LOG_LINES));
      if (summary) files.push({ name: `k6-summary-${n}.json`, label: `k6 summary, runner ${n}`, body: summary, contentType: "application/json" });
      if (text.trim()) files.push({ name: `runner-${n}.log`, label: `Runner ${n} log (last ${LOG_LINES} lines)`, body: text, contentType: "text/plain; charset=utf-8" });
    }
    for (const f of files) {
      const key = artifactKey(runId, f.name);
      await ctx.artifacts.put(key, f.body, f.contentType);
      await ctx.db
        .insert(runArtifacts)
        .values({ runId, name: f.name, label: f.label, s3Key: key, contentType: f.contentType, sizeBytes: Buffer.byteLength(f.body) })
        .onConflictDoNothing();
    }
    if (files.length) log.info("artifacts stored", { runId, files: files.map((f) => f.name) });
  } catch (e) {
    log.warn("artifacts failed", { runId, reason: errorMessage(e) });
  }
}
