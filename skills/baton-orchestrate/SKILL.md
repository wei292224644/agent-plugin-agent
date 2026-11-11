---
name: baton-orchestrate
description: >-
  Opens a host-side orchestrator sub-agent that holds the dependency graph,
  delegates via baton MCP, reviews each job as it finishes, may rework with the
  same session_id, notifies the main session asynchronously, and returns a
  summary. Use for multi-job distribution with or without dependencies — not
  for a single named one-shot rescue (use baton-rescue). Process-agnostic; do
  not require agent-skills, Speckit, or OpenSpec.
---

# Baton Orchestrate

The main session states the goal, then opens a **host background sub-agent** as the orchestrator. That orchestrator owns the plan: dependency graph, `session_id`s, per-job results, and rework counts. Workers remain the local CLIs.

The main session stays free for the user. It does **not** babysit intermediate steps. It only relays stop requests, answers when the orchestrator must ask the user, and takes the final summary.

This is optional. For a single one-shot handoff, keep using `baton-rescue`.

Baton is the transport layer. It does **not** bind any engineering methodology. If the workspace already has `.agents/`, OpenSpec, Speckit, or custom rules, fold them into worker prompts and into the per-job review step; if not, send empty-handed and skip review.

## Roles

| Role | Who | Does |
|---|---|---|
| Host | Current session | Start the orchestrator; relay stop / user answers; receive async per-job notes and the final summary |
| Orchestrator | Host background sub-agent | Hold state; `list_agents`; split; `delegate_task`; `task_wait`; review; rework; dispatch dependents; notify host; summarize |
| Watcher (fallback only) | Same sub-agent by default | Prefer concurrent `task_wait` in one turn on the orchestrator. Spawn a wait-only sub-agent per job only if the host cannot issue multiple tool calls in one turn |
| Reviewer (optional) | Orchestrator, or one sub-agent per finished job | Run project-defined checks; return a short pass/fail + notes. Orchestrator keeps only the conclusion when batches are large |
| Worker | `codex` / `claude` / `gemini` / `agy` / `cursor` | Edit code; must not call baton again |

Orchestration stays on the host side. Do not send a baton worker out to dispatch others (`BATON_DELEGATION` will refuse).

## When to use

Use when:

- The user wants distribution, orchestration, multiple CLIs, or several bounded jobs
- Jobs have dependencies, or the project expects a review gate between dependent jobs
- One goal may need fail-over or same-session rework after a bad run

Do not use (prefer `baton-rescue` or stay in the host):

- The user already named one vendor and wants a single hop
- One or two small edits, explaining a diff, or a question
- `delegate_task` is missing from the tool list → tell the user baton is not connected, then stop

## Two shapes

**Independent jobs** (no edges, only a final summary needed): still use the background orchestrator. Dispatch path-disjoint jobs in parallel, fire concurrent `task_wait`s in the **same** tool-call turn (never serialize waits for jobs that are already running), async-notify the host after each job conclusion, then summarize. Skip per-job review unless the project defines one.

**Dependency graph** (or project requires review between hops): default shape below. Advance **per job**, not per whole batch.

```text
Host  ◄── async note per finished job (do not wait for a reply) ──┐
  │                                                               │
  └── reply only when a decision is required ──► Orchestrator
        (holds graph, session_ids, results, rework counts)
                    │  task_wait → review → pass: dispatch ready dependents
                    │                    → fail: same session_id rework (cap)
                    ▼
              CLI workers (already running in parallel after delegate_task)
```

## Per-job loop (dependency / review shape)

1. Dispatch every job whose dependencies are satisfied and whose paths do not overlap other live jobs (respect max concurrency).
2. For every live `task_id`, start a wait. Independent waits must be issued in the **same** message/turn so a finished job is not stuck behind another `task_wait`.
3. When a job ends:
   - **`needs_decision`:** stop the graph; ask the host (who asks the user); resume with the same `session_id` after the answer. Do not choose for the user.
   - Run the project-defined review if any (see Review). No project review → treat a clean terminal `success` as pass.
   - **Pass:** async-notify the host; mark the node done; dispatch newly unblocked dependents.
   - **Fail / bad review:** rework once (or up to the rework cap) with the **same** `session_id` and a focused fix prompt; then wait again.
   - **`timed_out`:** follow `next`; prefer same `session_id` + larger `timeout_seconds` before switching vendor.
4. When every node is terminal, return one summary: who was used, each status, summaries, `git_changes`, reworks, fail-overs, worktree path/branch if isolated.

## Async notify host

After each job reaches a conclusion (pass, fail-at-cap, cancelled), push a short note to the main session **without waiting for a reply**.

