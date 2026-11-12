# Baton

**English** | [简体中文](README.zh-CN.md)

> Decentralized local AI Agent bridge: **Any Agent as Host, Any Agent as Worker**.  
> Your current CLI or IDE acts as the Host, delegating bounded coding tasks to other installed local Agent CLIs (Workers) via a standard MCP tool, directly spending their respective subscription quotas. The runner assembles sanitized arguments and safe execution environments so models never have to string together fragile shell commands.

Supported platforms: `claude` (Claude Code), `agy` (Antigravity), `codex` (Codex CLI / App), `cursor` (Cursor Agent CLI / IDE), and `gemini` (Gemini CLI).

---

## Table of Contents

- [How It Works](#how-it-works)
- [Installation](#installation)
  - [Prerequisites](#prerequisites)
  - [Claude Code](#claude-code)
  - [Antigravity (agy)](#antigravity-agy)
  - [Codex CLI](#codex-cli)
  - [Codex App](#codex-app)
  - [Cursor (Agent CLI & IDE)](#cursor-agent-cli--ide)
  - [Gemini CLI](#gemini-cli)
  - [Generic MCP Clients (Claude Desktop / Windsurf / etc.)](#generic-mcp-clients-claude-desktop--windsurf--etc)
- [Verify Installation](#verify-installation)
- [Workflows & Usage](#workflows--usage)
  - [In-Host Auto Delegation (Rescue Skill)](#in-host-auto-delegation-rescue-skill)
  - [Direct CLI Usage](#direct-cli-usage)
  - [Interactive Decisions & Session Resumption (needs_decision)](#interactive-decisions--session-resumption-needs_decision)
  - [Progress While the Worker Runs](#progress-while-the-worker-runs)
- [Underlying Calling Conventions](#underlying-calling-conventions)
- [Safety & Deadlock Prevention](#safety--deadlock-prevention)
- [Manual Smoke Testing](#manual-smoke-testing)
- [Development & Testing](#development--testing)

---

## How It Works

```
[ Active Terminal / Editor (Host) ] (e.g. Claude Code / Cursor / Agy)
              │
              │  (1) MCP Tool Call: delegate_task(target_agent="codex", prompt="...")
              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Baton (Local Peer Bridge / MCP)             │
│                                                             │
│  • Injects safety envelopes (BATON_DELEGATION=1)            │
│  • Formats target-specific CLI flags (non-interactive/JSON) │
│  • Manages sub-process lifecycle & timeout watchdogs        │
└─────────────────────────────────────────────────────────────┘
              │
              │  (2) Drives target CLI (e.g.: codex exec --json ...)
              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Target Execution (Worker Agent)             │
│                                                             │
│  • Consumes target platform's own subscription/tokens       │
│  • Reads and writes local workspace files directly          │
└─────────────────────────────────────────────────────────────┘
              │
              │  (3) Changes committed to disk & process exits
              ▼
[ Extract git diff & structured summary ] ──> Returns to Host to continue flow
```

- **Zero Extra API Keys**: Seamlessly reuses existing authenticated sessions and subscriptions in each installed CLI.
- **Context Sanitization**: Worker internal chains-of-thought (CoT), terminal control characters, and progress bars are trapped inside the bridge layer; only clean summaries and `git diff` statistics are passed back to the Host.
- **Session Preservation**: When a Worker encounters a branching decision or prompt, it returns the questions and options alongside a `session_id`, allowing the user to choose and resume without losing context.

---

## Installation

Installation differs by harness. Simply copy and paste the commands for your preferred Host environment below.

### Prerequisites

1. **Node.js** >= 18
2. At least one supported Agent CLI installed and logged in locally (`codex`, `claude`, `agy`, `cursor`, or `gemini`).
3. After a marketplace install, run `/baton:setup` in the host session. Marketplace install does not run `npm install`; without this step MCP exits because `@modelcontextprotocol/sdk` is missing.
4. (Optional) If installing from local source or developing:
   ```bash
   git clone https://github.com/wei292224644/agent-plugin-agent.git
   cd agent-plugin-agent
   npm install
   ```

---

### Claude Code

Claude Code supports plugins via its plugin marketplace.

#### Remote One-Click Install (Recommended)

Run directly in your system terminal:

```bash
claude plugin marketplace add https://github.com/wei292224644/agent-plugin-agent
claude plugin install baton@agent-plugin-agent
```

Or inside an active `claude` session using Slash commands:

```text
/plugin marketplace add https://github.com/wei292224644/agent-plugin-agent
/plugin install baton@agent-plugin-agent
```

#### Local Checkout Install

From inside your local `agent-plugin-agent` directory:

```bash
claude plugin marketplace add .
claude plugin install baton@agent-plugin-agent
```

---

### Antigravity (agy)

Antigravity natively discovers plugins and auto-loads their skills.

#### Remote One-Click Install (Recommended)

Run in your terminal:

```bash
agy plugin install https://github.com/wei292224644/agent-plugin-agent
```

#### Local Checkout Install

From inside your local `agent-plugin-agent` directory:

```bash
agy plugin install .
```

> **Update**: Re-running the same install command updates the plugin to the latest version.

---

### Codex CLI

Codex CLI supports adding plugin marketplaces and registering MCP tools.

#### Terminal Command Install

Run in your system terminal:

```bash
codex plugin marketplace add https://github.com/wei292224644/agent-plugin-agent
codex plugin add baton@agent-plugin-agent
```

#### Interactive TUI Install

Inside an interactive `codex` session:

```text
/plugins
```

Search for `baton` and select `Install Plugin`.

#### Local Checkout Install

From inside your local `agent-plugin-agent` directory:

```bash
codex plugin marketplace add .
codex plugin add baton@agent-plugin-agent
```

---

### Codex App

For the Codex desktop application:

1. Open Codex App and navigate to **Plugins** in the sidebar.
2. Search for `Baton` (or add custom marketplace source: `https://github.com/wei292224644/agent-plugin-agent`).
3. Click **Install**.

---

### Cursor (Agent CLI & IDE)

#### Cursor Agent CLI Install

Cursor's official Agent CLI accepts Git repositories:

```bash
agent plugin marketplace add https://github.com/wei292224644/agent-plugin-agent
agent plugin install baton@agent-plugin-agent
```

Or in the Cursor Agent chat window:

```text
/add-plugin baton
```

#### Cursor IDE (MCP Mode)

If using the Cursor editor interface, configure it directly as an MCP server.

In your project's `.cursor/mcp.json` (or global Cursor MCP Settings):

```json
{
  "mcpServers": {
    "baton": {
      "command": "node",
      "args": ["<ABSOLUTE_PATH_TO_REPO>/src/cli.mjs", "mcp"]
    }
  }
}
```

---

### Gemini CLI

Gemini CLI uses an extension system.

#### Remote Install

Run in your terminal:

```bash
gemini extensions install https://github.com/wei292224644/agent-plugin-agent
```

#### Local Link Mode (For development)

From inside your local `agent-plugin-agent` directory:

```bash
gemini extensions link .
```

#### Update Extension

```bash
gemini extensions update baton
```

---

### Generic MCP Clients (Claude Desktop / Windsurf / etc.)

Baton exposes a standard Stdio MCP server compatible with any MCP client (including Claude Desktop, Windsurf, Zed, Cline, Roo Code).

Add the following to your client's MCP configuration JSON:

```json
{
  "mcpServers": {
    "baton": {
      "command": "node",
      "args": ["<ABSOLUTE_PATH_TO_REPO>/src/cli.mjs", "mcp"]
    }
  }
}
```

---

## Verify Installation

Verify installed agent harnesses and path detection at any time with:

```bash
node src/cli.mjs agents
```

Example output:

```json
[
  {
    "id": "codex",
    "installed": true,
    "bin": "/opt/homebrew/bin/codex",
    "version": "codex-cli 0.166.0"
  },
  {
    "id": "claude",
    "installed": true,
    "bin": "/Users/user/.local/bin/claude",
    "version": null
  },
  {
    "id": "agy",
    "installed": true,
    "bin": "/Users/user/.local/bin/agy",
    "version": "1.5.3"
  },
  {
    "id": "cursor",
    "installed": true,
    "bin": "/Users/user/.local/bin/cursor-agent",
    "version": "2026.11.05-86047df"
  },
  {
    "id": "gemini",
    "installed": true,
    "bin": "/Users/user/.npm-global/bin/gemini",
    "version": "0.67.0"
  }
]
```

Only agents with `"installed": true` can be targeted for delegation.

---

## Workflows & Usage

### In-Host Auto Delegation (Rescue Skill)

Once installed, your Host Agent automatically registers:

- [skills/setup/SKILL.md](skills/setup/SKILL.md): `/baton:setup`, install npm dependencies into the plugin directory
- [skills/baton-rescue/SKILL.md](skills/baton-rescue/SKILL.md): one-shot rescue + wait
- [skills/baton-orchestrate/SKILL.md](skills/baton-orchestrate/SKILL.md): optional orchestration — background agent holds the graph, per-job review, async host notes, rework / fail-over, summarize (not tied to Speckit / OpenSpec / agent-skills)

Whenever a complex refactor, debugging task, or second opinion is needed, or whenever you say:
> "Rescue this refactoring task to Codex"  
> "Delegate this debugging run to Claude"

Your Host Agent invokes `delegate_task`. That call returns after the worker process is alive, not after the task is finished. The main session then starts a background sub-agent whose only job is `task_wait`. The host wakes the main session when that sub-agent finishes.

For multi-CLI distribution, use `baton-orchestrate`: the host opens an orchestrator sub-agent that holds the plan, advances per job (wait → project review → dispatch dependents), notifies the main session asynchronously, and calls baton MCP. Baton is the transport; process/methodology stays with the workspace.

**Default Routing Rules**:
- Named target (e.g., "give this to Codex"): Dispatches to requested agent.
- Unnamed target: Defaults to `codex` for implementation and debugging.
- Host is already Codex: Automatically falls back to `claude`.
- **Self-Exclusion**: Never delegates to the active Host.

---

### Direct CLI Usage

You can also trigger task delegations directly from the command line:

```bash
# 1. Discover available local agents
node src/cli.mjs agents

# 2. Delegate a task to a specific target
node src/cli.mjs delegate --target claude --prompt "Reply pong only, do not modify files"

# 3. Specify timeout (seconds) and target files
node src/cli.mjs delegate --target codex --prompt "Refactor auth and add unit tests" --file src/auth.ts --timeout 600

# 4. Pipe task from standard input (stdin)
cat prompt.txt | node src/cli.mjs delegate --target agy

# 5. Inspect, wait for, or cancel a worker. Pass --task <id> when several are running here
node src/cli.mjs status
node src/cli.mjs wait --task <id>
node src/cli.mjs cancel

# 6. Start MCP server (stdio mode)
node src/cli.mjs mcp
```

---

### Interactive Decisions & Session Resumption (needs_decision)

`delegate_task` accepts the following arguments:
- `target_agent`: `codex` | `claude` | `gemini` | `agy` | `cursor`
- `prompt`: Standalone, self-contained task specification
- `files`: (Optional) Key file paths to focus on
- `timeout_seconds`: Execution timeout (default 300s, max 1800s). Returns `effective_timeout_seconds` after clamping. On `timed_out`, `summary` includes the worker output tail and `next` tells the host to resume with the same `session_id` and a larger timeout.
- `session_id`: (Optional) Previous session ID for conversation resumption

**Return Status (`status`)**:
- `success`: Task completed successfully. Contains `summary`, `session_id`, and `git_changes` (files changed, insertions, deletions).
- `needs_decision`: Worker encountered an ambiguous choice or confirmation prompt. Returns `question`, `options`, and `session_id`. The Host presents the question to you; once you reply, the Host calls `delegate_task` **with the same `session_id`** to continue in the same session.
- `failed` / `timed_out` / `not_installed` / `not_authenticated`: Execution halted. Returns failure details; Host halts execution.
- `cancelled`: The host stopped the worker with `task_cancel`.

### Progress While the Worker Runs

`delegate_task` starts the worker and returns only once that process is still alive:

- `status: "running"` means the child agent is up. The payload includes `task_id`, the target, how long it has been running, and any output already printed. `session_id` is filled only after the worker CLI prints one. Resume still uses `session_id`, not `task_id`.
- A worker that exits immediately (bad login, crash on startup) returns `failed` or `not_authenticated` in that same call. It is not reported as running.
- The same workspace can run more than one delegation at a time. The caller decides whether those tasks would write the same files. Each call returns its own `task_id`.
- `task_wait` with a `task_id` blocks until that worker finishes, then returns the final result (`success`, `needs_decision`, `failed`, `timed_out`, `cancelled`). An already finished task returns immediately. A status file still marked `running` with no in-process task fails immediately instead of hanging. While the MCP call waits, it sends a progress notification about every 15 seconds.
- `task_wait_any` with `task_ids` blocks until any one of the specified tasks finishes and returns that task's final result (with `task_id`). Orchestrators use this to advance jobs one by one without batch-join blocking.
- `task_status` with a `task_id` is a peek: elapsed time, the latest output tail, `last_output_at`, and `git_changes` so far while that worker runs. Streaming JSON keeps the latest complete message; otherwise the raw stdout tail is used. When it has exited, the same call returns the final result. Without `task_id`, it follows the only live worker in this directory. If several are live, it returns `status: "running"` plus a `tasks` list (`task_id`, `target_agent`, `duration_ms`). Wait with `task_wait`. Do not poll `task_status`.
- `task_cancel` with a `task_id` kills that process and returns `cancelled`. Without `task_id`, it cancels the only live worker. If several are live, it cancels none and returns `failed` with `task_ids`.

---

## Underlying Calling Conventions

Baton handles CLI flag nuances across all supported targets:

| Agent | Initial Invocation Command | Session Resumption (`--resume`) | Critical Notes |
| :--- | :--- | :--- | :--- |
| **Codex** | `codex exec --json --color never --approve-for-me --cd <cwd> -` | `codex exec resume --json <thread_id> -` | `--approve-for-me` already uses the workspace-write sandbox and conflicts with `--sandbox` on codex-cli 0.167.0. `exec resume` does not accept `--sandbox`, `--cd`, or `--color`. Never add `--ephemeral`. |
| **Claude Code** | `claude -p --output-format json --permission-mode acceptEdits --permission-prompts none` | Appends `--resume <session_id>` | Runs in headless non-interactive mode. |
| **Gemini** | `gemini -p <prompt> --output-format json --skip-trust --approval-mode auto_edit` | Appends `--resume <session_id>` | Skips trust prompts with auto-edit approval. |
| **Antigravity (agy)** | `agy --print <prompt> --mode accept-edits --output-format json` | Appends `--conversation <conversation_id>` | Automatically accepts edits in print mode. |
| **Cursor** | `agent --print --force --trust --output-format json --workspace <cwd>` | Appends `--resume <session_id>` | Prefers `cursor-agent` or `agent` CLI over IDE `cursor` executable. |

---

## Safety & Deadlock Prevention

1. **Anti-Recursion Protection (`BATON_DELEGATION=1`)**: Child processes inherit `BATON_DELEGATION=1`. If a downstream agent tries to invoke Baton again, the bridge immediately rejects with `failed`, preventing infinite recursive loops (A -> B -> A).
2. **PTY Simulation & Watchdogs**: Hardened timeout handlers prevent hung child processes when commands wait on interactive user prompts.

---

## Manual Smoke Testing

Run this quick test in an isolated Git repository:

1. **Check Environment**:
   ```bash
   node src/cli.mjs agents
   ```
   Ensure target agent shows `"installed": true`.
2. **Minimal Delegation**:
   ```bash
   node src/cli.mjs delegate --target claude --prompt "Reply with the single word pong only, do not change any file"
   ```
   Verify `status: "success"`, `git_changes.files_changed: 0`, and note the returned `session_id`.
3. **Session Resumption**:
   Resume using the returned `session_id`:
   ```bash
   node src/cli.mjs delegate --target claude --session <session_id> --prompt "What was the word I just told you to reply?"
   ```
   Verify it answers correctly from memory.
4. **Account Ineligibility Check**:
   If Gemini accounts have migrated to Antigravity, Gemini may return `IneligibleTierError` (`not_authenticated`). Use `agy` on such systems.

---

## Development & Testing

Unit tests test argument construction and error states safely **without spending real model tokens**:

```bash
# Run unit tests
npm test
```

Test coverage includes:
- Safe argument array construction (off-shell)
- Resume command flag compatibility per CLI
- Missing binaries, auth errors, timeouts, parallel delegations in one workspace, and recursive re-entry prevention
- Git porcelain diff parsing

---

Formerly **Agent-Plugin-Agent (APA)**. The old install string `apa@apa` no longer works; use `baton@agent-plugin-agent`.
