import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase client using the service-role key.
// NEVER import this from a client component, and never expose these variables
// through NEXT_PUBLIC_*.

export class ConfigError extends Error {
  code = "SUPABASE_NOT_CONFIGURED" as const;
}

/** Connected to Supabase, but schema/migrations are missing (e.g. no demo_state). */
export class MigrationsRequiredError extends Error {
  code = "MIGRATIONS_REQUIRED" as const;
  constructor(message = "Database tables are missing. Apply supabase/migrations (see APPLY_ALL.sql).") {
    super(message);
  }
}

let cached: SupabaseClient | null = null;

function supabaseKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || undefined;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && supabaseKey());
}

export function db(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = supabaseKey();
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
function isMissingSchema(message: string): boolean {
  return /Could not find the table|schema cache|does not exist/i.test(message);
}

export function must<T>(result: { data: T | null; error: { message: string; code?: string } | null }, what: string): T {
  if (result.error) {
    if (isMissingSchema(result.error.message)) {
      throw new MigrationsRequiredError(
        `${what}: ${result.error.message}. Open Supabase SQL Editor and run supabase/APPLY_ALL.sql`,
      );
    }
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