- Prefer the host's native main-session message channel when present (for example Cursor `SendMessage` to the main agent).
- If no such channel exists, keep notes for the final summary and any host-visible progress the platform already provides; do not block the graph on host acknowledgement.

Each note should include: job id, conclusion, changed files, check results, leftover risks.

## When to stop and ask the host

Stop the graph and ask the host (who asks the user). Do **not** decide alone when:

- `needs_decision`
- A worker blocker, after a quick check, needs a plan change
- Rework hits the cap and still fails review
- New dependencies appear that were not in the graph
- Push / open PR / other irreversible publish step is required

Everything else: notify only, keep going.

## Workspace isolation

Prefer an isolated `git worktree` (and branch) for the orchestrated run so the main session can keep editing elsewhere. Report the worktree path and branch in the final summary.

- Preferred: the **host** creates the worktree/branch before starting the orchestrator and puts the path in the brief.
- Allowed: the orchestrator may run `git worktree add` / branch setup for isolation only (not for implementing worker tasks).
- If isolation is unavailable: say so up front, and the **main session must not modify the shared working tree** until the orchestrator finishes or is cancelled.

## Review (project-owned)

Baton only reserves the **slot** after each job ends. What to check comes from workspace rules (diff read, typecheck, unit tests, architecture review, …).

- No review rules in the workspace → skip; a `success` status is enough to unblock dependents.
- Default: orchestrator does not edit product files and does not open a shell to poll baton.
- When the project defines review commands: allow those **read-only / check** commands. Still do not implement the worker's coding task in the orchestrator.
- Isolation setup (`git worktree` / branch) is allowed as above; it is not a substitute for worker edits.
- Large batches: spawn a short-lived reviewer sub-agent per finished job; orchestrator keeps the pass/fail conclusion only.

## How the host starts the orchestrator

1. Say one line: starting an orchestrator sub-agent.
2. Cursor: background Task. Claude Code: background Agent.
3. Hand it the “Orchestrator brief” below (fill in the user goal). The host does not babysit intermediate steps.
4. Accept async per-job notes; answer only when the orchestrator asks.
5. If the user wants to stop: the host `task_cancel`s live `task_id`s and tells the orchestrator.

## Orchestrator brief (give to the sub-agent)

```text
You are a Baton orchestrator, not a worker. You hold the plan state.

Goal:
<user goal verbatim>

Rules:
- Hold: dependency graph, session_id per job, results, rework counts
- Use baton MCP for dispatch/wait/cancel: list_agents, delegate_task, task_wait, task_cancel
- Do not implement worker coding tasks yourself
- Do not open a shell to poll baton; open a shell only for (1) project-defined review/check commands when those rules exist, and (2) optional `git worktree` / branch setup for isolation
- Do not require Speckit / OpenSpec / agent-skills; if the workspace has rules, copy them into worker prompts and follow them for review; otherwise omit and skip review
- Do not delegate to the CLI vendor this host session already is
- Default max 3 jobs running at once; ask the host before going higher
- timeout_seconds defaults to 300 and caps at 1800. Long subtasks must pass timeout_seconds explicitly; check effective_timeout_seconds
- Prefer an isolated git worktree; if you cannot, tell the host the shared tree must stay untouched
- Path-disjoint ready jobs may run in parallel; overlapping paths stay serialized
- Issue concurrent task_wait calls in the same turn for every job already running — never wait A then B when both are live
- Advance per job: wait → review (if defined) → pass: notify host async and dispatch newly ready dependents; fail: same session_id rework up to cap (default 1)
- On timed_out: follow next; prefer same session_id + larger timeout_seconds before switching vendor
- On failed with no useful session: switch vendor once; do not dual-run the same edit without cause
- Async-notify the host after each job conclusion; do not wait for a reply unless a stop-and-ask case applies
- Stop and ask the host for: needs_decision, plan change, rework cap hit, new dependencies, push/PR
- When all jobs are terminal, return one summary: vendors, statuses, summaries, git_changes, reworks, fail-overs, worktree path/branch

Steps:
1. list_agents; only use installed targets
2. Build the dependency graph of bounded subtasks (prompt + files + edges)
3. Pick target_agent per job and say why in one sentence
4. Dispatch all currently ready jobs (respect concurrency + path overlap); keep task_id and session_id
5. Wait concurrently; on each completion run the per-job loop above
6. Summarize when every node is terminal
```

## Picking a vendor (for the orchestrator)

- User named a target → honor it
- Otherwise implementation/debug defaults to `codex`; if the host is already Codex → `claude`
- Research / long context may use `gemini` / `agy`; local edits may use `cursor`
- `not_installed` / `not_authenticated` → try the next vendor; do not stick

## Versus baton-rescue

- One hop, named target, simple handoff → `baton-rescue`
- Split, parallel, dependencies, per-job review, fail-over, summarize → this skill
