---
name: baton-orchestrate
description: >-
  Opens a host-side orchestrator sub-agent that picks local CLIs, splits work,
  delegates via baton MCP (delegate_task, task_wait, task_cancel), may
  re-dispatch on failure, and returns a summary. Use when the user wants
  multi-CLI distribution, orchestration, or parallel bounded tasks — not for a
  single named one-shot rescue (use baton-rescue). Process-agnostic; do not
  require agent-skills, Speckit, or OpenSpec.
---

# Baton Orchestrate

The main session only states the goal. Open a **host background sub-agent** as the orchestrator. The orchestrator picks CLIs, splits work, delegates, waits, fails over when needed, then summarizes. Workers remain the local CLIs.

This is optional. For a single one-shot handoff, keep using `baton-rescue`.

Baton is the transport layer. It does **not** bind any engineering methodology. If the workspace already has `.agents/`, OpenSpec, Speckit, or custom rules, fold them into worker prompts; if not, send empty-handed.

## Roles

| Role | Who | Does |
|---|---|---|
| Host | Current session | Start the orchestrator sub-agent; relay stop requests; receive the summary |
| Orchestrator | Host background sub-agent | `list_agents`, split tasks, `delegate_task`, `task_wait`, fail over, summarize |
| Watcher | Same sub-agent, or one per job | Only `task_wait`; if that tool is missing, the orchestrator waits itself |
| Worker | `codex` / `claude` / `gemini` / `agy` / `cursor` | Edit code; must not call baton again |

Orchestration stays on the host side. Do not send a baton worker out to dispatch others (`BATON_DELEGATION` will refuse).

## When to use

Use when:

- The user wants distribution, orchestration, multiple CLIs, or several bounded jobs in parallel
- One goal may need splitting across vendors, or fail-over after a bad run

Do not use (prefer `baton-rescue` or stay in the host):

- The user already named one vendor and wants a single hop
- One or two small edits, explaining a diff, or a question
- `delegate_task` is missing from the tool list → tell the user baton is not connected, then stop

## How the host starts the orchestrator

1. Say one line: starting an orchestrator sub-agent.
2. Cursor: background Task. Claude Code: background Agent.
3. Hand it the “Orchestrator brief” below (fill in the user goal). The host does not babysit intermediate steps; it takes the final summary.
4. If the user wants to stop: the host `task_cancel`s live `task_id`s and tells the orchestrator.

## Orchestrator brief (give to the sub-agent)

```text
You are a Baton orchestrator, not a worker.

Goal:
<user goal verbatim>

Rules:
- Use only baton MCP: list_agents, delegate_task, task_wait, task_cancel
- Do not edit repo files yourself; do not open a shell to poll
- Do not require Speckit / OpenSpec / agent-skills; if the workspace already has rules, copy them into worker prompts, otherwise omit
- Do not delegate to the CLI vendor this host session already is
- Default max 3 jobs running at once; ask the host before going higher
- Default on failure: switch vendor once; do not dual-run the same edit without cause
- Serialize jobs that would touch overlapping paths; path-disjoint jobs may run in parallel
- After each running job, task_wait until it ends (same session in order, or spawn a watcher whose only job is task_wait)
- needs_decision: return question/options to the host, wait for the user, then resume with the same session_id; do not choose for the user
- When all jobs are terminal, return one summary: who was used, each status, summary, git_changes, any fail-overs

Steps:
1. list_agents; only use installed targets
2. Split into bounded subtasks (self-contained prompt + suggested files each)
3. Pick target_agent and say why in one sentence
4. delegate_task; keep task_id
5. task_wait; on failed/timed_out, re-dispatch the same subtask once to another vendor
6. Summarize after every job is terminal
```

## Picking a vendor (for the orchestrator)

- User named a target → honor it
- Otherwise implementation/debug defaults to `codex`; if the host is already Codex → `claude`
- Research / long context may use `gemini` / `agy`; local edits may use `cursor`
- `not_installed` / `not_authenticated` → try the next vendor; do not stick

## Versus baton-rescue

- One hop, named target, simple handoff → `baton-rescue`
- Split, parallel, fail-over, summarize → this skill
