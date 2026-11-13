---
name: baton-orchestrate
description: >-
  Runs several bounded jobs across local agent CLIs through the baton CLI:
  holds the dependency graph, dispatches ready jobs, advances each job as it
  finishes, reviews, reworks in the same conversation, and returns a summary.
  Use for multi-job distribution with or without dependencies — not for a
  single named one-shot rescue (use baton-rescue). Process-agnostic; do not
  require agent-skills, Speckit, or OpenSpec.
---

# Baton Orchestrate

One orchestrator holds the plan: dependency graph, `task_id` per job, results, and rework counts. Workers are the local CLIs. Every job runs in its own detached process with state on disk under `~/.baton`, so jobs survive the orchestrator, this session, or an MCP restart.

Baton is the transport layer. It does **not** bind any engineering methodology. If the workspace already has `.agents/`, OpenSpec, Speckit, or custom rules, fold them into worker prompts and into the per-job review step; if not, send empty-handed and skip review.

For a single one-shot handoff, use `baton-rescue`. Its sections "The command", "Wait", and "After it stops" define the commands and statuses used here.

## The command

```
node <plugin-root>/src/cli.ts <command> ...
```

`<plugin-root>` is the directory that contains `src/cli.ts`. Below, `baton` means this command (or `baton` itself if it is on `PATH`). Every command prints one JSON object. The same operations exist as MCP tools; use MCP only when the host cannot run shell commands.

## Who orchestrates

- If the host can run a background sub-agent, the orchestrator may run there so the main session stays free. Give it the brief below.
- Otherwise the main session runs the loop itself. Nothing in baton requires a sub-agent.

Orchestration stays on the host side. Do not ask a baton worker to dispatch others (`BATON_DELEGATION` refuses it).

## When to use

Use when:

- The user wants distribution, orchestration, multiple CLIs, or several bounded jobs
- Jobs have dependencies, or the project expects a review gate between dependent jobs
- One goal may need fail-over or rework after a bad run

Do not use (prefer `baton-rescue` or stay in the host):

- The user already named one vendor and wants a single hop
- One or two small edits, explaining a diff, or a question

## Per-job loop

1. `baton agents`; use only installed targets.
2. Build the graph of bounded jobs (prompt, files, edges). Pick a target per job and say why in one sentence.
3. `baton start` every job whose dependencies are satisfied and whose paths do not overlap another live job. Default max 3 running at once; ask before going higher.
4. Wait on all live jobs at once:
   ```
   baton wait <id1> <id2> <id3> --for 50
   ```
   It returns the first job that left `running`, or `{status: "running", tasks: [...]}` after 50 seconds. Repeat. Never wait on jobs one after another.
5. When a job stops:
   - **`needs_input`:** pause dependents of that job; ask the user (through the host) `decision.question` and `decision.options` unchanged; then `baton reply <id> --as human --prompt "<answer>"`. Answer with the default `--as host` only when earlier user instructions already decide it.
   - Run the project-defined review if any. No project review: a clean `success` is a pass.
   - **Pass:** notify the host; mark the node done; start newly unblocked dependents.
   - **Review fails after `success`:** rework in the same conversation with `baton reply <id> --prompt "<focused fix>"`, up to the rework cap (default 1); then wait again.
   - **`failed` / `timed_out`:** the task is closed. Start a new task for the same job, either the same vendor with a larger `--idle-timeout` (for `timed_out`) or the next vendor once (for `failed`). Do not dual-run the same edit without cause.
   - **`not_installed` / `not_authenticated`:** try the next vendor.
   - **`quota_exceeded`:** stop and ask the host before switching vendor.
6. While jobs are `running`, `liveness` tells you whether each is `active`, `quiet` (alive, silent for `quiet_for_s`), or `orphaned` (supervisor died; finalized as `failed` on the next read). `reply` on a running job returns `busy`.
7. When every node is terminal, return one summary: vendors, statuses, summaries, `git_changes`, reworks, fail-overs, worktree path/branch if isolated.

Tell the user they can watch any job with `baton tail -f <id>` and list them with `baton ls`.

## Notify the host

After each job conclusion (pass, fail at cap, cancelled), push a short note to the main session without waiting for a reply, if the host has a channel for that (for example `SendMessage(to: "main", ...)` in Claude Code or Cursor). Otherwise keep the notes for the final summary. Each note: job, conclusion, changed files, check results, leftover risks.

## Stop and ask the host

Do **not** decide alone when:

- A job is in `needs_input` and earlier instructions do not decide it
- A worker blocker needs a plan change
- Rework hits the cap and still fails review
- New dependencies appear that were not in the graph
- `quota_exceeded`
- Push / open PR / any other irreversible publish step is required

Everything else: notify and keep going.

## Workspace isolation

Prefer an isolated `git worktree` (and branch) so the main session can keep editing elsewhere; pass it to workers with `baton start --cwd <worktree>`. The host creates it before starting, or the orchestrator runs `git worktree add` for isolation only. If isolation is unavailable, say so up front: the main session must not modify the shared tree until the run ends or is cancelled.

## Review (project-owned)

Baton only reserves the slot after each job ends. What to check comes from workspace rules (diff read, typecheck, unit tests, …). The orchestrator may run those read-only check commands, but does not implement the worker's coding task. Large batches: one short-lived reviewer per finished job; keep only its pass/fail conclusion.

## Orchestrator brief (give to the sub-agent, or follow it yourself)

```text
You are a Baton orchestrator, not a worker. You hold the plan state.

Goal:
<user goal verbatim>

Rules:
- Command: node <plugin-root>/src/cli.ts (agents, start, wait, status, tail, reply, cancel, ls)
- Hold: dependency graph, task_id per job, results, rework counts
- Do not implement worker coding tasks yourself
- Do not require Speckit / OpenSpec / agent-skills; if the workspace has rules, copy them into worker prompts and use them for review; otherwise skip review
- Do not delegate to the CLI vendor this host session already is
- Max 3 jobs running at once unless the host approves more
- Use --effort low for mechanical subtasks; raise --idle-timeout for slow, silent models
- Honor the user's --model selection; model and effort persist across replies. Cursor needs an explicit model for --effort (see cursor-agent models); unsupported combinations fail
- Path-disjoint ready jobs may run in parallel; overlapping paths stay serialized
- Wait on all live jobs together with `wait <ids...> --for 50`, repeating; never wait one job after another
- needs_input: ask the host unless earlier instructions decide it; relay the answer with `reply --as human`
- Review failed after success: `reply` with a focused fix, up to cap (default 1)
- failed / timed_out: start a new task (larger --idle-timeout, or next vendor once)
- Notify the host after each job conclusion; ask only for the stop-and-ask cases
- When all jobs are terminal, return one summary: vendors, statuses, summaries, git_changes, reworks, fail-overs, worktree path/branch
```

## Picking a vendor

- User named a target: honor it
- Otherwise implementation/debug defaults to `codex`; if the host is already Codex, `claude`
- Long-context reading may use `agy`; local edits may use `cursor`
- `not_installed` / `not_authenticated`: try the next vendor; do not stick

## Versus baton-rescue

- One hop, named target, simple handoff: `baton-rescue`
- Split, parallel, dependencies, per-job review, fail-over, summary: this skill
