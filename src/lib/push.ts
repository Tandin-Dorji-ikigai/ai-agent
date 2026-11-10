import "server-only";
import webpush from "web-push";
import { db, must } from "./supabase/server";

// Web push notifications (the standard browser feature; works on Android
// Chrome, desktop browsers, and on iPhone once the app is on the Home Screen).
//
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY  shared with browsers when they subscribe
//   VAPID_PRIVATE_KEY             signs each notification (a secret)
//   VAPID_SUBJECT                 a contact URL sent to the push services
//
// Without these, nothing is sent and the "Notify me" button is hidden.

export type PushRole = "entrepreneur" | "mentor";

export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping the notification goes: a path on this site. */
  url: string;
  /** Notifications with the same tag replace each other instead of piling up. */
  tag: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

let configured: boolean | null = null;

export function pushConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  configured = Boolean(publicKey && privateKey && subject);
  if (configured) webpush.setVapidDetails(subject!, publicKey!, privateKey!);
  return configured;
}

/** Saves (or moves to another role) this device's subscription. */
export async function saveSubscription(role: PushRole, sub: PushSubscriptionInput, userAgent: string | null) {
  must(
    await db()
      .from("push_subscriptions")
      .upsert(
        { role, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: userAgent?.slice(0, 300) ?? null },
        { onConflict: "endpoint" },
      )
      .select("id"),
    "save push subscription",
  );
}

export async function removeSubscription(endpoint: string) {
  must(await db().from("push_subscriptions").delete().eq("endpoint", endpoint).select("id"), "remove push subscription");
}

interface Row {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

async function sendTo(rows: Row[], message: PushMessage) {
  let sent = 0;
  let removed = 0;
  let failed = 0;
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(message), {
          TTL: 15 * 60, // a "join the call" alert is useless after 15 minutes
          urgency: "high",
        });
        sent += 1;
        await db().from("push_subscriptions").update({ last_sent_at: new Date().toISOString() }).eq("id", row.id);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // The browser unsubscribed or the app was removed: forget this device.
          await db().from("push_subscriptions").delete().eq("id", row.id);
          removed += 1;
        } else {
          failed += 1;
          console.warn(`[push] send failed (${status ?? "network"})`);
        }
      }
    }),
  );
  return { sent, removed, failed };
}

/** Every device signed in as `role`. Never throws: a notification is a nice-to-have. */
export async function notifyRole(role: PushRole, message: PushMessage) {
  if (!pushConfigured()) return { sent: 0, removed: 0, failed: 0 };
  try {
    const rows = must(await db().from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("role", role), "load push subscriptions") as Row[];
    const result = await sendTo(rows, message);
    console.info(`[push] ${message.tag} to ${role}: ${result.sent} sent, ${result.removed} removed, ${result.failed} failed`);
    return result;
  } catch (err) {
    console.warn("[push] could not notify:", err instanceof Error ? err.message.slice(0, 200) : "error");
    return { sent: 0, removed: 0, failed: 1 };
  }
}

/** One device (the "Send a test" button). */
export async function notifyEndpoint(endpoint: string, message: PushMessage) {
  if (!pushConfigured()) return { sent: 0, removed: 0, failed: 0 };
  const rows = must(await db().from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("endpoint", endpoint), "load push subscription") as Row[];
  return sendTo(rows, message);
}

/** "Pema is in the session room": sent to the other side when someone joins first. */
export function callJoinedMessage(joiner: PushRole, joinerName: string, bookingId: string): { to: PushRole; message: PushMessage } {
  const first = joinerName.trim().split(/\s+/)[0] || (joiner === "mentor" ? "Your mentor" : "Your mentee");
  const to: PushRole = joiner === "mentor" ? "entrepreneur" : "mentor";
  return {
    to,
    message: {
      title: `${first} is in the session room`,
      // Tapping joins at once, so the notice that the call is recorded comes first, here.
      body: "Tap to join. The call is recorded for your notes.",
      url: to === "mentor" ? "/mentor/call?join=1" : "/entrepreneur/call?join=1",
      tag: `call-${bookingId}`,
    },
  };
}
