import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CircleCheck, OctagonX, TriangleAlert, UserX } from "lucide-react";

import { cn } from "@/lib/utils";
import { mockAuthEnabled } from "@/lib/auth/config";
import { DEFAULT_AFTER_LOGIN, safeNext } from "@/lib/auth/constants";
import { DEFAULT_MOCK_ACCOUNT, signInChoices } from "@/lib/auth/mock-accounts";
import { getSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { BrandLockup } from "@/components/arbiter/brand-lockup";
import { SelectField } from "@/components/arbiter/select-field";
import { signIn } from "./actions";
import { SubmitButton } from "./submit-button";

export const metadata: Metadata = { title: "Sign in · Benchmark" };

type Tone = "danger" | "warning" | "success";

const MESSAGES: Record<string, { tone: Tone; title: string; body: string; action?: string }> = {
  sso_failed: {
    tone: "danger",
    title: "Microsoft sign-in didn't complete",
    body: "It may have been cancelled or timed out. Try again; if it keeps failing, contact IT.",
    action: "Try again",
  },
  no_access: {
    tone: "warning",
    title: "Your account has no access yet",
    body: "You signed in with Microsoft, but you don't have a Benchmark role. Ask a Benchmark admin to give you one.",
    action: "Use a different account",
  },
  unavailable: {
    tone: "danger",
    title: "Sign-in isn't set up here",
    body: "This environment has no Microsoft sign-in configured yet. Contact the Benchmark team.",
  },
};

const TONE: Record<Tone, { box: string; Icon: typeof TriangleAlert }> = {
  danger: { box: "border-danger/30 bg-danger-soft text-danger", Icon: OctagonX },
  warning: { box: "border-warning/30 bg-warning-soft text-warning", Icon: UserX },
  success: { box: "border-success/30 bg-success-soft text-success", Icon: CircleCheck },
};

function Callout({ tone, title, body }: { tone: Tone; title: string; body: string }) {
  const { box, Icon } = TONE[tone];
  return (
    <div role={tone === "success" ? "status" : "alert"} className={cn("flex gap-3 rounded-lg border p-3", box)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <p className="mt-0.5 text-xs text-foreground/80">{body}</p>
      </div>
    </div>
  );
}


/** Decorative p95 trace under a dashed threshold: says what the product does without a word. */
function RunPreview() {
  const points = [52, 58, 55, 61, 60, 66, 63, 70, 68, 72, 69, 74, 71, 76, 73, 75];
  const w = 300, h = 96, max = 100;
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => h - (v / max) * h;
  const d = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const threshold = y(80);
  return (
    <div aria-hidden className="w-full max-w-[380px] rounded-xl border border-border bg-card p-5 shadow-xl">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-xs text-muted-foreground">RUN-0421</div>
          <div className="truncate text-sm font-semibold">Checkout · Peak preset</div>
        </div>
        <Badge tone="info" dot pulse>Running</Badge>
      </div>
      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="text-4xl font-semibold tracking-tight tabular-nums">612</span>
        <span className="text-sm text-muted-foreground">ms p95</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-24 w-full overflow-visible" preserveAspectRatio="none">
        <line x1="0" x2={w} y1={threshold} y2={threshold} stroke="var(--danger)" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d={d} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-2 flex justify-between text-label text-muted-foreground">
        <span>Threshold 800 ms</span>
        <span>1,184 RPS · 1,200 VUs</span>
      </div>
    </div>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; signed_out?: string }>;
}) {
  const { error, next: rawNext, signed_out } = await searchParams;
  const next = safeNext(rawNext);
  if (await getSession()) redirect(next);

  const message = error ? (MESSAGES[error] ?? MESSAGES.sso_failed) : null;

  return (
    <main className="grid min-h-dvh bg-background md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <section className="relative flex min-h-dvh flex-col px-6 sm:px-10">
        {/* Centred on the full height, like the panel's content, so both halves share one vertical axis. */}
        <div className="flex flex-1 items-center py-16">
          <div className="mx-auto w-full max-w-sm">
            <BrandLockup />
            <h1 className="mt-10 text-2xl font-semibold tracking-tight">Sign in to Benchmark</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Use your Arbiter Microsoft account. Your role is managed by a Benchmark admin.
            </p>

            <div className="mt-6 grid gap-3">
              {message ? <Callout {...message} /> : null}
              {!message && signed_out ? <Callout tone="success" title="You're signed out" body="Sign in again to continue." /> : null}

              <form action={signIn} className="grid gap-3">
                {next !== DEFAULT_AFTER_LOGIN ? <input type="hidden" name="next" value={next} /> : null}
                <SubmitButton>{message?.action ?? "Sign in with Microsoft"}</SubmitButton>

                {mockAuthEnabled ? (
                  // development-only stand-in for the Microsoft account chooser; removed with Entra ID.
                  <div className="mt-4 grid gap-2 rounded-lg border border-dashed border-border-strong bg-accent p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold">Mock sign-in</span>
                      <Badge tone="warning">Development only</Badge>
                    </div>
                    <p className="text-micro text-muted-foreground">
                      Entra ID isn&apos;t connected yet. Pick who Microsoft should sign you in as, including the failure cases.
                    </p>
                    <SelectField
                      name="account"
                      label="Account"
                      defaultValue={DEFAULT_MOCK_ACCOUNT}
                      options={await signInChoices()}
                    />
                  </div>
                ) : null}
              </form>
            </div>

            <p className="mt-8 text-xs text-muted-foreground">
              Trouble signing in? Contact IT, or ask a Benchmark admin about your role.
            </p>
          </div>
        </div>

        <footer className="absolute inset-x-6 bottom-6 mx-auto max-w-sm text-xs text-muted-foreground sm:inset-x-10">
          Internal tool · Performance audit platform
        </footer>
      </section>

      {/* Dark island in both themes: data-theme="dark" re-scopes every token inside it. */}
      <aside data-theme="dark" className="relative hidden flex-col items-center justify-center overflow-hidden border-r border-border bg-shell p-12 text-foreground md:order-first md:flex">
        <div className="grid w-full max-w-[380px] gap-8">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Every run approved, watched and stoppable.</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Load-test against approved targets, follow p95 live, and stop any run in seconds.
            </p>
          </div>
          <RunPreview />
        </div>
      </aside>
    </main>
  );
}
