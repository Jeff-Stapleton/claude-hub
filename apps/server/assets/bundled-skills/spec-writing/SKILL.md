---
name: spec-writing
description: Turn a feature request into a concise implementation spec. Use when planning a feature or writing a design document before code is written.
tags: planning, docs
version: 1
---

# Spec Writing

Turn a request into a spec with these sections, in order:

## Problem

What need or defect prompted this work, in the requester's terms. If the
request is ambiguous, state the interpretation being used.

## Proposal

The chosen approach, described at the level of components and data flow.
Name the files, modules, or services that change. Mention alternatives only
when the choice between them is genuinely contested.

## Scope

- **In scope** — the concrete deliverables.
- **Out of scope** — adjacent work explicitly deferred, so reviewers don't
  assume it's included.

## Risks & open questions

Anything that could invalidate the approach: unknowns, migrations,
performance cliffs, third-party constraints.

## Verification

How we will know it works: tests, manual checks, metrics.

## Rules

1. Keep it short enough to read in five minutes; link out for background.
2. Prefer concrete nouns over abstractions — name real files and endpoints.
3. A spec is done when a competent teammate could implement it without asking you anything.
