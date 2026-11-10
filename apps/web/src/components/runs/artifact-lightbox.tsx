"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  Check, ChevronLeft, ChevronRight, Copy, Download, FileJson, FileQuestion, FileText, ImageOff, Maximize, Minus, Plus, WrapText, X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { RunArtifact } from "@/lib/runs/types";
import { Spinner } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";

/*
 * The full-screen artifact viewer: one frame for every file type, so the title, Download and Close sit in the same
 * place whether it's a screenshot, JSON or a log. ←/→ and the strip step through every previewable file of the run.
 * The frame is always dark (like any media viewer), so it uses fixed neutral colours rather than theme tokens.
 */

export type ArtifactKind = "image" | "json" | "text" | "none";
export const kindOf = (contentType: string): ArtifactKind =>
  contentType.startsWith("image/") ? "image" : contentType.includes("json") ? "json" : contentType.startsWith("text/") ? "text" : "none";

/** Text bigger than this isn't rendered (a <pre> of many MB freezes the tab); download it instead. */
const TEXT_PREVIEW_MAX_BYTES = 2_000_000;
/** Above this, JSON is shown without colours: one span per token gets slow. */
const HIGHLIGHT_MAX_BYTES = 300_000;

const MIN = 1;
const MAX = 8;
const STEP = 1.25;
type View = { scale: number; x: number; y: number };
const FIT: View = { scale: 1, x: 0, y: 0 };

function ToolButton({ label, onClick, disabled, active, children, className }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <Hint label={label} className="bg-white text-neutral-900" arrowClassName="fill-white">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "inline-flex size-9 items-center justify-center rounded-md text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-4",
          active && "bg-white/15 text-white",
          className,
        )}
      >
        {children}
      </button>
    </Hint>
  );
}

const Group = ({ children }: { children: React.ReactNode }) => <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">{children}</div>;

function Centered({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "error" }) {
  return <div className={cn("absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm", tone === "error" ? "text-red-300" : "text-white/65")}>{children}</div>;
}

const KindIcon = ({ kind, className }: { kind: ArtifactKind; className?: string }) =>
  kind === "json" ? <FileJson className={className} /> : kind === "text" ? <FileText className={className} /> : <FileQuestion className={className} />;

/* ---------- JSON / text ---------- */

