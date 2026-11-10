import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase client using the service-role key.
// NEVER import this from a client component, and never expose these variables
// through NEXT_PUBLIC_*.

export class ConfigError extends Error {
  code = "SUPABASE_NOT_CONFIGURED" as const;
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
 * Error codes meaning "this table, column or function is not in the database",
 * i.e. a migration has not been applied: PostgREST PGRST205 (table), PGRST202
 * (function), PGRST204 (column); Postgres 42P01 (table), 42703 (column).
 * Codes, not message text, so ordinary query bugs are not mistaken for this.
 */
const MISSING_SCHEMA_CODES = new Set(["PGRST205", "PGRST202", "PGRST204", "42P01", "42703"]);

/**
 * Throws on a Supabase error so callers can use plain values.
 * With .maybeSingle() the returned value can still be null (not found).
 */
export function must<T>(result: { data: T | null; error: { message: string; code?: string } | null }, what: string): T {
  if (result.error) {
    const { message, code } = result.error;
    if (code && MISSING_SCHEMA_CODES.has(code)) throw new MigrationsRequiredError(`${what}: ${message}`, code, message);
    throw new DbError(`${what}: ${message}`, code, message);
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

/** Connected to Supabase, but a table, column or function is missing: migrations not applied. */
export class MigrationsRequiredError extends DbError {
  code = "MIGRATIONS_REQUIRED" as const;
}
