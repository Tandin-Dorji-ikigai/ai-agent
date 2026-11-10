"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button as ShadcnButton } from "./ui/button";
import { Card as ShadcnCard } from "./ui/card";
import { Badge as ShadcnBadge } from "./ui/badge";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Label as ShadcnLabel } from "./ui/label";

// Keep the existing demo API while reusing the prototype's shadcn/ui controls.

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const BUTTON: Record<ButtonVariant, string> = {
  primary: "default", secondary: "outline", danger: "destructive", ghost: "ghost",
};

export function Button({
  variant = "primary",
  busy = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; busy?: boolean }) {
  return (
    <ShadcnButton
      {...rest}
      variant={BUTTON[variant]}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed",
        className,
      )}
    >
      {busy && <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </ShadcnButton>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <ShadcnCard className={cx("block p-4 sm:p-5", className)}>{children}</ShadcnCard>;
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold text-ink">{children}</h2>
      {aside}
    </div>
  );
}

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const TONE: Record<Tone, string> = {
  neutral: "bg-sunken text-muted",
  accent: "bg-accent-soft text-accent-strong",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <ShadcnBadge variant="secondary" className={cx(TONE[tone], className)}>
      {children}
    </ShadcnBadge>
  );
}

/** Shows whether text came from live AI or a saved fallback. */
export function SourceBadge({ source }: { source: string | null | undefined }) {
  if (source === "live_ai") return <Badge tone="info">Live AI</Badge>;
  if (source === "fallback") return <Badge tone="neutral">Saved response</Badge>;
  return null;
}

const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  pending: "info",
  completed: "success",
  overdue: "danger",
  blocked: "warning",
  open: "danger",
  assigned: "warning",
  resolved: "success",
  failed: "danger",
  running: "info",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
}

export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <Alert variant={tone === "danger" ? "destructive" : "default"} role={tone === "danger" ? "alert" : "status"} className={TONE[tone]}>
      {title && <AlertTitle className="font-semibold">{title}</AlertTitle>}
      <AlertDescription className="text-inherit">{children}</AlertDescription>
    </Alert>
  );
}

export function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <ShadcnLabel htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-ink">
      {children}
    </ShadcnLabel>
  );
}

/** A single-choice group drawn as chips, built on native radio inputs (keyboard and screen-reader friendly). */
export function ChoiceChips({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line bg-card px-3 py-1.5 text-sm text-muted hover:text-ink has-checked:border-accent has-checked:bg-accent-soft has-checked:font-medium has-checked:text-accent-strong has-focus-visible:outline has-focus-visible:outline-focus"
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:border-focus";
