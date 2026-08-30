---
name: changelog-builder
description: Compile git commit history and recent pull request updates into a clean, Zero-Fat markdown changelog following standard formatting.
type: skill
---

# Changelog Builder

## Objective

Assemble a precise, factual, and technical summary of recent repository changes and keep project documentation aligned.

## Workflow

1. **Extract Git History**:
   - Run command: `git log --oneline -n 30`
   - Capture list of active commits and PR numbers.

2. **Categorize Changes by Domain**:
   - Classify changes into domains: `daily_pulse` (秒算マネー), `yawa_archive` (夜話アーカイブ), `humanity_observatory` (人類観測所), or `infra/shared`.
   - Categorize by action type: `Features`, `Fixes`, `Audits`, `Infra`.

3. **Format Changelog Entries**:
   - Apply Zero-Fat principles: delete unused text, decorative prose, and abstract self-congratulations.
   - Use objective, data-driven descriptions.

4. **Update File**:
   - Prepend new version sections to the top of `CHANGELOG.md` or output to release notes.
