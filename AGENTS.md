# Cursor adapter

The project instructions stay in `CLAUDE.md` (root and each subproject). This file only maps Claude Code tool names that appear in `.claude/skills/` and `.claude/agents/` onto Cursor. Do not treat those Claude names as callable tools.

Path-scoped conventions live in `.cursor/rules/`. They are the Cursor form of `.claude/rules/`; the bodies are the same. `.cursor/skills` and `.cursor/agents` are symlinks to `.claude/skills` and `.claude/agents`, so there is one copy of each skill and sub-agent.

## Tool map

- `AskUserQuestion` → `AskQuestion`
- `Agent` with `subagent_type` → `Task` with `subagent_type`. `Explore` → `explore`. `general-purpose` → `generalPurpose`. `plan-reader`, `decisions-reader`, `decisions-detail-reader`, `decisions-correlator`, `phases-reader`, and `inventory-digest-reader` keep those names.
- `Skill` → read `.claude/skills/<name>/SKILL.md` (same file as `.cursor/skills/<name>/SKILL.md`)
- `Bash` → `Shell`
- `mcp__context7__query-docs` → the context7 server in `.cursor/mcp.json`. Resolve the library with `resolve-library-id`, then fetch docs with `query-docs`. Match the installed package version.
- `figma:figma-implement-design`, `get_design_context`, `get_metadata`, `get_screenshot` → the connected Figma plugin. Pass only the narrow handoff from the `implement` skill: Figma URL, reused design-system components, server-connected component names, and target paths. If that plugin is not available, follow the fallback already written in `.claude/skills/implement/SKILL.md` (stop the visual-shell step and continue manually).

MCP servers for this repo are `postgres` and `context7` in `.cursor/mcp.json`. Cursor does not read the root `.mcp.json`.
