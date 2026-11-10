"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { FieldShell, fieldControlClass, type FieldBaseProps } from "@/components/arbiter/field-shell";

export interface InputFieldProps extends FieldBaseProps {
  value?: string;
  defaultValue?: string;
  /** No type="email"/"number" (no native validation). type="password" is kept for masking. */
  type?: "text" | "password";
  name?: string;
  autoComplete?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}

export function InputField({ value, defaultValue, type = "text", name, autoComplete, onChange, ...field }: InputFieldProps) {
  const autoId = React.useId();
  const id = field.id ?? autoId;
  const [focused, setFocused] = React.useState(false);
  const [inner, setInner] = React.useState(defaultValue ?? "");
  const current = value ?? inner;
  return (
    <FieldShell {...field} inputId={id} focused={focused} filled={current.length > 0}>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        value={current}
        disabled={field.disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setInner(e.target.value);
          onChange?.(e);
        }}
        className={cn(fieldControlClass(!!field.icon, !!field.error), "h-[42px]")}
      />
    </FieldShell>
  );
}
