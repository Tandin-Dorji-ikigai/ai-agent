"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeftRight, ArrowRight, Eye, EyeOff, LogOut } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABEL, SIGN_IN_PATH, VIEWER_ROLES, homeFor, type ViewerRole } from "@/lib/access";

const WORKSPACES: [ViewerRole, string][] = [
  ["entrepreneur", "Entrepreneur workspace"],
  ["mentor", "Mentor workspace"],
  ["ydf", "YDF staff"],
];

/**
 * The sign-in card. When no role passwords are set (local development), a
 * password cannot pick the workspace, so it offers a workspace picker instead.
 */
export function SignInCard() {
  const [required, setRequired] = useState<boolean | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/access", { signal: ctrl.signal, cache: "no-store" })
      .then((res) => res.json() as Promise<{ sign_in?: boolean }>)
      .then((json) => setRequired(json.sign_in !== false))
      .catch(() => {}); // keep the password form
    return () => ctrl.abort();
  }, []);

  if (required === false) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Choose a workspace</CardTitle>
          <CardDescription>
            Sign-in is off on this copy because no passwords are set (local development), so a password cannot choose your workspace. Pick one here.
            On the live site, the password decides it.
          </CardDescription>
        </CardHeader>
        <CardContent className="stack-tight">
          {WORKSPACES.map(([role, label]) => (
            <Button key={role} variant="outline" className="justify-between" asChild>
              <a href={homeFor(role)}>
                {label}
                <ArrowRight className="size-4" />
              </a>
            </Button>
          ))}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          Enter the password the team gave you. It takes you to your workspace: entrepreneur, mentor or YDF staff. This test version has no personal
          accounts, so please don’t enter real personal details anywhere in it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignInForm />
      </CardContent>
    </Card>
  );
}

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

/**
 * Signs this device out and goes to the sign-in page. When sign-in is off
 * (local development) there is nothing to sign out of, so it reads
 * "Switch workspace" and opens the workspace picker.
 */
export function SignOutButton({ signedIn = true }: { signedIn?: boolean }) {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      if (signedIn) await fetch("/api/access", { method: "DELETE" });
    } finally {
      window.location.assign(SIGN_IN_PATH);
    }
  }
  const Icon = signedIn ? LogOut : ArrowLeftRight;
  return (
    <Button type="button" variant="ghost" size="sm" className="sign-out-button" disabled={busy} onClick={() => void signOut()}>
      <Icon className="size-4" />
      <span>{busy ? (signedIn ? "Signing out…" : "Opening…") : signedIn ? "Sign out" : "Switch workspace"}</span>
    </Button>
  );
}
