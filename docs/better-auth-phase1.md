# Better Auth Phase 1 scaffold

Phase 1 adds a disabled-by-default Better Auth server configuration and a
Resend email adapter. It does not replace or call the existing Supabase Auth
provider, modify user-facing login or signup pages, change the database, or
migrate users.

## Required environment variables

Add these values privately to `.env.local` for local work and to the hosting
environment when ready:

- `BETTER_AUTH_ENABLED=false` — keep false until a separately approved rollout.
- `BETTER_AUTH_URL` — the canonical app origin, such as
  `http://localhost:3000` for local development.
- `BETTER_AUTH_SECRET` — a long, random server-only secret.
- `BETTER_AUTH_API_KEY` — the server-only API key for the Better Auth Infra
  Dash plugin.
- `BETTER_AUTH_DATABASE_URL` — a server-only Supabase PostgreSQL connection
  string from the Supabase Dashboard. For Vercel, use the shared transaction
  pooler (usually port `6543`) and require SSL. This is intentionally separate
  from the existing `DATABASE_URL` used by the project's migration script.
- `BETTER_AUTH_DATABASE_CA_CERT` — the Supabase database root CA certificate
  from **Project Settings → Database → SSL Configuration**. Paste the PEM
  certificate as a server-only Vercel environment variable. The auth pool uses
  it to validate the database certificate; SSL-related query parameters in the
  connection string are removed so they cannot override this CA configuration.
- `RESEND_API_KEY` — a private Resend API key.
- `RESEND_FROM_EMAIL` — a sender address authorized by Resend. Email sending
  will fail with a clear error until these two Resend settings are configured;
  a verified domain is not needed just to build or run the application while
  Better Auth remains disabled.

Never put these server-only values in a `NEXT_PUBLIC_` variable or commit real
credentials.

The Dash plugin is configured in the Better Auth instance. While
`BETTER_AUTH_ENABLED` is not `true`, only the plugin's
`GET /api/auth/dash/config` endpoint is available for its API-key-protected
dashboard handshake; other Better Auth requests remain disabled. This allows
Dash ownership verification without enabling sign-in or account management.

## Endpoint and database readiness

The prepared endpoint is `/api/auth/[...all]`. Requests other than the Dash
config handshake return 404 unless `BETTER_AUTH_ENABLED=true`. When enabled,
Better Auth expects its tables in the PostgreSQL `better_auth` schema, which has
**not** been created or migrated as part of Phase 1. Requests that require the
database will not work until a later, separately approved database phase is
complete. Schema validation is skipped only while Better Auth is disabled, so
the Dash handshake can initialize without creating auth tables. Setting
`BETTER_AUTH_ENABLED=true` restores schema validation; migrate the schema before
enabling auth.

The existing Supabase Auth integration remains the active authentication
system. In particular, existing profiles reference UUIDs in `auth.users`, and
current RLS policies and the Socket.IO service rely on Supabase Auth. A
production rollout needs an explicit compatibility and user-migration plan
before switching any of those consumers.

## References

- [Better Auth with Next.js](https://better-auth.com/docs/integrations/next)
- [Better Auth PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql)
- [Supabase PostgreSQL connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Resend with Better Auth](https://resend.com/docs/send-with-better-auth)
