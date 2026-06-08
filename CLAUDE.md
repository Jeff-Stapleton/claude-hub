# Claude Code Compatibility

Cursor rules are the canonical agent guidance for this repo:

- `.cursor/rules/project-architecture.mdc`
- `.cursor/rules/typescript-store-conventions.mdc`
- `.cursor/rules/verification-and-safety.mdc`

Claude Code auto-loads this file, so keep it as a compatibility shim. If working in Claude Code, follow the Cursor rules above.

Claude Code is now one supported runtime provider behind `@claude-hub/agent-runner`; it is no longer the only agent brain for the hub.
