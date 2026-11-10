"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, LogOut } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABEL, VIEWER_ROLES, homeFor, type ViewerRole } from "@/lib/access";

/**
 * Sign in with a role password (see src/lib/access.ts). The password decides
 * who you are; `role` is the sign-in page it was typed on and only breaks a tie.
 */
export function SignInForm({ role, label = "Password", submitLabel = "Sign in" }: { role?: ViewerRole; label?: string; submitLabel?: string }) {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signedInAs = params.get("signed_in_as") as ViewerRole | null;
  const wrongRole = signedInAs && VIEWER_ROLES.includes(signedInAs) && signedInAs !== role ? signedInAs : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, role, next: params.get("next") ?? (role ? homeFor(role) : undefined) }),
      });
      const json = (await res.json()) as { ok: boolean; next?: string; message?: string };
      if (json.ok) {
        window.location.assign(json.next ?? "/"); // a full load, so every screen starts as the new role
        return;
      }
      setError(json.message ?? "That did not work.");
    } catch {
      setError("Cannot reach the app server.");
    }
    setBusy(false);
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      {wrongRole && (
        <Alert>
          <AlertTitle>You are signed in as {ROLE_LABEL[wrongRole]}</AlertTitle>
          <AlertDescription>That page belongs to {role ? ROLE_LABEL[role] : "another role"}. Sign in with that password to switch on this device.</AlertDescription>
        </Alert>
      )}
      <div className="field">
        <Label htmlFor="sign-in-password">{label}</Label>
        <div className="password-field">
          <Input
            id="sign-in-password"
            type={visible ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            required
          />
          <Button type="button" variant="ghost" size="icon" className="password-toggle" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible((v) => !v)}>
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full login-submit" disabled={busy || !password}>
        {busy ? "Checking…" : submitLabel}
        <ArrowRight className="size-4" />
      </Button>
    </form>
  );
}

/** Signs this device out and goes to the sign-in page for `area`. */
export function SignOutButton({ area, className = "", iconClassName = "size-4", iconOnly = false }: { area: "entrepreneur" | "mentor"; className?: string; iconClassName?: string; iconOnly?: boolean }) {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/access", { method: "DELETE" });
    } finally {
      window.location.assign(area === "mentor" ? "/mentor/login" : "/entrepreneur/login");
    }
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size={iconOnly ? "icon" : "default"}
      className={className}
      aria-label={iconOnly ? "Sign out" : undefined}
      disabled={busy}
      onClick={() => void signOut()}
    >
      <LogOut className={iconClassName} />
      {!iconOnly && <span>Sign out</span>}
    </Button>
  );
}
