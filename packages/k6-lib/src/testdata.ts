import { RUNNER_TEST_DATA_DIR, TEST_DATA_KEY, type RunnerConfig } from "@btb/contracts";

/*
 * Test-data identities (PRD E2.6). The worker only names the Kubernetes Secret; it is mounted read-only into the
 * runner pods and read here, so credentials never pass through the platform, the run plan or a log line.
 */

export const TEST_DATA_FILE = `${RUNNER_TEST_DATA_DIR}/${TEST_DATA_KEY}`;

/** The Secret's identities.json: a non-empty JSON array. Returns the problem instead of throwing. */
export function parseIdentities(text: string | null): { identities: unknown[] } | { problem: string } {
  if (text === null) return { problem: "isn't mounted" };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { problem: `${TEST_DATA_KEY} isn't valid JSON` };
  }
  if (!Array.isArray(v) || !v.length) return { problem: `${TEST_DATA_KEY} isn't a non-empty JSON array` };
  return { identities: v };
}

const fraction = (s: string) => {
  const [n, d] = s.split("/");
  return d === undefined ? Number(n) : Number(n) / Number(d);
};

/**
 * This runner's share, so no two runner pods use the same identity: k6-operator gives each pod an execution
 * segment like "1/3:2/3". No segment (one runner) = everything.
 */
export function segmentSlice<T>(all: T[], segment: string | undefined): T[] {
  if (!segment) return all;
  const [a, b] = segment.split(":").map(fraction);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b > 1 || a >= b) return all;
  return all.slice(Math.round(all.length * a), Math.round(all.length * b));
}

/** Init context: read the mounted file (k6 `open` only works there). Null when the run has no pool. */
export function loadTestData(c: RunnerConfig): { identities: unknown[] } | { problem: string } | null {
  if (!c.testData) return null;
  let text: string | null;
  try {
    text = open(TEST_DATA_FILE);
  } catch {
    text = null;
  }
  const r = parseIdentities(text);
  return "problem" in r ? { problem: `test-data Secret ${c.testData.secret}: ${r.problem}` } : r;
}
