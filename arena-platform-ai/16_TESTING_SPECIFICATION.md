# Testing Specification

## Unit
Scoring engine:
- all boundary scores
- best-of-3
- undo
- invalid transitions

Tournament engine:
- 4/8/16/32 participant knockout
- byes
- round robin pairing
- groups
- qualification

Statistics:
- wins/losses
- games
- points
- standings/tiebreaks

## Integration
- auth + RLS
- tournament creation
- registration
- draw generation
- scoring persistence
- match finalization
- bracket advancement
- standings update
- realtime subscription

## E2E
Organizer:
create tournament → category → participants → draw → schedule → score → final.

Scorer:
login → assigned match → score → undo → finish.

Spectator:
open public page → observe live score → view final result.

## Regression
Every bug fix gets a regression test.

## Quality gates
No phase is complete with failing typecheck, lint, unit tests, or required integration/E2E tests.
