import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase client using the service-role key.
// NEVER import this from a client component, and never expose these variables
// through NEXT_PUBLIC_*.

export class ConfigError extends Error {
  code = "SUPABASE_NOT_CONFIGURED" as const;
}

let cached: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function db(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new ConfigError(
      "Supabase is not configured. Copy .env.example to .env.local and set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/**
 * Throws on a Supabase error so callers can use plain values.
 * With .maybeSingle() the returned value can still be null (not found).
 */
export function must<T>(result: { data: T | null; error: { message: string; code?: string } | null }, what: string): T {
  if (result.error) {
    throw new DbError(`${what}: ${result.error.message}`, result.error.code, result.error.message);
  }
  return result.data as T;
}

export class DbError extends Error {
  constructor(
    message: string,
    public pgCode?: string,
    public pgMessage?: string,
  ) {
    super(message);
  }
}
