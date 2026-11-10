"use client";

import { useState } from "react";
import { Download, Pencil, Play, Plus, Save, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/arbiter/status-pill";
import { Demo, GallerySection } from "./section";

export function ActionsSection() {
  const [saving, setSaving] = useState(false);
  function fakeSave() {
    setSaving(true);
    setTimeout(() => setSaving(false), 1500);
  }
  return (
    <GallerySection id="actions" title="Buttons and badges" description="Primary is black, never blue. Every button has a leading icon and one-line, verb-first text. Async actions show a spinner.">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Demo label="Variants">
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={<Play />}>Start run</Button>
            <Button variant="secondary" icon={<Pencil />}>Edit plan</Button>
            <Button variant="outline" icon={<Download />}>Download report</Button>
            <Button variant="ghost" icon={<Plus />}>Add target</Button>
            <Button variant="danger" icon={<Trash2 />}>Delete target</Button>
            <Button variant="link">Open in Grafana</Button>
          </div>
        </Demo>
        <Demo label="States">
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={<Save />} loading={saving} onClick={fakeSave}>{saving ? "Saving" : "Save changes"}</Button>
            <Button icon={<Play />} disabled>Start run</Button>
            <Button size="icon" variant="outline" icon={<Pencil />} aria-label="Edit" />
          </div>
        </Demo>
        <Demo label="Sizes · sm 32 · md 36 · lg 44">
          <div className="flex flex-wrap items-end gap-2">
            <Button size="sm" icon={<Plus />}>Create run</Button>
            <Button size="md" icon={<Plus />}>Create run</Button>
            <Button size="lg" icon={<Plus />}>Create run</Button>
          </div>
        </Demo>
        <Demo label="Badges · tone carries a word">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Neutral</Badge>
            <Badge tone="success" dot>Pass</Badge>
            <Badge tone="warning" dot>Queued</Badge>
            <Badge tone="danger" dot>Fail</Badge>
            <Badge tone="info" dot pulse>Running</Badge>
            <StatusPill active />
            <StatusPill active={false} />
          </div>
        </Demo>
      </div>
    </GallerySection>
  );
}
