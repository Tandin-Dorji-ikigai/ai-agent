"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ApiError, DemoState } from "@/lib/state-types";

// Shared demo state for all views. Polls /api/state so the Entrepreneur,
// Mentor and YDF views stay in sync even when open on different devices.

type ActResult = ({ ok: true } & Record<string, unknown>) | ApiError;

interface DemoContext {
  state: DemoState | null;
  error: ApiError | null;
  /** Label of the action currently running, e.g. "booking". */
  busy: string | null;
  refresh: () => Promise<void>;
  act: (label: string, path: string, body?: unknown) => Promise<ActResult>;
  lastError: ApiError | null;
  clearLastError: () => void;
}

const Ctx = createContext<DemoContext | null>(null);

const POLL_MS = 4000;

export function DemoStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastError, setLastError] = useState<ApiError | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      const json = (await res.json()) as DemoState | ApiError;
      if (json.ok) {
        setState(json);
        setError(null);
      } else {
        setError(json);
      }
    } catch {
      setError({ ok: false, code: "NETWORK", message: "Cannot reach the app server." });
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  const act = useCallback(
    async (label: string, path: string, body?: unknown): Promise<ActResult> => {
      setBusy(label);
      setLastError(null);
      try {
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
        const json = (await res.json()) as ActResult;
        if (!json.ok) setLastError(json);
        return json;
      } catch {
        const err: ApiError = { ok: false, code: "NETWORK", message: "Cannot reach the app server." };
        setLastError(err);
        return err;
      } finally {
        await refresh();
        setBusy(null);
      }
    },
    [refresh],
  );

  const value = useMemo(
    () => ({ state, error, busy, refresh, act, lastError, clearLastError: () => setLastError(null) }),
    [state, error, busy, refresh, act, lastError],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDemo(): DemoContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDemo must be used inside DemoStateProvider");
  return ctx;
}
