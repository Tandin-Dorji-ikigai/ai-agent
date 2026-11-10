"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// "Notify me when the call starts": a push notification on this device when
// the other person joins the call first (see src/lib/push.ts, public/sw.js).
// The browser only allows asking for permission after a tap, hence the button.

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

type Status = "checking" | "unsupported" | "needs-home-screen" | "off" | "on" | "blocked";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isHomeScreenApp(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await res.json()) as { ok: boolean; message?: string };
  } catch {
    return { ok: false, message: "Cannot reach the app server." };
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

export function CallAlerts({ role }: { role: "entrepreneur" | "mentor" }) {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const other = role === "mentor" ? "your mentee" : "your mentor";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supported = Boolean(PUBLIC_KEY) && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      let next: Status;
      if (!supported) next = isIos() && !isHomeScreenApp() && Boolean(PUBLIC_KEY) ? "needs-home-screen" : "unsupported";
      else if (Notification.permission === "denied") next = "blocked";
      else {
        const sub = await currentSubscription().catch(() => null);
        if (sub) {
          // Keep the server's copy up to date (a phone may have switched sign-in).
          void post("/api/push/subscribe", { role, subscription: sub.toJSON() });
          next = "on";
        } else next = "off";
      }
      if (!cancelled) setStatus(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  async function turnOn() {
    setBusy(true);
    setMessage(null);
    try {
      // Ask first, while the tap still counts (Safari needs that).
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY!) }));
      const saved = await post("/api/push/subscribe", { role, subscription: sub.toJSON() });
      if (!saved.ok) {
        setMessage(saved.message ?? "Could not turn notifications on.");
        return;
      }
      setStatus("on");
    } catch {
      setMessage("Could not turn notifications on in this browser.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMessage(null);
    const sub = await currentSubscription().catch(() => null);
    if (sub) {
      await post("/api/push/unsubscribe", { endpoint: sub.endpoint });
      await sub.unsubscribe().catch(() => undefined);
    }
    setStatus("off");
    setBusy(false);
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    const sub = await currentSubscription().catch(() => null);
    const res = sub ? await post("/api/push/test", { endpoint: sub.endpoint }) : { ok: false, message: "Turn notifications on first." };
    setMessage(res.ok ? "Test sent. It should appear in a few seconds." : (res.message ?? "The test could not be sent."));
    setBusy(false);
  }

  if (status === "checking" || status === "unsupported") return null;

  return (
    <Alert className="mb-6">
      {status === "on" ? <Bell className="size-4" /> : <BellOff className="size-4" />}
      <AlertTitle>{status === "on" ? "Call notifications are on" : "Get a notification when the call starts"}</AlertTitle>
      <AlertDescription>
        {status === "needs-home-screen" && (
          <p>On iPhone, notifications only work from the Home Screen: tap Share, then Add to Home Screen, open MentorFlow from there, and turn this on.</p>
        )}
        {status === "blocked" && <p>Notifications are blocked for this site. Allow them in your browser or phone settings, then reload.</p>}
        {status === "off" && <p>This phone will buzz when {other} joins the session room, even if the app is closed.</p>}
        {status === "on" && <p>This phone will buzz when {other} joins the session room.</p>}
        {(status === "off" || status === "on") && (
          <div className="row wrap mt-2">
            {status === "off" ? (
              <Button size="sm" disabled={busy} onClick={() => void turnOn()}>
                <Bell className="size-4" />
                {busy ? "Turning on…" : "Notify me"}
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void test()}>
                  Send a test
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void turnOff()}>
                  Turn off
                </Button>
              </>
            )}
          </div>
        )}
        {message && (
          <p role="status" className="mt-2">
            {message}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
