import { canonicalJson } from "@btb/contracts";
import { createHash } from "node:crypto";

/*
 * Manifest hashing (E3.2). Approvals bind to the hash; the worker and the runner pod recompute it from the
 * stored manifest. The canonical form lives in contracts so the runner (k6) hashes exactly the same text.
 */

export { canonicalJson };

export function hashManifest(manifest: unknown): string {
  return createHash("sha256").update(canonicalJson(manifest)).digest("hex");
}
