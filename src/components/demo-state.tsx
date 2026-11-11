"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { ACCOUNT_PAGES, REGISTRATION_PAGES, SIGN_IN_PAGES } from "@/lib/access";
import type { AuthStatus, EntrepreneurAccount } from "@/lib/auth/types";
import { asApiError } from "@/lib/client-api";
import { frontendRequest } from "@/lib/frontend-api";
import type { ApiError, DemoState } from "@/lib/state-types";

type ActResult = ({ ok: true } & Record<string, unknown>) | ApiError;

interface DemoContext {
  state: DemoState | null;
  account: EntrepreneurAccount | null;
  authLoading: boolean;
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
  // The sign-in pages show nothing from the demo, and before signing in the API would only answer 401.
  const pathname = usePathname();
  const onSignInPage = (SIGN_IN_PAGES as readonly string[]).includes(pathname);
  const accountMode = (ACCOUNT_PAGES as readonly string[]).includes(pathname) || (REGISTRATION_PAGES as readonly string[]).includes(pathname);
  const auth = useQuery({
    queryKey: ["auth-account"],
    enabled: accountMode,
    queryFn: ({ signal }) => frontendRequest<AuthStatus>("/api/auth/me", { signal }),
    staleTime: 30000, refetchInterval: accountMode ? 60000 : false, retry: false,
  }, queryClient);
  const account = accountMode ? auth.data?.account ?? null : null;
  const query = useQuery({
    // Personal-account pages never read the shared Pema demo or start its agent.
    enabled: !onSignInPage && !accountMode,
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
    onSettled: async (_data, _error, variables) => {
      if (variables.path.startsWith("/api/auth/")) {
        queryClient.removeQueries({ queryKey: STATE_KEY });
        await queryClient.invalidateQueries({ queryKey: ["auth-account"] });
      }
      await queryClient.invalidateQueries({ queryKey: STATE_KEY });
    },
  }, queryClient);
  const refresh = useCallback(async () => {
    if (accountMode) { await queryClient.invalidateQueries({ queryKey: ["auth-account"] }); return; }
    await queryClient.invalidateQueries({ queryKey: STATE_KEY });
  }, [queryClient, accountMode]);
  const act = useCallback(async (label: string, path: string, body?: unknown): Promise<ActResult> => {
    if (accountMode && !path.startsWith("/api/auth/")) return { ok: false, code: "ACCOUNT_SETUP_ONLY", message: "This account action is not connected yet." };
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
  }, [mutateAsync, accountMode]);

  return (
    <QueryClientProvider client={queryClient}>
      <Ctx.Provider value={{
        state: accountMode ? null : query.data ?? null,
        account,
        authLoading: accountMode && auth.isPending,
        error: accountMode ? auth.error ? asApiError(auth.error) : null : query.error ? asApiError(query.error) : null,
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
