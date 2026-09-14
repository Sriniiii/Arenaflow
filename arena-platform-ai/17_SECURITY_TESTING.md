# Security Testing

Test:
- unauthorized tournament edit
- cross-organizer data access
- scorer scoring an unassigned match
- spectator mutation
- direct API role spoofing
- private player data leakage
- invalid score payloads
- duplicate event replay
- final match mutation
- storage access
- malicious text/input
- rate-limit sensitive mutations

Use RLS and server validation. Client-side checks are UX only, never the security boundary.
