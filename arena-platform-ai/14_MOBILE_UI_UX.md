# Mobile UI/UX

Use Expo React Native.

## Primary mobile roles
- Organizer
- Scorer
- Player/spectator

## Navigation
Home
Tournaments
Matches
Notifications
Profile

## Scorer experience
Open assigned match → verify participants → Start → large score controls → undo → pause/resume → finish → confirm.

## Scoring screen requirements
- very large scores
- large touch targets
- one-tap point entry
- clear current game
- game history
- persistent undo
- connection indicator
- no distracting animation
- confirmation before irreversible finalization

## Public mobile tournament
Live matches first, then upcoming/results/draw/standings.

## Performance
Avoid unnecessary rerenders. Subscribe only to relevant realtime channels.
