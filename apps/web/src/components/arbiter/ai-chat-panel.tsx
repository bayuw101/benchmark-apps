"use client";

import * as React from "react";
import { ChevronDown, Paperclip, Send, Sparkles, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/* ---------- AIChatPanel: 360px, pushes the content card ---------- */

export interface AIChatPanelProps {
  title?: string;
  model?: string;
  suggestions?: string[];
  messages?: { role: "user" | "ai"; text: string }[];
  onSend?: (text: string) => void;
  onClose?: () => void;
}

export function AIChatPanel({ title = "Assistant", model = "Default model", suggestions = [], messages: initial = [], onSend, onClose }: AIChatPanelProps) {
  const [messages, setMessages] = React.useState(initial);
  const [text, setText] = React.useState("");

  function send(t = text) {
    const v = t.trim();
    if (!v) return;
    setMessages((m) => [...m, { role: "user", text: v }]);
    setText("");
    onSend?.(v);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-sm">
      <div className="flex h-14 items-center gap-2 border-b border-border pr-3 pl-4">
        <span className="flex size-6 items-center justify-center rounded-md bg-brand text-white"><Sparkles className="size-3.5" /></span>
        <span className="flex-1 text-sm font-semibold">{title}</span>
        {onClose ? <Button variant="ghost" size="icon" icon={<X />} aria-label="Close assistant" onClick={onClose} /> : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 ? (
          <div className="mt-auto grid gap-2">
            <div className="mb-1 text-lg font-semibold">How can I help?</div>
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left text-xs transition-colors duration-150 hover:border-border-strong hover:bg-muted"
              >
                <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
                {s}
              </button>
            ))}
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                m.role === "user" ? "self-end bg-primary text-primary-foreground" : "self-start bg-muted",
              )}
            >
              {m.text}
            </div>
          ))
        )}
      </div>
      <div className="m-3 rounded-xl border border-border bg-background transition-[border-color,box-shadow] duration-150 focus-within:border-field-focus focus-within:shadow-[0_0_0_2px_var(--field-ring)]">
        <textarea
          aria-label="Message"
          placeholder="Ask anything"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          className="block max-h-30 w-full resize-none border-0 bg-transparent px-3 pt-3 font-sans text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-1 p-2">
          <Button variant="ghost" size="icon" icon={<Paperclip />} aria-label="Attach" />
          <span className="mr-auto inline-flex h-8 items-center gap-1 px-2 text-xs text-muted-foreground">
            {model}
            <ChevronDown className="size-3" />
          </span>
          <Button size="icon" icon={<Send />} aria-label="Send" disabled={!text.trim()} onClick={() => send()} />
        </div>
      </div>
    </div>
  );
}
