---
name: design-solution
description: Converge on a single recommended solution after brainstorming options. Use when you have multiple candidate approaches and need to analyze trade-offs, select one, and define decision criteria before planning. Triggers on "design solution", "choose approach", "converge on", "evaluate trade-offs", or when ready to pick a single solution from multiple options.
type: skill
---

# Design Solution

Converge from multiple options to a single recommended approach.

## Position in Workflow

Step 3 of development workflow:
1. `/research` - Understand problem and constraints
2. `/brainstorm-solutions` - Explore solution space
3. `/design-solution` - Converge on a single solution (THIS)
4. Plan, code, review, ship

## Core Principle

**Decide deliberately.** Evaluate trade-offs, align to constraints, and pick the best fit.

## Input

**Default:** Use the options from the current conversation.

**If argument provided:**
- File path: Read the file for brainstorming output
- GitHub issue: Fetch with `gh issue view $ARG --comments`

## Workflow
