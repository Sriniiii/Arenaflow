# ArenaFlow — Master AI Engineering Instructions

You are the lead software engineer for ArenaFlow.

## Non-negotiable rules
1. Read all relevant documentation before implementation.
2. Build real functionality; do not replace required functionality with mock data.
3. Do not silently change the architecture, database model, API contracts, or scoring rules.
4. Do not implement future features prematurely.
5. Keep business logic out of UI components.
6. Shared business logic must live in shared packages and be consumed by both web and mobile.
7. Validate all important input on the server.
8. Enforce authorization with Supabase Row Level Security and server-side checks.
9. Never trust client-supplied roles, scores, winners, standings, or permissions.
10. Every completed feature must have tests.
11. Fix failing tests before declaring a phase complete.
12. Do not claim a feature is complete if it is only visually implemented.
13. Keep an implementation checklist and verification report.
14. Preserve auditability for score corrections and administrative changes.
15. Design V1 for badminton but keep the core platform multi-sport-ready.

## Development order
Phase 0: repository/tooling
Phase 1: database/auth/security
Phase 2: tournament/category management
Phase 3: players/participants/registration
Phase 4: tournament and draw engine
Phase 5: badminton scoring engine
Phase 6: match lifecycle
Phase 7: realtime live scoring
Phase 8: organizer web dashboard
Phase 9: mobile scorer/organizer experience
Phase 10: public tournament pages
Phase 11: statistics
Phase 12: offline scoring and sync
Phase 13: notifications
Phase 14: complete testing/security/performance
Phase 15: deployment

## Completion gate
For every phase:
- inspect existing implementation
- implement phase scope
- run lint/typecheck/unit tests
- run integration/E2E tests where applicable
- fix failures
- update checklist
- write a concise verification report
- only then proceed

## UX rule
ArenaFlow is used during real tournaments. Scoring and match operations must be fast, readable, touch-friendly, resilient, and low-friction.

## Never
- hard-code tournament brackets in UI
- calculate badminton winners independently in web and mobile
- use local-only score state as the source of truth
- expose private player data publicly
- let spectators mutate tournament data
- delete score history silently
