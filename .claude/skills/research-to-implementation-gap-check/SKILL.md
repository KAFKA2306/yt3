---
name: research-to-implementation-gap-check
description: Compares documentation/specifications/research papers against the actual codebase implementation to map missing components and classify gaps.
type: skill
---

# Research to Implementation Gap Check

## Objective

Analyze whether the actual codebase implementation matches research papers, documentation, specifications, or architectural claims.

## Workflow

1. **Gather Claims**: Read the source documentation, specifications, ADRs, or research papers.
2. **Inspect Implementation**: Examine the actual code modules, classes, and configurations.
3. **Map Missing Components**: Trace components described in the specifications to the codebase.
4. **Classify Code Status**: Categorize each component into:
   - `implemented`
   - `partial`
   - `conceptual only`
   - `mocked`
5. **Emit Risk Gaps**: Highlight missing critical features, architectural drift, or incomplete integrations.