const TOKEN = /("(?:\\.|[^\\"])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function highlight(line: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const [all, str, colon, lit, num] = m;
    if (str) {
      out.push(<span key={m.index} className={colon ? "text-sky-300" : "text-emerald-300"}>{str}</span>);
      if (colon) out.push(colon);
    } else if (lit) out.push(<span key={m.index} className="text-violet-300">{lit}</span>);
    else if (num) out.push(<span key={m.index} className="text-amber-300">{num}</span>);
    last = m.index + all.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

function CodeView({ text, json, wrap }: { text: string; json: boolean; wrap: boolean }) {
  const lines = React.useMemo(() => text.replace(/\n$/, "").split("\n"), [text]);
  const colour = json && text.length <= HIGHLIGHT_MAX_BYTES;
  const gutter = `${String(lines.length).length + 1}ch`;
  return (
    <div className="h-full overflow-auto rounded-lg border border-white/10 bg-neutral-900 py-3 font-mono text-xs leading-5 text-white/85">
      <div className={cn(wrap ? "" : "w-max min-w-full")}>
        {lines.map((line, i) => (
          <div key={i} className="flex hover:bg-white/[0.04]">
            <span className="shrink-0 pr-4 pl-3 text-right text-white/30 select-none" style={{ width: `calc(${gutter} + 1.75rem)` }}>
              {i + 1}
            </span>
            <span className={cn("pr-4", wrap ? "min-w-0 break-all whitespace-pre-wrap" : "whitespace-pre")}>{colour ? highlight(line) : line || " "}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

async function loadText(src: string, json: boolean) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(String(res.status));
  const text = await res.text();
  if (!json) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text; // Malformed JSON: show it as it is.
  }
}

/* ---------- the viewer ---------- */

export function ArtifactLightbox({
  items,
  index: start,
  srcOf,
  download,
  onClose,
}: {
  items: RunArtifact[];
  index: number;
  srcOf: (a: RunArtifact) => string;
  download: { busy: boolean; run: (a: RunArtifact) => void };
  onClose: () => void;
}) {
  const [index, setIndex] = React.useState(start);
  const a = items[index];
  const kind = kindOf(a.contentType);
  const isText = kind === "json" || kind === "text";
  const tooBig = isText && a.sizeBytes > TEXT_PREVIEW_MAX_BYTES;

  // Image state
  const [view, setView] = React.useState<View>(FIT);
  const [imgStatus, setImgStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [natural, setNatural] = React.useState<{ w: number; h: number; shown: number }>();
  const stage = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = React.useState(false);

  // Text state
  // Logs have long lines worth reading whole; JSON reads better unwrapped. The toggle is per viewing session.
  const [wrapPref, setWrap] = React.useState<boolean>();
  const wrap = wrapPref ?? kind === "text";
  const [copied, setCopied] = React.useState(false);
  const text = useQuery({
    queryKey: ["artifact", srcOf(a), kind],
    queryFn: () => loadText(srcOf(a), kind === "json"),
    enabled: isText && !tooBig,
    staleTime: Infinity,
  });

  const go = (to: number) => {
    if (to < 0 || to >= items.length || to === index) return;
    setIndex(to);
    setView(FIT);
    setImgStatus("loading");
    setNatural(undefined);
    setCopied(false);
  };

  /** Zoom to `next`, keeping the point at (cx, cy) — relative to the stage centre — under the cursor. */
  const zoomTo = (next: number, cx = 0, cy = 0) =>
    setView((v) => {
      const scale = Math.min(MAX, Math.max(MIN, next));
      if (scale === MIN) return FIT;
      const k = scale / v.scale;
      return { scale, x: cx - k * (cx - v.x), y: cy - k * (cy - v.y) };
    });
  const centreOffset = (clientX: number, clientY: number) => {
    const r = stage.current!.getBoundingClientRect();
    return [clientX - r.left - r.width / 2, clientY - r.top - r.height / 2] as const;
  };
  // Scale at which one image pixel is one screen pixel ("100%").
  const actual = natural ? natural.w / natural.shown : 1;
  const percent = Math.round((view.scale / actual) * 100);
  const imgReady = kind === "image" && imgStatus === "ready";

  async function copy() {
    if (!text.data) return;
    await navigator.clipboard.writeText(text.data);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") go(index + 1);
    else if (e.key === "ArrowLeft") go(index - 1);
    else if (kind === "image" && (e.key === "+" || e.key === "=")) zoomTo(view.scale * STEP);
    else if (kind === "image" && e.key === "-") zoomTo(view.scale / STEP);
    else if (kind === "image" && e.key === "0") setView(FIT);
    else return;
    e.preventDefault();
  }

  const meta = [
    a.name,
    natural ? `${natural.w}×${natural.h}` : null,
    isText && text.data ? `${text.data.replace(/\n$/, "").split("\n").length.toLocaleString("en-US")} lines` : null,
    `${(a.sizeBytes / 1000).toFixed(1)} KB`,
    items.length > 1 ? `${index + 1} of ${items.length}` : null,
  ].filter(Boolean);

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-neutral-950/[0.97] backdrop-blur-md data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // Focus the frame, not the first toolbar button (its focus ring reads as "on"); keys still work.
          onOpenAutoFocus={(e) => (e.preventDefault(), (e.currentTarget as HTMLElement).focus())}
          onKeyDown={onKeyDown}
          className="fixed inset-0 z-50 flex flex-col text-white outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          {/* Top bar: same layout for every file type. */}
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 sm:px-4">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate text-sm font-semibold">{a.label}</DialogPrimitive.Title>
              <p className="truncate font-mono text-micro text-white/55">{meta.join(" · ")}</p>
            </div>
            {kind === "image" ? (
              <div className="max-sm:hidden">
                <Group>
                  <ToolButton label="Zoom out (−)" onClick={() => zoomTo(view.scale / STEP)} disabled={view.scale <= MIN || !imgReady}>
                    <Minus />
                  </ToolButton>
                  <Hint label="Fit to screen (0)" className="bg-white text-neutral-900" arrowClassName="fill-white">
                    <button
                      type="button"
                      onClick={() => setView(FIT)}
                      disabled={!imgReady}
                      className="h-9 min-w-14 rounded-md px-2 font-mono text-xs text-white/75 tabular-nums hover:bg-white/10 hover:text-white disabled:opacity-35"
                    >
                      {imgReady ? `${percent}%` : "—"}
                    </button>
                  </Hint>
                  <ToolButton label="Zoom in (+)" onClick={() => zoomTo(view.scale * STEP)} disabled={view.scale >= MAX || !imgReady}>
                    <Plus />
                  </ToolButton>
                  <ToolButton label="Fit to screen (0)" onClick={() => setView(FIT)} disabled={view.scale === MIN}>
                    <Maximize />
                  </ToolButton>
                </Group>
              </div>
            ) : isText && !tooBig ? (
              <Group>
                <ToolButton label={wrap ? "Don't wrap lines" : "Wrap long lines"} active={wrap} onClick={() => setWrap(!wrap)}>
                  <WrapText />
                </ToolButton>
                <ToolButton label={copied ? "Copied" : "Copy to clipboard"} onClick={copy} disabled={!text.data}>
                  {copied ? <Check className="text-emerald-300" /> : <Copy />}
                </ToolButton>
              </Group>
            ) : null}
            <Group>
              <ToolButton label="Download" onClick={() => download.run(a)} disabled={download.busy}>
                {download.busy ? <Spinner /> : <Download />}
              </ToolButton>
              <DialogPrimitive.Close asChild>
                <ToolButton label="Close (Esc)" onClick={onClose}>
                  <X />
                </ToolButton>
              </DialogPrimitive.Close>
            </Group>
          </div>

          {/* Stage */}
          <div className="relative flex min-h-0 flex-1">
            {kind === "image" ? (
              <div
                ref={stage}
                className={cn(
                  "relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden p-2 select-none sm:p-6",
                  view.scale > MIN ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in",
                )}
                onWheel={(e) => imgReady && zoomTo(view.scale * (e.deltaY < 0 ? STEP : 1 / STEP), ...centreOffset(e.clientX, e.clientY))}
                onDoubleClick={(e) => (view.scale > MIN ? setView(FIT) : zoomTo(Math.max(2, actual), ...centreOffset(e.clientX, e.clientY)))}
                onPointerDown={(e) => {
                  if (view.scale <= MIN) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
                  setDragging(true);
                }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (d) setView((v) => ({ ...v, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
                }}
                onPointerUp={() => ((drag.current = null), setDragging(false))}
                onPointerCancel={() => ((drag.current = null), setDragging(false))}
              >
                {imgStatus === "loading" ? (
                  <Centered>
                    <Spinner /> Loading…
                  </Centered>
                ) : null}
                {imgStatus === "error" ? (
                  <Centered tone="error">
                    <ImageOff className="size-6" />
                    Couldn&apos;t load the image. Try again, or download it.
                  </Centered>
                ) : null}
                {/* eslint-disable-next-line @next/next/no-img-element -- private, session-checked file; next/image would proxy it */}
                <img
                  key={a.name}
                  src={srcOf(a)}
                  alt={a.label}
                  draggable={false}
                  onLoad={(e) => {
                    const el = e.currentTarget;
                    setNatural({ w: el.naturalWidth, h: el.naturalHeight, shown: el.clientWidth || el.naturalWidth });
                    setImgStatus("ready");
                  }}
                  onError={() => setImgStatus("error")}
                  style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
                  className={cn(
                    "max-h-full max-w-full rounded-sm object-contain shadow-2xl ring-1 ring-white/10 will-change-transform",
                    !dragging && "transition-transform duration-150 ease-out",
                    imgStatus === "ready" ? "opacity-100" : "opacity-0",
                  )}
                />
              </div>
            ) : (
              <div className="relative mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col p-2 sm:px-16 sm:py-6">
                {tooBig || kind === "none" ? (
                  <Centered>
                    <KindIcon kind={kind} className="size-7" />
                    {tooBig ? "This file is too large to show here. Download it to open it." : "This file type can't be shown here. Download it to open it."}
                  </Centered>
                ) : text.isPending ? (
                  <Centered>
                    <Spinner /> Loading…
                  </Centered>
                ) : text.isError ? (
                  <Centered tone="error">Couldn&apos;t load the file. Try again, or download it.</Centered>
                ) : (
                  <CodeView text={text.data} json={kind === "json"} wrap={wrap} />
                )}
              </div>
            )}

            {items.length > 1 ? (
              <>
                <ToolButton label="Previous (←)" onClick={() => go(index - 1)} disabled={index === 0} className="absolute top-1/2 left-2 size-11 -translate-y-1/2 rounded-full bg-black/60 max-sm:hidden sm:left-3">
                  <ChevronLeft className="!size-5" />
                </ToolButton>
                <ToolButton label="Next (→)" onClick={() => go(index + 1)} disabled={index === items.length - 1} className="absolute top-1/2 right-2 size-11 -translate-y-1/2 rounded-full bg-black/60 max-sm:hidden sm:right-3">
                  <ChevronRight className="!size-5" />
                </ToolButton>
              </>
            ) : null}
          </div>

          {/* Strip: every previewable file of the run. */}
          {items.length > 1 ? (
            <div className="flex gap-2 overflow-x-auto border-t border-white/10 px-3 py-2.5 sm:justify-center">
              {items.map((t, i) => {
                const k = kindOf(t.contentType);
                return (
                  <Hint key={t.name} label={t.label} side="top" className="bg-white text-neutral-900" arrowClassName="fill-white">
                    <button
                      type="button"
                      aria-label={t.label}
                      aria-current={i === index}
                      onClick={() => go(i)}
                      className={cn(
                        "relative h-12 w-20 shrink-0 overflow-hidden rounded-md border-2 bg-neutral-800 transition-opacity focus-visible:outline-none",
                        i === index ? "border-white opacity-100" : "border-transparent opacity-55 hover:opacity-90",
                      )}
                    >
                      {k === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element -- see above
                        <img src={srcOf(t)} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
                      ) : (
                        <span className="flex size-full flex-col items-center justify-center gap-0.5 px-1 text-white/80">
                          <KindIcon kind={k} className="size-4" />
                          <span className="w-full truncate text-center font-mono text-[9px] leading-none">{t.name}</span>
                        </span>
                      )}
                    </button>
                  </Hint>
                );
              })}
            </div>
          ) : kind === "image" ? (
            <p className="pb-3 text-center text-micro text-white/45 max-sm:hidden">Scroll or double-click to zoom · drag to move · Esc to close</p>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
