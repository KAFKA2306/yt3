# Antigravity Audit Rule

Before searching for `.agy`, always verify whether Antigravity CLI (`agy`) is installed.

Mandatory checks:

1. `which agy`
2. `agy --version`
3. `agy --help`
4. `agy /usage`
5. Search `Taskfile`, systemd services, tmux launchers, shell scripts, and cron jobs for `agy`

Never infer that Antigravity is absent merely because `.agy` does not exist.

The canonical runtime identifier is `agy`, not `.agy`.

If `.agy` is not found but `agy` exists, continue investigation using the installed CLI and its integrations.

Failure to check `agy` before concluding Antigravity is absent is considered an audit failure.

## Project Principle

This project treats LLMs not as one-shot text generators, but as components inside an iterative execution and improvement system.

The core design practice is **loop engineering**.

## Layered Terminology

Use the following labels when describing the system:

* 実行層: `agent loop`
* 検証層: `closed-loop agent workflow`
* 継続改善層: `agent improvement loop` / `harness design`

## Definition: Loop Engineering

Loop engineering is the practice of connecting model outputs, tool execution, validation, feedback, evaluation, and implementation changes into a single iterative system.

The objective is not merely to write better prompts, but to continuously improve the **execution harness** around the model.

In this project, the execution harness includes:

* instructions
* tools
* routing
* output requirements
* validation checks
* feedback collection
* evals
* implementation changes
* trace analysis

The LLM should therefore be understood as one part of a broader closed-loop system.

## Core Loop

The agent workflow should follow this loop:

```text
model output
  → tool execution
  → validation
  → feedback
  → evaluation
  → implementation change
  → improved execution harness
  → next model output
```

This loop should continue until the system reaches a final output, a handoff condition, a tool-calling condition, or a defined stopping condition.

## Execution Harness

The execution harness is the surrounding system that constrains, observes, evaluates, and improves the model's behavior.

It is not limited to prompts.

The harness includes:

```text
instructions + tools + routing + output schema + validation + evals + traces + implementation changes
```

When the model fails, do not immediately assume that the model itself is the only problem.

First inspect:

1. Was the instruction underspecified?
2. Was the tool interface ambiguous?
3. Was the output requirement weak?
4. Was validation missing?
5. Was the stopping condition unclear?
6. Was feedback not converted into an implementation change?
7. Was the eval too weak to catch the failure?

## Agent Loop Reference

The agent loop should be interpreted as an execution system with explicit decision points.

A typical loop is:

```text
Call LLM
  → inspect output
  → if final output: stop
  → if handoff: switch agent
  → if tool calls: execute tools
  → append tool results
  → call LLM again
  → stop if max_turns is exceeded
```

The important design point is that tool execution and model reasoning are not separate isolated events.

They are connected inside one controlled loop.

## Tool Use Reference

When the model requests a tool, the application must:

1. detect the tool request
2. execute the requested tool
3. collect the tool result
4. return the result to the model
5. let the model continue reasoning or produce a final answer

The application is responsible for controlling this loop safely.

The model should not be treated as if it directly owns the environment.

## Improvement Flywheel

The system should continuously improve through the following flywheel:

```text
traces
  → feedback
  → evals
  → Codex handoff
  → harness changes
  → better execution harness
  → better future traces
```

Traces reveal where the agent failed.

Feedback explains what was wrong or missing.

Evals make the failure reproducible.

Codex or implementation work converts the lesson into code, validation, routing, prompt, or tool changes.

Harness changes improve the next run.

## Operating Rule

Do not solve recurring failures with ad hoc prompting alone.

For repeated failures, prefer durable harness changes:

* add a validation check
* tighten the output schema
* improve tool descriptions
* add routing rules
* add stopping conditions
* add retry logic
* add eval cases
* improve trace inspection
* modify implementation behavior

## Design Goal

The goal is not:

```text
better prompt
```

The goal is:

```text
better loop
```

A successful system is one where each run produces information that can improve the next run.

## Summary

Loop engineering means designing and improving the iterative system around the LLM.

It is the practice of building a reliable agent loop where:

```text
LLM output → tools → validation → feedback → evals → implementation change
```

becomes a continuous improvement mechanism for the execution harness.
