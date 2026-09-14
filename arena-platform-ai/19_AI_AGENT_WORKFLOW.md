# AI Agent Workflow

## Initial prompt
Read `00_MASTER_INSTRUCTIONS.md`, then read the documentation relevant to Phase 0. Inspect the repository before changing anything. Do not implement future phases.

## Phase prompt template
"Implement Phase N from `18_DEVELOPMENT_PHASES.md`. Read all referenced specifications first. Inspect existing code. Implement production-quality functionality. Do not use mock implementations for required behavior. Add/update tests. Run lint, typecheck, unit tests, and relevant integration/E2E tests. Fix failures. Update the implementation checklist and provide a verification report. Do not start Phase N+1."

## Agent behavior
- Prefer small commits/changes.
- Explain architectural deviations before making them.
- Never overwrite user secrets.
- Use environment variables for secrets.
- Never commit `.env`.
- Keep migrations reversible where practical.
- Do not remove tests to make a build pass.
- If requirements conflict, stop and identify the conflict rather than guessing.

## Verification report
Include:
- files changed
- features implemented
- tests run
- test results
- known limitations
- next recommended phase
