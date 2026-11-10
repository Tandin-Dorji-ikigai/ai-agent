import { describe, expect, it } from "vitest";
import { SubscribeSchema } from "@/app/api/push/schemas";
import { callJoinedMessage } from "./push";

describe("call notifications", () => {
  it("tells the other side, by first name, and opens their call screen", () => {
    expect(callJoinedMessage("entrepreneur", "Pema Yangchen", "b1")).toEqual({
      to: "mentor",
      message: { title: "Pema is in the session room", body: "Tap to join. The call is recorded for your notes.", url: "/mentor/call?join=1", tag: "call-b1" },
    });
    const m = callJoinedMessage("mentor", "Deki Wangmo", "b1");
    expect(m.to).toBe("entrepreneur");
    expect(m.message.title).toBe("Deki is in the session room");
    expect(m.message.url).toBe("/entrepreneur/call?join=1");
  });

  it("still reads well without a name", () => {
    expect(callJoinedMessage("mentor", "  ", "b1").message.title).toBe("Your mentor is in the session room");
  });

  it("accepts a real browser subscription and refuses anything else", () => {
    const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc123", keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } };
    expect(SubscribeSchema.safeParse({ role: "mentor", subscription: sub }).success).toBe(true);
    expect(SubscribeSchema.safeParse({ role: "ydf", subscription: sub }).success).toBe(false);
    expect(SubscribeSchema.safeParse({ role: "mentor", subscription: { ...sub, endpoint: "http://example.com/x" } }).success).toBe(false);
    expect(SubscribeSchema.safeParse({ role: "mentor", subscription: { ...sub, endpoint: "javascript:alert(1)" } }).success).toBe(false);
  });
});
