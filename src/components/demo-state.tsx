"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { asApiError } from "@/lib/client-api";
import { frontendRequest } from "@/lib/frontend-api";
import type { ApiError, DemoState } from "@/lib/state-types";

type ActResult = ({ ok: true } & Record<string, unknown>) | ApiError;

interface DemoContext {
  state: DemoState | null;
  error: ApiError | null;
  busy: string | null;
  refresh: () => Promise<void>;
  act: (label: string, path: string, body?: unknown) => Promise<ActResult>;
  lastError: ApiError | null;
  clearLastError: () => void;
}

const Ctx = createContext<DemoContext | null>(null);
const STATE_KEY = ["demo-state"] as const;

// Preserve the existing context API for all three roles. TanStack Query owns
// the server cache, foreground polling, cancellation and mutation refreshes.
export function DemoStateProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [busy, setBusy] = useState<string | null>(null);
  const [lastError, setLastError] = useState<ApiError | null>(null);
  const inFlight = useRef(false);
  const query = useQuery({
    queryKey: STATE_KEY,
    queryFn: ({ signal }) => frontendRequest<DemoState>("/api/state", { signal }),
    networkMode: "always",
    staleTime: 2000,
    refetchInterval: 4000,
    refetchIntervalInBackground: false,
    retry: false,
  }, queryClient);
  const { mutateAsync } = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      frontendRequest<ActResult>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      }),
    networkMode: "always",
    retry: false,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: STATE_KEY });
    },
  }, queryClient);
  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: STATE_KEY });
  }, [queryClient]);
  const act = useCallback(async (label: string, path: string, body?: unknown): Promise<ActResult> => {
    if (inFlight.current) return { ok: false, code: "BUSY", message: "Please wait for the current action to finish." };
    inFlight.current = true;
    setBusy(label);
    setLastError(null);
    try {
      return await mutateAsync({ path, body });
    } catch (err) {
      const error = asApiError(err);
      setLastError(error);
      return error;
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }, [mutateAsync]);

  return (
    <QueryClientProvider client={queryClient}>
      <Ctx.Provider value={{
        state: query.data ?? null,
        error: query.error ? asApiError(query.error) : null,
        busy, refresh, act, lastError,
        clearLastError: () => setLastError(null),
      }}>{children}</Ctx.Provider>
    </QueryClientProvider>
  );
}

export function useDemo(): DemoContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDemo must be used inside DemoStateProvider");
  return ctx;
}
