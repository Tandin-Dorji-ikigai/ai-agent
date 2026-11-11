"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, LogOut } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABEL, SIGN_IN_PATH, VIEWER_ROLES, type ViewerRole } from "@/lib/access";

/**
 * The one sign-in form for every role (see src/lib/access.ts): the password
 * decides who you are, and the server sends you to your workspace (or to the
 * page you were trying to open, if your role may open it).
 */
export function SignInForm({ label = "Password", submitLabel = "Sign in" }: { label?: string; submitLabel?: string }) {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signedInAs = params.get("signed_in_as") as ViewerRole | null;
  const wrongRole = signedInAs && VIEWER_ROLES.includes(signedInAs) ? signedInAs : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, next: params.get("next") ?? undefined }),
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
          <AlertDescription>The page you opened needs a different password. Sign in with it to switch this device.</AlertDescription>
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

/** Signs this device out and goes to the sign-in page. */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/access", { method: "DELETE" });
    } finally {
      window.location.assign(SIGN_IN_PATH);
    }
  }
  return (
    <Button type="button" variant="ghost" size="sm" className="sign-out-button" disabled={busy} onClick={() => void signOut()}>
      <LogOut className="size-4" />
      <span>{busy ? "Signing out…" : "Sign out"}</span>
    </Button>
  );
}
