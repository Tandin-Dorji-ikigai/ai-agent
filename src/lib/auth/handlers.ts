import { NextRequest } from "next/server";
import { z } from "zod";
import { RegistrationSchema, SignInSchema, ResendSchema } from "@/lib/auth/schemas";
import { AccountError, ACCESS_COOKIE, REMEMBER_COOKIE, assertSameOrigin, authClient, authFailure, authResponse, clearSessionCookies, providerError, readIdentity, registeredAccount, setSessionCookies } from "@/lib/auth/server";
import { db } from "@/lib/supabase/server";

type Context = { params: Promise<{ action: string }> };
async function body<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  if (!req.headers.get("content-type")?.includes("application/json")) throw new AccountError(415, "INVALID_CONTENT_TYPE", "Send this form as JSON.");
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > 32768) throw new AccountError(413, "FORM_TOO_LARGE", "Your registration is too long. Shorten the text fields.");
  let value;
  try { value = JSON.parse(raw); } catch { throw new AccountError(400, "INVALID_JSON", "The form could not be read."); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AccountError(400, "INVALID_INPUT", `${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message}`);
  return parsed.data;
}

export async function GET(req: NextRequest, context: Context) {
  try {
    if ((await context.params).action !== "me") throw new AccountError(404, "NOT_FOUND", "Account endpoint not found.");
    const { user, session } = await readIdentity(req);
    const account = user ? await registeredAccount(user) : null;
    const response = authResponse({ account });
    if (session) setSessionCookies(req, response, session, req.cookies.get(REMEMBER_COOKIE)?.value === "1");
    else if (!user) clearSessionCookies(req, response);
    return response;
  } catch (error) { return authFailure(error); }
}

export async function POST(req: NextRequest, context: Context) {
  try {
    assertSameOrigin(req);
    const { action } = await context.params;
    if (!["signup", "signin", "signout", "resend"].includes(action)) throw new AccountError(404, "NOT_FOUND", "Account endpoint not found.");
    if (action === "signup") {
      const input = await body(req, RegistrationSchema);
      const { data: ready, error: migrationError } = await db().rpc("entrepreneur_registration_ready");
      if (migrationError || ready !== true) throw new AccountError(503, "REGISTRATION_NOT_READY", "Registration needs the database migration. Ask the project owner to apply it first.");
      const { password, email, ...registration } = input;
      const { data, error } = await authClient().auth.signUp({
        email, password,
        options: { data: { mentorflow_registration: registration }, emailRedirectTo: `${new URL(process.env.APP_ORIGIN || req.url).origin}/account/login` },
      });
      // Preserve the provider's duplicate-account privacy behavior.
      if (error && error.code !== "user_already_exists" && error.code !== "email_exists") providerError(error);
      const response = authResponse({ signed_in: Boolean(data.session), requires_email_confirmation: !data.session }, 201);
      if (data.session && data.user) {
        await registeredAccount(data.user);
        setSessionCookies(req, response, data.session, false);
      }
      return response;
    }
    if (action === "signin") {
      const input = await body(req, SignInSchema);
      const client = authClient();
      const { data, error } = await client.auth.signInWithPassword({ email: input.email, password: input.password });
      if (error) providerError(error);
      if (!data.session || !data.user) throw new AccountError(401, "INVALID_CREDENTIALS", "The email or password is incorrect.");
      try { await registeredAccount(data.user); } catch (error) { await client.auth.signOut({ scope: "local" }); throw error; }
      const response = authResponse({ signed_in: true });
      setSessionCookies(req, response, data.session, input.remember);
      return response;
    }
    if (action === "resend") {
      const input = await body(req, ResendSchema);
      const { error } = await authClient().auth.resend({ type: "signup", email: input.email, options: { emailRedirectTo: `${new URL(process.env.APP_ORIGIN || req.url).origin}/account/login` } });
      if (error && error.code !== "user_not_found" && error.code !== "email_not_found") providerError(error);
      return authResponse({ message: "If this address has an unconfirmed account, a confirmation email has been requested." });
    }
    const identity = await readIdentity(req);
    const access = identity.session?.access_token ?? req.cookies.get(ACCESS_COOKIE)?.value;
    if (access) {
      const { error } = await db().auth.admin.signOut(access, "local");
      if (error && error.status && error.status >= 500) providerError(error);
    }
    const response = authResponse({ signed_in: false });
    clearSessionCookies(req, response);
    return response;
  } catch (error) { return authFailure(error); }
}

// Fixed routes make the role gate's endpoint allow-list explicit and testable.
export const authPost = (action: string) => (req: NextRequest) => POST(req, { params: Promise.resolve({ action }) });
