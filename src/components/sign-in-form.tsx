"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, LogOut } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useDemo } from "@/components/demo-state";
import { ROLE_LABEL, SIGN_IN_PATH, VIEWER_ROLES, type ViewerRole } from "@/lib/access";

/**
 * The one sign-in form for every role (see src/lib/access.ts): the password
 * decides who you are, and the server sends you to your workspace (or to the
 * page you were trying to open, if your role may open it).
 */
export function SignInForm({ label = "Password", submitLabel = "Sign in", accountMode = false, defaultEmail = "" }: { label?: string; submitLabel?: string; accountMode?: boolean; defaultEmail?: string }) {
  const { act } = useDemo();
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(defaultEmail);
  const [remember, setRemember] = useState(false);
  const [notice, setNotice] = useState("");
  const signedInAs = params.get("signed_in_as") as ViewerRole | null;
  const wrongRole = signedInAs && VIEWER_ROLES.includes(signedInAs) ? signedInAs : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (accountMode) {
        const result = await act("signin", "/api/auth/signin", { email, password, remember });
        if (result.ok) { setPassword(""); router.push("/account"); return; }
        setBusy(false);
        return;
      }
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
      {!accountMode && wrongRole && (
        <Alert>
          <AlertTitle>You are signed in as {ROLE_LABEL[wrongRole]}</AlertTitle>
          <AlertDescription>The page you opened needs a different password. Sign in with it to switch this device.</AlertDescription>
        </Alert>
      )}
      {notice && <Alert className=""><AlertDescription className="">{notice}</AlertDescription></Alert>}
      {accountMode && <div className="field"><Label htmlFor="account-email" className="">Email address</Label><Input id="account-email" className="" type="email" autoComplete="username" value={email} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)} required /></div>}
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
            maxLength={accountMode ? 128 : 200}
          />
          <Button type="button" variant="ghost" size="icon" className="password-toggle" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible((v) => !v)}>
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
      </div>
      {accountMode && <div className="checkbox-row"><Checkbox id="account-remember" className="" checked={remember} onCheckedChange={(checked: boolean | "indeterminate") => setRemember(checked === true)} /><Label htmlFor="account-remember" className="">Remember me</Label></div>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full login-submit" disabled={busy || !password}>
        {busy ? "Checking…" : submitLabel}
        <ArrowRight className="size-4" />
      </Button>
      {accountMode && <Button type="button" variant="link" className="" disabled={busy || !email.trim()} onClick={async () => { setBusy(true); const result = await act("resend", "/api/auth/resend", { email }); if (result.ok) setNotice(String(result.message)); setBusy(false); }}>Resend confirmation email</Button>}
    </form>
  );
}

/** Signs this device out and goes to the sign-in page. */
export function SignOutButton({ className = "", iconClassName = "size-4", iconOnly = false }: { className?: string; iconClassName?: string; iconOnly?: boolean }) {
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
