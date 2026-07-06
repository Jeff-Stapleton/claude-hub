---
name: pr-description
description: Write clear pull request titles and descriptions. Use when opening or updating a pull request so reviewers can evaluate the change quickly.
tags: git, github, workflow
version: 1
---

# Pull Request Descriptions

Structure every PR description with these sections:

## Summary

One to three sentences: what changed and why. Lead with the user-visible or
system-visible outcome, not the implementation.

## Changes

A short bullet list of the significant changes, grouped by area. Skip
mechanical noise (formatting, lockfiles) unless it is the point of the PR.

## Testing

How the change was verified: tests added or run, manual steps performed,
environments exercised. "Not tested" is acceptable only with a reason.

## Rules

1. The title follows the same convention as commit messages (imperative, under 72 chars).
2. Link related issues or work items when they exist.
3. Call out breaking changes, migrations, and follow-up work explicitly.
4. If screenshots or logs make review faster, include them.
