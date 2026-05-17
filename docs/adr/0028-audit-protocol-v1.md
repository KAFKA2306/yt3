# ADR 0028: Zero-Trust Audit Protocol

## Status
Accepted

## Purpose
Define the deterministic audit gate for video publication.

## Canonical Rules
1. `evidence_raw.json` is the source of truth.
2. Numeric ASR loopback must match the script.
3. FFmpeg signal checks must catch black frames and freezes.
4. Any missing required evidence blocks publish.
5. Markdown summaries are not audit criteria.

## Required Outputs
- `runs/<RUN_ID>/audit/result.json`
- `runs/<RUN_ID>/audit/evidence_raw.json`
- `runs/<RUN_ID>/audit/report.json`
