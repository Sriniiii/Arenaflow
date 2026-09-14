# Realtime

Use Supabase Realtime for live tournament and match state.

Channels:
- tournament:{tournamentId}
- match:{matchId}

Scorer:
- writes authoritative events
- receives server-confirmed state

Spectator:
- read-only subscription

Web/mobile:
- update UI from confirmed server state
- handle reconnects
- show connection state when appropriate

Realtime is an enhancement, not the only persistence mechanism. Database state remains authoritative.
