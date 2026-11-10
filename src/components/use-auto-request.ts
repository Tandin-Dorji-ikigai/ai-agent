"use client";

import { useEffect, useRef, useState } from "react";

const TRIES = 3;
const RETRY_MS = 5000;

/**
 * The agent keeps going by itself: when there are matches but no mentor is
 * being asked (older data, or a step that failed), it asks the best match.
 * No button, and no error banner for work the person did not start: it
 * retries quietly (3 tries). `key` identifies the situation; null = nothing to do.
 * The server ignores repeats (/api/requests/start).
 */
export function useAutoRequest(key: string | null, refresh: () => Promise<void>): { stalled: boolean } {
  const tries = useRef(new Map<string, number>());
  const [retry, setRetry] = useState(0);
  const [stalledKey, setStalledKey] = useState<string | null>(null);

  useEffect(() => {
    if (!key || stalledKey === key) return;
    const n = tries.current.get(key) ?? 0;
    if (n >= TRIES) return;
    // Counted when it fires, so React's development double-run does not use up a try.
    const timer = setTimeout(() => {
      tries.current.set(key, n + 1);
      fetch("/api/requests/start", { method: "POST" })
        .then((res) => res.json())
        .then((json: { ok: boolean }) => {
          if (!json.ok) throw new Error("start failed");
          return refresh();
        })
        .catch(() => (n + 1 >= TRIES ? setStalledKey(key) : setRetry((r) => r + 1)));
    }, n === 0 ? 0 : RETRY_MS);
    return () => clearTimeout(timer);
  }, [key, retry, stalledKey, refresh]);

  return { stalled: !!key && stalledKey === key };
}
