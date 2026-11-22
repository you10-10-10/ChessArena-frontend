# Private game invitations

The invitation acceptance RPC creates and links the game in one transaction.
Its `gameId` is returned to the recipient; the sender polls sent invitations
until acceptance and then opens the same game. Repeating acceptance for an
already accepted invitation returns the existing game ID instead of creating
another game.

Game loading uses the authenticated Supabase server client, so the participant
read policy—not the service-role key—authorizes each game read. The game page
subscribes to Supabase Realtime updates and keeps HTTP polling as a fallback.
Move validation and persistence remain server-side and require the private
`SUPABASE_SERVICE_KEY` environment variable.

## Database setup

Apply these idempotent SQL scripts to a staging project first, then to the
intended Supabase project:

1. `sql/fix_game_invitations.sql` installs the invitation acceptance behavior,
   including expiration handling and retry-safe acceptance.
2. `sql/fix_private_game_access.sql` restricts game reads to participants,
   grants authenticated read access subject to RLS, and adds `public.games` to
   the `supabase_realtime` publication.

Neither script disables RLS or changes existing game rows. Do not apply a
service-role key in browser code or expose it with a `NEXT_PUBLIC_` prefix.

## Verification limits

The local environment needs two authenticated test accounts and the private
server key to verify game moves end to end. Without those, automated tests can
verify invitation response handling and participant-scoped game queries, but
cannot prove the deployed Supabase policies, Realtime publication, or two-user
move synchronization.
