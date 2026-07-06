---
name: conventional-commits
description: Write commit messages in the Conventional Commits format. Use when committing changes so history stays machine-parseable and changelogs can be generated.
tags: git, workflow
version: 1
---

# Conventional Commits

Format every commit message as:

```
<type>(<optional scope>): <description>

<optional body>

<optional footer>
```

## Types

- `feat` — a new feature visible to users
- `fix` — a bug fix
- `refactor` — code change that neither fixes a bug nor adds a feature
- `docs` — documentation only
- `test` — adding or correcting tests
- `chore` — build process, tooling, dependencies
- `perf` — performance improvement

## Rules

1. Use the imperative mood in the description ("add", not "added" or "adds").
2. Keep the first line under 72 characters.
3. Scope is the affected area (a package, module, or feature name), lowercase.
4. Mark breaking changes with `!` after the type/scope and a `BREAKING CHANGE:` footer explaining the migration.
5. One logical change per commit — split unrelated changes into separate commits.
