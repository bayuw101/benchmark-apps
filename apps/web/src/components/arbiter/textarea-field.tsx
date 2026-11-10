"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { FieldShell, fieldControlClass, type FieldBaseProps } from "@/components/arbiter/field-shell";

export interface TextareaFieldProps extends FieldBaseProps {
  value?: string;
  defaultValue?: string;
  rows?: number;
  name?: string;
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement>;
}

export function TextareaField({ value, defaultValue, rows = 4, name, onChange, ...field }: TextareaFieldProps) {
  const autoId = React.useId();
  const id = field.id ?? autoId;
  const [focused, setFocused] = React.useState(false);
  const [inner, setInner] = React.useState(defaultValue ?? "");
  const current = value ?? inner;
  return (
    <FieldShell {...field} inputId={id} focused={focused} filled={current.length > 0} tall>
      <textarea
        id={id}
        name={name}
        rows={rows}
        value={current}
        disabled={field.disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setInner(e.target.value);
          onChange?.(e);
        }}
        className={cn(fieldControlClass(!!field.icon, !!field.error), "min-h-24 resize-y pb-2")}
      />
    </FieldShell>
  );
}
