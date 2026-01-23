---
name: Testing and CI
description: Instructions for running tests, writing new tests, and maintaining CI stability.
---

# Testing and CI Guidelines

## Core Principles
1.  **Strict Containment**: Tests MUST NOT make external API calls (LLM, YouTube, Twitter).
2.  **Fail Fast**: Tests should fail immediately if configuration is wrong.

## Environment Variables
The test runner (`scripts/tasks.ts test`) enforces these variables. ALways use them when running tests manually or verifying code.
- `SKIP_LLM=true`: Mocks LLM calls. Agents will try to load `output.yaml` from their run store instead of calling Gemini.
- `DRY_RUN=true`: Prevents side effects (uploads, posts).

## Running Tests
Always use the project task runner:
```bash
npm test
# OR
npx tsx scripts/tasks.ts test
```

## Writing New Tests
1.  **Location**: Place new tests in `tests/`.
2.  **Setup**: Import `tests/setup.js` at the top of the file.
3.  **Naming**: `*.test.ts`.
4.  **Mocking**:
    - If testing an Agent, seed the `AssetStore` with expected "outputs" if you expect `SKIP_LLM` to work.
    - Use `AssetStore` to scaffold a temporary run directory.

## CI Configuration
- Workflow: `.github/workflows/ci.yml`
- The CI runs `npm test`.
- Dependencies: ensure all dev tools (like `fs-extra`) are in `devDependencies`.
