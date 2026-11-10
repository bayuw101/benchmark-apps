"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { FieldShell, fieldControlClass, type FieldBaseProps } from "@/components/arbiter/field-shell";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface SelectFieldProps extends FieldBaseProps {
  value?: string;
  defaultValue?: string;
  options: SelectOption[];
  onChange?: (value: string) => void;
  name?: string;
}

/** Radix Select behind a floating-label trigger. Menu portals to body, shadow-lg. */
export function SelectField({ value, defaultValue, options, onChange, name, ...field }: SelectFieldProps) {
  const autoId = React.useId();
  const id = field.id ?? autoId;
  const [open, setOpen] = React.useState(false);
  const [inner, setInner] = React.useState<string | undefined>(defaultValue);
  const current = value ?? inner;
  const selected = options.find((o) => o.value === current);

  // Radix anchors the menu to the trigger, which sits between the prefix icon and the chevron.
  // Measure the whole field once per open so the menu lines up with its left edge and full width.
  const boxRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [geo, setGeo] = React.useState({ width: 0, offset: 0 });
  function handleOpenChange(next: boolean) {
    if (next) {
      const box = boxRef.current?.getBoundingClientRect();
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (box && trigger) setGeo({ width: box.width, offset: trigger.left - box.left });
    }
    setOpen(next);
  }

  return (
    <SelectPrimitive.Root
      value={current ?? ""}
      onValueChange={(v) => {
        setInner(v);
        onChange?.(v);
      }}
      open={open}
      onOpenChange={handleOpenChange}
      name={name}
      disabled={field.disabled}
    >
      <FieldShell {...field} inputId={id} focused={open} filled={!!selected} open={open} chevron boxRef={boxRef}>
        <SelectPrimitive.Trigger
          ref={triggerRef}
          id={id}
          className={cn(fieldControlClass(!!field.icon, !!field.error), "h-[42px] cursor-pointer truncate text-left")}
        >
          {/* Value text only; the label floats above it. */}
          <span className="block truncate">{selected?.label ?? " "}</span>
        </SelectPrimitive.Trigger>
      </FieldShell>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          align="start"
          alignOffset={-geo.offset}
          sideOffset={4}
          style={{ width: geo.width || undefined, minWidth: "var(--radix-select-trigger-width)" }}
          className="z-50 max-h-56 overflow-y-auto rounded-lg border border-border bg-card p-1 text-foreground shadow-lg data-[state=open]:animate-in-up"
        >
          <SelectPrimitive.Viewport>
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="relative grid w-full cursor-pointer rounded-md py-2 pr-8 pl-2.5 text-left text-sm outline-none select-none data-[highlighted]:bg-muted data-[state=checked]:bg-muted"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                {o.description ? <span className="text-xs text-secondary-foreground">{o.description}</span> : null}
                <SelectPrimitive.ItemIndicator className="absolute top-1/2 right-2.5 -translate-y-1/2">
                  <Check className="size-3.5" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
