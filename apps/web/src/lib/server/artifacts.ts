import "server-only";

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { objectStore } from "@btb/core/env";

const URL_TTL_SEC = 300;

const g = globalThis as typeof globalThis & { __btbS3?: S3Client };
// Read on first use, not at import: `next build` imports route modules without the runtime env.
let store: ReturnType<typeof objectStore> | undefined;
const cfg = () => (store ??= objectStore());

function client() {
  const c = cfg();
  return (g.__btbS3 ??= new S3Client({
    region: c.region,
    endpoint: c.endpoint,
    credentials: c.credentials,
    forcePathStyle: Boolean(c.endpoint),
  }));
}

/** Short-lived download URL for one artifact object (E5.7). */
export function presignedArtifactUrl(key: string, fileName: string) {
  const command = new GetObjectCommand({
    Bucket: cfg().bucket,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${fileName.replace(/[^\w.-]/g, "_")}"`,
  });
  return getSignedUrl(client(), command, { expiresIn: URL_TTL_SEC });
}

/** The object itself, for in-page preview through our own origin (no bucket CORS, session-checked). */
export async function getArtifact(key: string) {
  const res = await client().send(new GetObjectCommand({ Bucket: cfg().bucket, Key: key }));
  return res.Body?.transformToWebStream() ?? null;
}

export async function putArtifact(key: string, body: Uint8Array, contentType: string) {
  await client().send(new PutObjectCommand({ Bucket: cfg().bucket, Key: key, Body: body, ContentType: contentType }));
}
