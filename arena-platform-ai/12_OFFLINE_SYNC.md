# Offline Scoring

This is a P1/P2 capability but must be architected early.

## Local queue
Each locally created event has:
- client_event_id
- match_id
- game_id
- sequence/client sequence
- participant_id
- device/session ID
- created timestamp

## Sync
Online:
local event → server validation → persisted event → confirmation

Offline:
local event → encrypted/appropriate local storage → queue

Reconnect:
queue events → server deduplication → validation → ordered persistence → acknowledgements

Never blindly overwrite server state.

If conflict occurs:
- stop automatic destructive merge
- preserve both audit records
- show scorer/admin resolution flow
