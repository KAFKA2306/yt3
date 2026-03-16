# ADR-0004: Improve Automation Reliability and JSON Parsing

## Status

Accepted

## Context

Daily automation failed (2026-03-15/16) because Voicevox was down and `run_workflow_cron.sh` silenced errors from `task up`. Additionally, noisy LLM outputs (thinking tags, narrative text) caused JSON parsing failures in `core.ts`.

## Decision

1. Modified `run_workflow_cron.sh` to remove silent error suppression (`> /dev/null 2>&1`) and added docker state logging.
2. Enhanced `cleanCodeBlock` in `core.ts` with a case-insensitive global regex to strip `<think>` tags and more effectively extract JSON blocks.

## Consequences

- Service failures will now be clearly visible in daily logs.
- The pipeline is more resilient to LLM "thinking" noise.
- Requires maintenance of the `cleanCodeBlock` regex if thinking tag formats change.
