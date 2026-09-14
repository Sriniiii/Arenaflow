# Database Schema

Core entities:

users/auth identities
profiles
sports
tournaments
categories
players
participants
participant_members
registrations
venues
courts
draws
rounds
draw_nodes
matches
games
match_events
standings
standings_entries
player_statistics
tournament_statistics
notifications
audit_logs

## Key relationships
tournament → categories
category → registrations/participants/draw
participant → participant_members → players
draw → rounds → draw_nodes → matches
match → games → match_events
venue → courts

## Important modeling rules
- A participant can contain one player for singles or two players for doubles.
- Player profile and application account are separate.
- Brackets are data, not images.
- Every score point is an immutable event; corrections are additional auditable events or controlled correction records.
- Public/private access is enforced by RLS.
- Timestamps use UTC in storage; render in venue/user timezone.
- Use UUID primary keys.
- Add indexes for foreign keys and public lookup fields such as tournament slug.
