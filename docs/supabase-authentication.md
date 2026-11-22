# Supabase authentication

Chess Arena continues to use Supabase Auth. The login and signup pages call the
existing browser client; Google and GitHub sign-in use Supabase OAuth and return
to the configured application origin. The browser client uses the PKCE flow,
detects the OAuth callback URL, persists the session, and the app's auth
provider listens for session changes.

## Supabase Dashboard checks

- Keep Google and GitHub enabled under **Authentication → Sign In / Providers**.
- Set the **Site URL** to the canonical deployed application origin.
- Add each allowed local, preview, and production application origin under
  **Authentication → URL Configuration → Redirect URLs**.
- Confirm each OAuth provider's authorized callback points to the Supabase
  project's `/auth/v1/callback` endpoint.
- Configure Supabase Auth's server-side password policy to require at least 12
  characters and the desired character classes. The UI also checks these
  requirements, but server-side Auth configuration is what protects direct
  Auth API requests.
- Use Supabase Auth rate limits and enable CAPTCHA/abuse protection for public
  signup if appropriate for the deployment.

Supabase Auth automatically links OAuth identities that have the same verified
email. The application does not implement email-only manual linking. This
avoids linking an identity based only on an unverified email address.

## Username database safeguard

The signup form normalizes usernames to lowercase and checks availability for
feedback. The database remains authoritative: `sql/schema.sql` adds a unique
index on `LOWER(profiles.username)` and normalizes/validates email-signup
metadata in the existing `auth.users` profile trigger. OAuth accounts without
a requested username receive a generated unique handle; the existing
`ON CONFLICT (id) DO NOTHING` behavior continues to prevent duplicate profiles.

Before applying the schema to a project, inspect existing case-insensitive
collisions:

```sql
SELECT LOWER(username) AS normalized_username, COUNT(*)
FROM public.profiles
GROUP BY LOWER(username)
HAVING COUNT(*) > 1;
```

The schema migration aborts before creating the unique index if collisions
exist. Resolve any collisions deliberately while preserving the affected
profiles and user data, then rerun the migration. This repository's
`npm run db:migrate` applies the complete `sql/schema.sql`; review it and use a
staging project first. No remote database migration is run by the application
build or tests.

## Verification

Automated tests cover input normalization, strong-password rules, username
availability feedback, duplicate-click disabling, and Supabase OAuth/signup
requests. Google/GitHub provider credentials, email confirmation delivery, and
real callback/session persistence still need an end-to-end test against the
configured Supabase project and its provider dashboards.
