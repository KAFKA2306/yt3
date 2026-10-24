# agy Work Order: 100x Viewer Loop Audit

You are the implementation worker for `/home/kafka/2511youtuber/v3/yt3`.
Use the model selected by the caller (`gpt-5.4-luna`). Work autonomously, but keep the patch small, evidence-driven, and reversible.

## Mission

Thoroughly audit and remove unnecessary repository elements, then strengthen the system so every daily run can measurably become fresher, more entertaining, more joyful, better voiced, and more likely to grow viewership. Treat `100x` as a measurable growth target, never as a guarantee.

Use the project terminology exactly:

- 実行層: `agent loop`
- 検証層: `closed-loop agent workflow`
- 継続改善層: `agent improvement loop` / `harness design`

The desired loop is:

`model output -> tool execution -> validation -> feedback -> evaluation -> implementation change -> improved execution harness -> next model output`

## Mandatory reading and baseline

1. Read `AGENTS.md` in full.
2. Read `docs/standard/continuous-improvement-loop.md` in full.
3. Inspect `git status --short`, `git diff --stat`, and existing uncommitted diffs before editing.
4. Preserve every pre-existing user change. Never reset, checkout, stash, commit, push, deploy, publish, or delete remote YouTube content.
5. Run the baseline checks and record exact results:
   - `bun run typecheck`
   - `bun test`
   - `bun x biome check src`
   - `task harness:doctor:quick`
   - `task improve:report`
6. Current observed baseline to verify, not blindly trust:
   - typecheck passes;
   - only 5 tests exist;
   - Biome reports formatting errors in 7 files;
   - the quick doctor performs only a few shallow checks;
   - the 2026-07-10 audit reports 秒算マネー missing research/video/publish and 人類観測所 video complete but publish missing;
   - the improvement report claims 7-day success 100% while autonomy=0%, diversity=0%, video score=1.67%; this is likely a measurement defect, not success.

## Priority 0: make failure visible before adding creative features

Audit and fix the smallest coherent set of root causes, with tests:

1. `src/scripts/improve_report.ts` omits `byosan_money` and assumes run directory equals the bare date. Actual run IDs can have suffixes such as `2026-07-05-june-swoon-femo`. Reuse canonical run discovery helpers instead of inventing another locator.
2. Metrics must never return 100 when there are zero eligible observations. Represent insufficient data explicitly and make the report explain sample size/coverage.
3. `src/scripts/audit_today.ts` defaults `audit_passed` to true when the audit report is missing. Missing/invalid audit evidence must be blocked or failed, never passed.
4. `evidence_ready` must validate required stage outcomes and proof content; file existence alone is not readiness. A produced-but-unpublished video cannot be reported as a completed daily success when publication is required.
5. `src/scripts/agentic_orchestrator.ts` currently continues after task failures and emits `FINISH`. Make terminal state truthful: success only when required stages succeed; otherwise explicit blocked/fail with actionable next step and nonzero exit where appropriate.
6. Expand tests around suffixed run IDs, missing audit files, empty samples, missing publish proof, and orchestrator failure propagation. Avoid live network/LLM/YouTube calls in tests.

Do not merely rewrite report wording. Fix the harness behavior that created the false positive.

## Priority 1: actual audience feedback loop

After Priority 0 is green, inspect the existing `youtube_analytics` database table and all YouTube integrations. Implement only the smallest safe vertical slice that closes the feedback loop:

- ingest channel/video analytics through the official YouTube Analytics API when credentials/scopes are available;
- include at least views, estimated watch minutes, average view duration/percentage, likes, comments, shares, and subscriber gain/loss where supported;
- fail closed with an actionable missing-scope/config result; never fabricate zero as measured data;
- compare videos at equal age windows (for example first 24h/7d), by channel, and report sample size;
- define the `100x` objective as growth of median age-normalized views versus a recorded baseline, alongside watch-time/retention and satisfaction proxies so clickbait cannot win;
- use the existing DB/report/evidence paths where possible. Do not create a parallel reporting universe.

If API authorization prevents a tested end-to-end ingestion, implement and test the pure parsing/storage/reporting seam, document the exact missing OAuth scope, and stop without pretending it ran.

## Priority 2: fresh, joyful, well-voiced daily structure

Inspect existing freshness, audit, content, media, NotebookLM, and voice code before adding anything. Prefer durable validation/routing changes over more prompt prose.

Design the smallest useful closed-loop slice with these requirements:

- generate multiple topic/hook candidates from current evidence, score them for novelty, concreteness, audience relevance, emotional payoff, source quality, and similarity to recent runs, then select with recorded reasons;
- enforce an immediate promise/curiosity gap in the opening, concrete value early, novelty events during the body, a satisfying payoff, and a positive after-feeling without fake cheerfulness;
- keep 秒算マネー, 人類観測所, and 夜話アーカイブ audience models separate;
- treat NotebookLM as an optional research/synthesis tool with provenance, never as an unvalidated source or a mandatory critical-path dependency;
- upgrade voice QA beyond speaker-ID correctness: deterministic loudness/peak/silence/duration checks, intelligibility evidence where available, cadence/speech-rate bounds per channel, and a machine-readable audio quality report;
- do not hardcode subjective claims that a voice is “good.” Produce comparable evidence that later viewer retention can validate.

Implement no more than one coherent vertical slice in this run after Priority 0. Put additional work into a ranked backlog with acceptance tests.

## Deletion audit

Classify every candidate as `delete now`, `retain`, `archive/retention-policy`, or `blocked by missing evidence`. For code/config/dependencies, require reference analysis and passing validation. For large runtime data, report size and retention rationale.

Rules:

- You may remove obvious ignored scratch/cache artifacts inside this repository only after verifying they are not referenced (examples to inspect: `scratch/`, `repomix-output.xml`, `hooks/__pycache__`).
- Do not delete `runs/`, published receipts, audit evidence, `assets/`, `asmr/`, voice models, environments, credentials, or user-modified tracked files merely because they are large.
- Do not touch files outside the repository.
- Use `scripts/guard_destructive.sh` / `scripts/safe_git_clean.sh` where applicable.
- Prefer removing a dead path over adding another abstraction, but do not infer deadness from naming alone (`legacy`, `old`, `fallback`). Prove it from entrypoints/references/runtime configuration.
- Identify duplicate workflows, unreachable entrypoints, unused dependencies, stale docs/config, duplicated report logic, and unbounded artifact growth. Implement a retention policy rather than ad hoc deletion for evidence-bearing artifacts.

## Acceptance and report

Before stopping:

1. Re-run targeted tests, full `bun test`, typecheck, Biome, doctor, and the improvement report.
2. Do not hide baseline failures with `|| true`, fake defaults, or “no tests found” success.
3. Inspect the final diff for accidental changes and secrets.
4. Write `logs/agy_100x_viewer_loop_audit.md` containing:
   - executive verdict;
   - files changed/deleted and why;
   - deletion inventory with sizes and evidence;
   - before/after validation results;
   - before/after metric coverage and sample sizes;
   - remaining blockers and ranked backlog;
   - exact next experiment and stopping/revert condition.
5. In the final response, be concise and factual. Never claim 100x has been achieved without age-normalized YouTube evidence.
