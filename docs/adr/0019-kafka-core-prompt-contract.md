# ADR-0019: Kafka Core Prompt Contract for Visual Identity

## Status

Accepted

## Context

ASMR thumbnail prompts were drifting because each project repeated the full visual description from scratch. That made the identity bloated, created prompt drift, and blurred the line between the fixed Kafka core and the per-project scene logic.

What we actually need is not a giant reusable prompt, but a **small immutable core** plus a **scene-specific variable layer**.

## Decision

Define a single reusable **Kafka Core Prompt Contract** and manage it in ADR as the source of truth for all visual generation.

### Fixed Core

The following traits must remain stable across every visual asset:

- light-blue hair
- silver triangle hairpin
- blue-purple eyes with slight tiredness
- quiet emotional futurism / observational loneliness

### Variable Layer

Only the following elements may change per project:

- outfit
- pose
- background
- lighting
- mood
- camera distance / framing

### Usage Rule

1. Keep the core prompt short and unchanged.
2. Inject only the scene-specific variables for each thumbnail.
3. Do not restate the full identity block in every prompt.
4. If a project needs a new visual trait, add it to ADR first before using it broadly.
5. Keep the reusable core under one short block; do not let it grow into a scene template.

## Consequences

- Brand consistency becomes easier to preserve.
- Individual thumbnails stay focused on the story hook instead of prompt bloat.
- Visual identity updates become auditable instead of being scattered across prompts and scripts.
