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
│  • Injects safety envelopes (BATON_DELEGATION=1 lock)       │
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
3. (Optional) If installing from local source or developing:
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

Once installed, your Host Agent automatically registers [skills/baton-rescue/SKILL.md](skills/baton-rescue/SKILL.md).

Whenever a complex refactor, debugging task, or second opinion is needed, or whenever you say:
> "Rescue this refactoring task to Codex"  
> "Delegate this debugging run to Claude"

Your Host Agent invokes `delegate_task`. That call returns after the worker process is alive, not after the task is finished. The host then uses `task_status` for progress and the final result.

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

# 5. Check the worker in this directory, or cancel it
node src/cli.mjs status
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
- `timeout_seconds`: Execution timeout (default 300s, max 1800s)
- `session_id`: (Optional) Previous session ID for conversation resumption

**Return Status (`status`)**:
- `success`: Task completed successfully. Contains `summary`, `session_id`, and `git_changes` (files changed, insertions, deletions).
- `needs_decision`: Worker encountered an ambiguous choice or confirmation prompt. Returns `question`, `options`, and `session_id`. The Host presents the question to you; once you reply, the Host calls `delegate_task` **with the same `session_id`** to continue in the same session.
- `failed` / `timed_out` / `not_installed` / `not_authenticated` / `busy`: Execution halted. Returns failure details; Host halts execution.
- `cancelled`: The host stopped the worker with `task_cancel`.

### Progress While the Worker Runs

`delegate_task` starts the worker and returns only once that process is still alive:

- `status: "running"` means the child agent is up. The payload includes `task_id`, the target, how long it has been running, and any output already printed. `session_id` is filled only after the worker CLI prints one. Resume still uses `session_id`, not `task_id`.
- A worker that exits immediately (bad login, crash on startup) returns `failed` or `not_authenticated` in that same call. It is not reported as running.
- `task_status` does not take the workspace lock. While the worker runs it returns elapsed time, the latest output tail, and `git_changes` so far. When the worker exits it returns the same final result `delegate_task` used to wait for (`success`, `needs_decision`, `failed`, `timed_out`).
- `task_cancel` kills that process and returns `cancelled`. One workspace still runs one delegation at a time.

---

## Underlying Calling Conventions

Baton handles CLI flag nuances across all supported targets:

| Agent | Initial Invocation Command | Session Resumption (`--resume`) | Critical Notes |
| :--- | :--- | :--- | :--- |
| **Codex** | `codex exec --json --color never --sandbox workspace-write --approve-for-me --cd <cwd> -` | `codex exec resume --json <thread_id> -` | `exec resume` does not accept `--sandbox`, `--cd`, or `--color`. Never add `--ephemeral`. |
| **Claude Code** | `claude -p --output-format json --permission-mode acceptEdits --permission-prompts none` | Appends `--resume <session_id>` | Runs in headless non-interactive mode. |
| **Gemini** | `gemini -p <prompt> --output-format json --skip-trust --approval-mode auto_edit` | Appends `--resume <session_id>` | Skips trust prompts with auto-edit approval. |
| **Antigravity (agy)** | `agy --print <prompt> --mode accept-edits --output-format json` | Appends `--conversation <conversation_id>` | Automatically accepts edits in print mode. |
| **Cursor** | `agent --print --force --trust --output-format json --workspace <cwd>` | Appends `--resume <session_id>` | Prefers `cursor-agent` or `agent` CLI over IDE `cursor` executable. |

---

## Safety & Deadlock Prevention

1. **Workspace Concurrency Lock**: Only one delegated sub-task runs in a given workspace at any time, preventing concurrent write collisions.
2. **Anti-Recursion Protection (`BATON_DELEGATION=1`)**: Child processes inherit `BATON_DELEGATION=1`. If a downstream agent tries to invoke Baton again, the bridge immediately rejects with `busy`, preventing infinite recursive loops (A -> B -> A).
3. **PTY Simulation & Watchdogs**: Hardened timeout handlers prevent hung child processes when commands wait on interactive user prompts.

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
- Missing binaries, auth errors, timeouts, busy state, and recursive re-entry prevention
- Git porcelain diff parsing

---

Formerly **Agent-Plugin-Agent (APA)**. The old install string `apa@apa` no longer works; use `baton@agent-plugin-agent`.
