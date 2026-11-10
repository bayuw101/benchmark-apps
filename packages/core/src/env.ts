/** Local Compose stack (infra/local). Dev-only credentials; real environments always set the variables. */
export const DEV_DATABASE_URL = "postgresql://btb:btb-dev-only@127.0.0.1:15432/btb";
export const DEV_REDIS_URL = "redis://127.0.0.1:16379";

function fromEnv(name: string, devDefault: string) {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error(`${name} is not set`);
  return devDefault;
}

export const databaseUrl = () => fromEnv("DATABASE_URL", DEV_DATABASE_URL);
export const redisUrl = () => fromEnv("REDIS_URL", DEV_REDIS_URL);
/** Shared by the worker (signs runner lease tokens) and the web app (checks them). */
export const leaseSecret = () => fromEnv("LEASE_SECRET", "btb-dev-only-lease-secret");

/**
 * Artifact bucket (E5.7). Locally MinIO from infra/local; on AWS leave S3_ENDPOINT and the keys unset so the
 * SDK uses the pod's IAM role.
 */
export function objectStore() {
  const dev = process.env.NODE_ENV !== "production";
  const keyId = process.env.S3_ACCESS_KEY_ID ?? (dev ? "btb" : undefined);
  const secret = process.env.S3_SECRET_ACCESS_KEY ?? (dev ? "btb-dev-only" : undefined);
  return {
    bucket: fromEnv("S3_BUCKET", "btb-artifacts"),
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT ?? (dev ? "http://127.0.0.1:19000" : undefined),
    credentials: keyId && secret ? { accessKeyId: keyId, secretAccessKey: secret } : undefined,
  };
}

export const artifactKey = (runId: string, name: string) => `runs/${runId}/${name}`;

/** Commit the image was built from (`--build-arg BTB_VERSION`, see the Dockerfiles); "dev" when run from source. */
export const buildVersion = () => process.env.BTB_VERSION || "dev";
