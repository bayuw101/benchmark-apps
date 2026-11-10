"use client";

import * as React from "react";
import { Copy, Eye, Info, Pencil, Plus, Save, SquarePen, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/arbiter/confirm-dialog";
import { Modal } from "@/components/arbiter/modal";
import { RightPullSheet, SheetCancel } from "@/components/arbiter/right-pull-sheet";
import { RowActions } from "@/components/arbiter/row-actions";
import { Tabs } from "@/components/arbiter/tabs";
import { Toast, notify } from "@/components/arbiter/toast";

function Demo({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-3 rounded-lg border border-border bg-card p-5">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

export function OverlaysSection() {
  const [modal, setModal] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [contained, setContained] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [sheet, setSheet] = React.useState(false);
  const [tab, setTab] = React.useState("all");

  function fakeDelete() {
    setDeleting(true);
    setTimeout(() => {
      setDeleting(false);
      setConfirm(false);
      setContained(false);
      notify.success("Run deleted", "BTB-RUN-0418 was removed.");
    }, 1200);
  }

  return (
    <section id="overlays" className="grid scroll-mt-20 grid-cols-1 gap-4">
      <div>
        <div className="text-sm font-semibold">Overlays and menus</div>
        <p className="text-xs text-muted-foreground">
          Modal, ConfirmDialog, RightPullSheet (no backdrop), RowActions, Tabs, Toast and tooltip.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Demo title="Modal">
          <div>
            <Button icon={<SquarePen />} onClick={() => setModal(true)}>Open modal</Button>
          </div>
          <Modal
            open={modal}
            onClose={() => setModal(false)}
            title="Rename scenario"
            description="The new name shows on every run that uses it."
            footer={
              <>
                <Button variant="outline" icon={<X />} onClick={() => setModal(false)}>Cancel</Button>
                <Button icon={<Save />} onClick={() => { setModal(false); notify.success("Scenario renamed"); }}>Save changes</Button>
              </>
            }
          >
            <p className="text-sm text-muted-foreground">Modal body content goes here.</p>
          </Modal>
        </Demo>

        <Demo title="ConfirmDialog (viewport)">
          <div>
            <Button variant="danger" icon={<Trash2 />} onClick={() => setConfirm(true)}>Delete run</Button>
          </div>
          <ConfirmDialog
            open={confirm}
            destructive
            title="Delete this run?"
            description="The run, its artifacts and its report are removed. This cannot be undone."
            confirmLabel="Delete run"
            loading={deleting}
            onConfirm={fakeDelete}
            onCancel={() => setConfirm(false)}
          />
        </Demo>

        <Demo title="ConfirmDialog (contained: covers its card)">
          <div className="relative h-64 rounded-xl border border-border bg-background p-4">
            <Button variant="outline" icon={<Trash2 />} onClick={() => setContained(true)}>Delete inside card</Button>
            <ConfirmDialog
              open={contained}
              contained
              destructive
              title="Delete this target?"
              description="Runs that used it keep their history."
              confirmLabel="Delete target"
              loading={deleting}
              onConfirm={fakeDelete}
              onCancel={() => setContained(false)}
            />
          </div>
        </Demo>

        <Demo title="RightPullSheet (no backdrop)">
          <div>
            <Button icon={<Plus />} onClick={() => setSheet(true)}>Add target</Button>
          </div>
          <RightPullSheet
            open={sheet}
            onClose={() => setSheet(false)}
            title="Add target"
            subtitle="Hosts the platform is allowed to load-test."
            footer={
              <>
                <SheetCancel />
                <Button icon={<Save />} onClick={() => { setSheet(false); notify.success("Target added"); }}>Save target</Button>
              </>
            }
          >
            <p className="text-sm text-muted-foreground">Form fields go here.</p>
          </RightPullSheet>
        </Demo>

        <Demo title="RowActions">
          <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
            <div>
              <div className="text-sm font-medium">Checkout journey, peak preset</div>
              <div className="font-mono text-xs text-muted-foreground">BTB-RUN-0418</div>
            </div>
            <RowActions
              actions={[
                { label: "View run", icon: <Eye /> },
                { label: "Edit run", icon: <Pencil /> },
                { label: "Duplicate", icon: <Copy /> },
                { label: "Delete run", icon: <Trash2 />, destructive: true, onSelect: () => setConfirm(true) },
              ]}
            />
          </div>
        </Demo>

        <Demo title="Tooltip">
          <div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" aria-label="What is p95?" icon={<Info />} />
              </TooltipTrigger>
              <TooltipContent>95% of requests were faster than this</TooltipContent>
            </Tooltip>
          </div>
        </Demo>
      </div>

      <Demo title="Tabs with counts">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "all", label: "All runs", count: 128, content: <p className="text-sm text-muted-foreground">All runs.</p> },
            { value: "active", label: "Active", count: 2, content: <p className="text-sm text-muted-foreground">Running now.</p> },
            { value: "pending", label: "Pending approval", count: 5, content: <p className="text-sm text-muted-foreground">Waiting for an approver.</p> },
            { value: "failed", label: "Failed", content: <p className="text-sm text-muted-foreground">Failed or aborted.</p> },
          ]}
        />
      </Demo>

      <Demo title="Toast (static) and notify()">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Toast tone="success" title="Run approved" description="BTB-RUN-0418 can start now." onClose={() => {}} />
          <Toast tone="error" title="Preflight failed" description="Target health check returned 503." onClose={() => {}} />
          <Toast tone="warning" title="Approval expires soon" description="Start within 30 minutes or re-approve." />
          <Toast tone="info" title="Run queued" description="Position 2, behind BTB-RUN-0417." />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => notify.success("Run approved", "BTB-RUN-0418 can start now.")}>Success</Button>
          <Button variant="outline" size="sm" onClick={() => notify.error("Preflight failed", "Target health check returned 503.")}>Error</Button>
          <Button variant="outline" size="sm" onClick={() => notify.warning("Approval expires soon")}>Warning</Button>
          <Button variant="outline" size="sm" onClick={() => notify.info("Run queued", "Position 2.")}>Info</Button>
        </div>
      </Demo>
    </section>
  );
}
