# Web UI/UX

## Design goal
Professional sports operations dashboard. Fast, clean, information-dense without clutter.

## Routes
- /
- /login
- /dashboard
- /tournaments
- /tournaments/new
- /tournaments/[id]
- /tournaments/[id]/categories
- /tournaments/[id]/participants
- /tournaments/[id]/draw
- /tournaments/[id]/matches
- /tournaments/[id]/schedule
- /tournaments/[id]/statistics
- /t/[slug] public tournament
- /m/[id] public match

## Organizer navigation
Dashboard
Tournaments
Participants
Matches
Schedule
Courts
Statistics
Settings

## Dashboard cards
Participants, scheduled, live, completed, upcoming.

## Required states
Every major page needs:
- loading
- empty
- error
- success
- permission denied
- offline/reconnecting where relevant

## Bracket
Responsive, zoom/scroll on small screens, readable match cards.

## Public page
Overview, Live, Matches, Draw, Standings, Players, Statistics.

## Accessibility
Keyboard navigation, semantic HTML, sufficient contrast, visible focus states, labels, reduced motion support.
