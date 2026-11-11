# Entrepreneur / mentee registration

Real email/password account creation now supports both existing onboarding
paths. The teammate's shared-password mentor/YDF sign-in and live mentoring
workflows remain intact at `/login`. Mentor applications remain a preview.
The existing shadcn inputs and TanStack Query are reused; no new UI primitives
are introduced.

## Enable in Supabase

1. Apply `supabase/migrations/20261111000010_entrepreneur_registration.sql`
   **after** the nine existing migrations. The combined `supabase/APPLY_ALL.sql` is regenerated for new empty projects. In Supabase,
   open **SQL Editor**, paste the entire file and run it. It is transactional.
   If your CLI is already linked, `npx supabase db push` applies pending migrations.
2. Keep `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
   An optional server-only `SUPABASE_ANON_KEY` can be used for Auth requests.
   The existing service key (`SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`)
   works through a separate per-request Auth client when this variable is omitted.
   No credentials enter client bundles.
3. Optionally set `APP_ORIGIN=http://localhost:3000`. When set, use that same
   browser origin; use the deployed HTTPS origin in a deployment.
4. In **Authentication → URL Configuration**, set the Site URL to the app origin
   and allow its `/account/login` URL for confirmation redirects.
5. Enable the email/password provider and signups. Keep email confirmations
   enabled if users must prove ownership. Configure SMTP for reliable delivery;
   the hosted development sender has provider-enforced limits.
6. Restart `npm run dev`, open `/get-started` and complete either signup path.
   If confirmation is required, follow the email link and sign in. If it is
   disabled in your Supabase project, signup signs the person in immediately.

No real account, email or remote migration is created automatically during tests.
The signup endpoint explicitly reports `REGISTRATION_NOT_READY` until the
migration is installed, preventing an Auth user with no associated profile.

## What is saved

- Supabase Auth owns the email, password hashing, email verification and sessions.
  Passwords are never stored in profile rows, user metadata or browser storage.
- `profiles.auth_user_id` links a registered profile to `auth.users.id`.
  Existing seeded mentor/demo records remain unlinked and unchanged.
- The Auth insert trigger creates `profiles` with role **entrepreneur** and the
  associated `entrepreneur_profiles` row in the same transaction. A profile error
  rolls back the entire Auth insertion.
- Name, phone, location, business/assessment answers, support needs, languages,
  budget and onboarding path are stored. Additional form preferences are saved
  in `entrepreneur_profiles.onboarding_details`.
- Both an entrepreneur with an idea and an exploring mentee use the entrepreneur
  role. Exploring registrations start at idea stage without a fabricated business.
- New people receive no automatic mentorship credit, booking or sample match.
  Their signed-in account view shows only their own saved registration. The
  mentoring workflow remains a separate backend integration.

## Endpoints

| Method | URL | Purpose |
| --- | --- | --- |
| POST | `/api/auth/signup` | Validate the complete registration, check migration readiness, call Supabase signup |
| POST | `/api/auth/signin` | Check email/password and the linked entrepreneur role; create session cookies |
| GET | `/api/auth/me` | Validate identity with Auth, refresh an expired session if possible, read only that user's linked profile |
| POST | `/api/auth/signout` | Revoke the current Auth session and expire cookies |
| POST | `/api/auth/resend` | Request another confirmation email without disclosing whether the address exists |

Payload validation is in `src/lib/auth/schemas.ts`; the form adapter is
`src/lib/auth/registration-form.ts`. Signup accepts `{ email, password,
full_name, phone, location, path, assessment, details }`. It accepts no role,
user ID or privilege fields. Signin accepts `{ email, password, remember }`.

Session tokens are kept in HttpOnly, SameSite=Lax cookies, with Secure on HTTPS.
An access cookie expires with its token. The refresh cookie lasts for the browser
session unless Remember me is selected (up to 30 days; provider policies may end
the session sooner). POST endpoints reject cross-site origins. Responses are
private/no-store and never include session tokens in JSON. Rate-limit and invalid
credential errors are surfaced without exposing provider internals.

Personal account pages at `/account` and `/account/login` use only the Auth
endpoints. They do not fetch `/api/state`, run auto-matching or inherit Pema's
demo data. New users see their saved profile; personal-account mentoring remains
a separate integration. Existing shared-password users keep their original
`/login`, mentor, entrepreneur, YDF, call and coach flows. Switching sign-in
modes clears the other mode's browser cookies. The proxy allows the account
shells and Auth endpoints, but only the independently validated `/api/auth/me`
returns account data. Personal cookies grant no shared mentor/team permissions.

## Demo reset guard

The original `reset_demo` RPC deletes every profile. The migration wraps it and
refuses reset when any linked account exists, serializing against concurrent
profile insertion. The unsafe implementation is not executable by the service,
anon or authenticated API roles. This prevents the existing reset API from
erasing registrations. Existing team/YDF reset is refused once registered users
exist. No reset is run on the shared database during this integration.

This registration change does not turn the old demo endpoints into a multiuser
backend. The existing role-password proxy still guards the shared demo operations;
it does not implement multiuser authorization. Account endpoints use validated identity and
ownership filters and do not expose the demo's global agent/activity data.

## Verification

- Unit tests cover both onboarding paths, validation, role injection, safe Auth
  failures, confirmation, refresh, cookie flags, ownership and logout.
- The migration was executed against an isolated local PostgreSQL instance with
  an Auth users table. SQL assertions cover creation, rollback, forced role,
  cascade cleanup, RPC permissions and reset protection.
- Browser QA checks both form flows, password mismatch, sign-in errors,
  account isolation, reload and signout with mocked Auth API responses.
- No hosted signup/email delivery has been exercised; that requires applying the
  migration and using your project's email provider settings.

The implementation follows Supabase's
[signup API](https://supabase.com/docs/reference/javascript/auth-signup),
[Auth-linked profile guidance](https://supabase.com/docs/guides/auth/managing-user-data)
and [server identity validation](https://supabase.com/docs/reference/javascript/auth-getuser).
