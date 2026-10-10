---
name: daily-status-audit
description: Daily audit skill for checking whether today's work is finished and, if not, generating a tight brainstorming response for the next move.
type: skill
---

# Daily Status Audit

## Objective

Check whether today's work for `秒算マネー` and `人類観測所` is complete, then decide the next action without guessing.

## Essential Paths

- Root: `/home/kafka/2511youtuber/v3/yt3`
- 秒算マネー run dir: `/home/kafka/2511youtuber/v3/yt3/runs/daily_pulse/YYYY-MM-DD/`
- 人類観測所 run dir: `/home/kafka/2511youtuber/v3/yt3/runs/humanity_observatory/YYYY-MM-DD/`

## Audit Rules

1. Verify today's run directory for each channel.
2. Confirm the research or web search artifact exists.
3. Confirm the video production artifact exists.
4. Confirm publish artifacts only when the flow is expected to reach publish.
5. Treat missing artifacts as incomplete work, not as success.

## Completion Gates

- 秒算マネー is complete only when today's research and video artifacts exist in the daily pulse run.
- 人類観測所 is complete only when today's research and video artifacts exist in the humanity observatory run.
- If the run is meant to publish today, require the publish artifact too.
- If both are complete, report success and stop.

## Brainstorm Mode

If either channel is incomplete, produce a short brainstorming block with these fields:

- Missing artifacts
- Smallest next task
- Publish state if publish is not finished yet
- Fresh angle if the current topic is stale
- Blocking facts that still need to be collected

Keep the brainstorm concrete. Do not invent facts. Do not expand the scope beyond today's missing work.
