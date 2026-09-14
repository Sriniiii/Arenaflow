# Match Lifecycle

Statuses:
SCHEDULED → READY → LIVE → PAUSED → COMPLETED → FINAL

Alternative terminal/exception states:
CANCELLED, POSTPONED, UNDER_REVIEW

## Rules
- Only valid scheduled participants may start.
- A match cannot be started twice.
- A finalized match cannot accept normal scoring events.
- Finalization sets winner and loser and advances the draw.
- Any correction after finalization must be auditable and permission-controlled.
- Scheduling must prevent court conflicts and participant double-booking.

## Match service operations
createMatch()
scheduleMatch()
assignCourt()
startMatch()
pauseMatch()
resumeMatch()
submitScoreEvent()
undoScoreEvent()
finishMatch()
finalizeMatch()
correctFinalResult()
