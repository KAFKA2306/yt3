# Testing Strategy

## Overview
This project uses `node:test` for unit and integration testing. The testing strategy prioritizes strict containment to prevent accidental external API calls (LLM, YouTube, Twitter) during automated tests.

## Running Tests
To run all tests:
```bash
npm test
```
This runs `npx tsx scripts/tasks.ts test`, which enforces strict environment variables.

## Containment Rules
All tests MUST run with the following environment variables (automatically set by `scripts/tasks.ts test` and `tests/setup.ts`):
- `SKIP_LLM=true`: Prevents `BaseAgent` from calling Gemini. It attempts to load mocked output from the run store instead.
- `DRY_RUN=true`: Prevents `PublishAgent` and other components from making external mutation calls (YouTube upload, Twitter post).

## Writing Tests
### Unit Tests
- Import `tests/setup.js` at the top of your test file to ensure environment variables are loaded.
- Use `node:assert` for assertions.
- Use `node:test` for structure (`describe`, `it`).

### Mocking Agents
- When testing Agents (e.g. `ResearchAgent`), `SKIP_LLM=true` will cause `runLlm` to bypass the API.
- You must seed the `AssetStore` with expected "outputs" if you expect the agent to return data in this mode.
- See `tests/step_research.test.ts` for an example.

### Integration Tests
- `tests/core_store.test.ts` verifies filesystem persistence.
- `tests/step_publish.test.ts` verifies the `dry_run` logic of the `PublishAgent`.

## CI Integration
The `package.json` `test` script is configured to run the safe test wrapper. This ensures CI runs (GitHub Actions) are also contained and safe from external side effects.
