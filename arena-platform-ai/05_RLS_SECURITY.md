# Security and RLS

Use Supabase Row Level Security on every application table.

## Public
Anonymous users may read only intentionally public tournament information:
- published tournament metadata
- public categories
- public participants/player display names
- fixtures
- finalized results
- public standings/statistics
- public live score state

## Organizer
Organizer can create/read/update/delete their own tournament resources subject to business rules.

## Tournament admin
Access only to assigned tournaments.

## Scorer
Read assigned tournament/match data and submit scoring events for assigned live matches.

## Player
Can manage their own account/profile fields and view allowed public tournament data.

## Spectator
Read-only public access.

## Security requirements
- Never trust client role values.
- Never expose phone/email unless explicitly authorized.
- Score mutation must verify match assignment/authorization.
- Match finalization must be server-validated.
- Tournament ownership must be checked server-side.
- Storage buckets need policies.
- Audit sensitive administrative and score-correction actions.
- Rate-limit or otherwise protect public mutation endpoints/functions.
