---
name: debugging-methodology
description: A systematic approach to isolating and fixing bugs. Use when investigating a failure, regression, or unexplained behavior before attempting fixes.
tags: debugging, workflow
version: 1
---

# Debugging Methodology

Work the problem in this order — do not skip to a fix.

## 1. Reproduce

Get a reliable, minimal reproduction first. If the bug can't be reproduced,
gather evidence (logs, stack traces, timestamps) until a hypothesis about
the trigger exists.

## 2. Localize

Narrow the search space before reading code in depth: bisect by commit,
by input, or by layer (client vs server vs data). State what is definitely
NOT the cause as you rule things out.

## 3. Understand

Explain the failure mechanism end to end before changing anything. A fix
made without understanding usually moves the bug rather than removing it.

## 4. Fix at the root

Prefer the smallest change that removes the cause, not the symptom. If a
workaround is genuinely required, mark it with a comment and file follow-up
work.

## 5. Verify

Re-run the original reproduction, then the surrounding test suite. Add a
regression test that fails without the fix whenever practical.

## Rules

1. Change one variable at a time; note each experiment and its result.
2. Trust evidence over intuition — verify assumptions with prints, logs, or a debugger.
3. If two hours pass without progress, write down what is known and re-derive hypotheses from scratch.
