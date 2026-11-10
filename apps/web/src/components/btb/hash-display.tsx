"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/arbiter/toast";
import { Hint } from "@/components/ui/tooltip";

/** SHA-256 shown as `a3f9c1…e7d2` with a copy button. */
export function HashDisplay({ hash }: { hash: string }) {
  const [copied, setCopied] = React.useState(false);
  const short = hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;

  async function copy() {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      notify.success("Hash copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      notify.error("Couldn't copy the hash", "Select it and copy manually.");
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Hint label={<span className="font-mono break-all">{hash}</span>} className="max-w-80">
        <code className="font-mono text-xs text-muted-foreground">{short}</code>
      </Hint>
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label={`Copy hash ${hash}`}
        icon={copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
        onClick={copy}
      />
    </span>
  );
}
