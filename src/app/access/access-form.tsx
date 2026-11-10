"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Leaf } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The shared demo password, once per device. */
export function AccessForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const next = new URLSearchParams(window.location.search).get("next") ?? "/";
    try {
      const res = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, next }) });
      const json = (await res.json()) as { ok: boolean; next?: string; message?: string };
      if (json.ok) {
        window.location.assign(json.next ?? "/");
        return;
      }
      setError(json.message ?? "That did not work.");
    } catch {
      setError("Cannot reach the app server.");
    }
    setBusy(false);
  }

  return (
    <main className="login-screen">
      <p className="brand mb-5">
        <span className="brand-icon">
          <Leaf className="size-5" />
        </span>
        <span>mentorflow</span>
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Enter the demo</CardTitle>
          <CardDescription>This test version is password protected. Ask the team for the demo password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="stack" onSubmit={(e) => void submit(e)}>
            <div className="field">
              <Label htmlFor="demo-password">Demo password</Label>
              <Input id="demo-password" type="password" autoComplete="current-password" value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} required />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy || !password}>
              {busy ? "Checking…" : "Enter"}
              <ArrowRight className="size-4" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
