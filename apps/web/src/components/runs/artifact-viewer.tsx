"use client";

import * as React from "react";
import { Download } from "lucide-react";

import type { RunArtifact } from "@/lib/runs/types";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/arbiter/toast";
import { ArtifactLightbox, kindOf } from "./artifact-lightbox";

export const artifactHref = (runId: string, name: string) => `/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(name)}`;
export const canPreview = (a: RunArtifact) => kindOf(a.contentType) !== "none";

/** Fetches a presigned URL and saves it, with `busy` for a spinner (a plain link gives no feedback until the browser saves). */
export function useDownload(runId: string) {
  const [busy, setBusy] = React.useState(false);
  async function run(a: Pick<RunArtifact, "name" | "label">) {
    setBusy(true);
    try {
      const res = await fetch(artifactHref(runId, a.name));
      if (!res.ok) throw new Error(String(res.status));
      const { url } = (await res.json()) as { url: string };
      // The URL is presigned with Content-Disposition: attachment, so this downloads without leaving the page.
      Object.assign(document.createElement("a"), { href: url, download: `${runId}-${a.name}` }).click();
    } catch {
      notify.error(`Couldn't download ${a.label.toLowerCase()}`, "The link may have expired. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}

export function DownloadButton({ runId, artifact }: { runId: string; artifact: RunArtifact }) {
  const { busy, run } = useDownload(runId);
  return <Button variant="ghost" size="icon" aria-label={`Download ${artifact.label}`} icon={<Download />} loading={busy} onClick={() => run(artifact)} />;
}

/** UI-05: see an artifact (screenshot, JSON, log) full screen, then choose whether to download it. */
export function ArtifactViewer({ runId, artifacts, artifact, onClose }: { runId: string; artifacts: RunArtifact[]; artifact: RunArtifact; onClose: () => void }) {
  const download = useDownload(runId);
  const items = artifacts.filter(canPreview);
  return (
    <ArtifactLightbox
      items={items}
      index={Math.max(0, items.findIndex((a) => a.name === artifact.name))}
      srcOf={(a) => `${artifactHref(runId, a.name)}?view=1`}
      download={download}
      onClose={onClose}
    />
  );
}
