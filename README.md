# ChessArena

A chess platform project with local play, Supabase-backed account flows, and database-backed player features.

## Features

- **Local chess**: Play against a local computer opponent or a two-player hot-seat game without an account. The board supports legal-move hints, click or drag moves, move history, undo, castling, en passant, and a choice of promotion piece. Computer games use Stockfish 19 in a browser worker, with nine approximate difficulty tiers, clocks, and locally saved game history and analysis.
- **Accounts**: Supabase email/password sign-up, sign-in, and password reset
- **Player features**: Database-backed profiles, game history, private settings, public chess clubs with owner-managed membership, and a leaderboard updated transactionally when online games finish
- **Matchmaking**: Authenticated database queue and server-validated game moves; completed online games update player records and Elo ratings exactly once (requires the latest migration)
- **Tournaments and puzzles**: Create public tournaments with arena, Swiss, knockout, or round-robin formats; configure clocks, capacity, schedule, and optional club affiliation; invite registered players by username. Pairings, rounds, live game assignment, and results are not implemented yet. Curated mate-in-one puzzles are included.
- **Social**: Search profiles, send/accept database-backed friend requests, and privately message accepted friends with emoji support and read receipts

## Technology Stack

- **Frontend**: Next.js, React, TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Auth)
- **Chess Engine**: Stockfish 19 (GPL-3.0) for computer play, with chess.js validating legal moves
- **Multiplayer**: Database matchmaking and HTTP move synchronization; the standalone Socket.IO service is not currently connected to the web game flow
- **Hosting**: Vercel for frontend, Supabase for backend

## Quick Start

Requires Node.js 20.9 or newer.

The full single-threaded Stockfish WebAssembly engine is copied into `public/stockfish/` during install/build (about 99 MB). Stockfish is GPL-3.0 licensed; review its license and source-distribution obligations before distributing a production build.

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Database

Use Supabase for persistent data storage. Copy `.env.example` to `.env.local`, then set the Supabase project URL, public key, service-role key, and direct Postgres `DATABASE_URL`. The database migration uses the direct connection string and applies `sql/schema.sql` transactionally:

```bash
npm run db:migrate
```

Never expose `SUPABASE_SERVICE_KEY` or `DATABASE_URL` to the browser or commit them. The schema migration creates tables, indexes, profile/leaderboard triggers, matchmaking/tournament RPCs, server-only transactional game-result/Elo updates, row-level security policies, and two curated beginner mate-in-one puzzles. It also separates private preferences and hides puzzle solutions from public database roles. Do not run it with a publishable/anon key.

For an existing Supabase project where the `games` table predates these columns, existing accounts are missing profiles, or you want the new club/tournament features, private friend messaging, and starter puzzles, apply `sql/fix_matchmaking_and_seed_puzzles.sql` in the Supabase SQL Editor. This compatibility patch is safe to rerun. Private messages are limited to accepted, non-blocked friendships and refresh automatically; real-time delivery is not configured.

## Development

- Authentication: Configure Supabase Auth email delivery, redirect URLs, and rate limits.
- Better Auth: Phase 1 scaffold is disabled by default; see [Better Auth Phase 1](./docs/better-auth-phase1.md). Supabase Auth remains active.
- Database: Review and run the migration on a non-production project before applying it to production.
- Environment: Copy `.env.example` to `.env.local` and configure it privately.
- Checklist: See [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) for audited status and remaining release gates.

## Deployment

This application is **not yet certified production-ready**. See the production-readiness checklist for unverified flows and external blockers.

`.env.example` is a template, not a deployable environment file. Add its variables in your hosting provider's environment settings:

- Set `NEXT_PUBLIC_SUPABASE_URL` to your Supabase project URL and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to its publishable (or legacy anon) key.
- Set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` for server-side services. Keep the service-role key private; do not use a `NEXT_PUBLIC_` prefix.
- The Socket.IO process is an isolated in-memory service and is not integrated into the web game flow; do not advertise it as production multiplayer.
- Let the hosting provider supply `PORT` in production.

## Screenshots

![Homepage](public/screenshots/homepage.png)
![Game Board](public/screenshots/gameboard.png)

## Roadmap

1.0.0 - Initial release with core features
1.1.0 - Mobile improvements and offline support
1.2.0 - Advanced analytics and coaching features
1.3.0 - Tournament system and ladders

## License

Commercial use only. Do not redistribute proprietary code from other chess platforms.