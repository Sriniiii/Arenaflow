# Technical Architecture

## Repository
Use a Turborepo monorepo.

apps/
- web: Next.js
- mobile: Expo React Native

packages/
- types
- validation
- scoring-engine
- tournament-engine
- statistics-engine
- ui
- config

supabase/
- migrations
- functions
- seed

## Architecture
Web and mobile consume shared domain types, validation, scoring, tournament, and statistics packages.

Supabase is the backend:
- PostgreSQL
- Auth
- Realtime
- Storage
- Edge Functions where server-side operations are appropriate

## Data ownership
Database is the source of truth.
Client state is a view/cache and may optimistically render actions, but server validation is authoritative.

## Suggested layers
UI → application hooks/services → domain engines → Supabase data access → PostgreSQL/RLS

## Future multi-sport design
Use a `sports` entity and `sport_id` on sport-relevant configuration/entities. V1 exposes only badminton.
Sport-specific rules belong in sport engines/configuration rather than generic UI/database code.

## Offline
The scorer app must eventually queue point events locally and synchronize them safely. Server must detect duplicates/conflicts using event IDs and sequencing.
