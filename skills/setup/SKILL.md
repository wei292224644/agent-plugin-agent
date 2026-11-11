---
name: setup
description: >-
  Install baton plugin npm dependencies so the MCP server can start. Use when
  the user runs /baton:setup, when delegate_task is missing, or when MCP fails
  with ERR_MODULE_NOT_FOUND for @modelcontextprotocol/sdk.
---

# Baton Setup

Plugin install clones the repo and does not run npm install. The MCP process then crashes before `delegate_task` exists. This skill installs dependencies in the plugin directory only.

## Find the plugin root

Do not run npm in the user's project. Use the first directory that contains `scripts/setup.mjs`:

1. `$CLAUDE_PLUGIN_ROOT`
2. `$CURSOR_PLUGIN_ROOT`
3. Two directories above the loaded `skills/setup/SKILL.md`
4. The directory that contains `src/mcp.mjs` on the `ERR_MODULE_NOT_FOUND` stack

If none of these exist, stop and tell the user the plugin root was not found.

## Check

```bash
node "<plugin-root>/scripts/setup.mjs" --json
```

Show the user the `next` field.

## Ask

If `ready` is false, `package` is `baton`, and `npm` is true, ask once. Use AskUserQuestion when it exists. Otherwise ask in the conversation. Put install first:

- `安装依赖 (Recommended)`
- `暂时跳过`

If they skip, show the check output and stop. Do not install.

If they install:

```bash
node "<plugin-root>/scripts/setup.mjs" --install --json
```

Show `next`. Tell them to reload the plugin so MCP can start. Do not start MCP yourself.

If already ready, or npm is missing, do not ask. Show `next`.
