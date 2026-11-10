# Baton

[English](README.md) | **简体中文**

> 本地去中心化 AI Agent 算力桥：**Any Agent as Host, Any Agent as Worker**。  
> 当前使用的 CLI/IDE 作为主控（Host），通过统一的标准 MCP 工具把有边界的代码任务委派给本机安装的其他 Agent CLI（Worker），直接消耗对方订阅里的额度。运行器自动拼装合规参数与执行环境，模型无需拼接脆弱的 shell 命令。

支持的目标平台：`claude` (Claude Code)、`agy` (Antigravity)、`codex` (Codex CLI / App)、`cursor` (Cursor Agent CLI / IDE)、`gemini` (Gemini CLI)。

---

## 目录 (Table of Contents)

- [核心工作原理](#核心工作原理)
- [安装指南 (Installation)](#安装指南-installation)
  - [前置要求](#前置要求)
  - [Claude Code](#claude-code)
  - [Antigravity (agy)](#antigravity-agy)
  - [Codex CLI](#codex-cli)
  - [Codex App](#codex-app)
  - [Cursor (Agent CLI 与 IDE)](#cursor-agent-cli-与-ide)
  - [Gemini CLI](#gemini-cli)
  - [通用 MCP 客户端 (Claude Desktop / Windsurf 等)](#通用-mcp-客户端-claude-desktop--windsurf-等)
- [验证安装](#验证安装)
- [使用方法与工作流](#使用方法与工作流)
  - [宿主内自动救援 (Rescue 技能)](#宿主内自动救援-rescue-技能)
  - [命令行直接调用 (CLI)](#命令行直接调用-cli)
  - [交互式决断与会话续接 (needs_decision)](#交互式决断与会话续接-needs_decision)
  - [子 Agent 跑起来之后](#子-agent-跑起来之后)
- [各平台底层调用规范](#各平台底层调用规范)
- [安全机制与防死锁设计](#安全机制与防死锁设计)
- [手工冒烟测试](#手工冒烟测试)
- [开发与单元测试](#开发与单元测试)

---

## 核心工作原理

```
[ 当前主控终端 / 编辑器 (Host) ] (如 Claude Code / Cursor / Agy)
              │
              │  (1) 调用 MCP 工具: delegate_task(target_agent="codex", prompt="...")
              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Baton (本地对等桥接器 / MCP)                 │
│                                                             │
│  • 注入基线与安全信封 (BATON_DELEGATION=1 防递归死锁)         │
│  • 自动格式化目标 CLI 专有参数 (非交互/JSON输出/无沙箱逃逸) │
│  • 子进程生命周期管控与超时守护                             │
└─────────────────────────────────────────────────────────────┘
              │
              │  (2) 驱动目标 CLI (如: codex exec --json ...)
              ▼
┌─────────────────────────────────────────────────────────────┐
│                 目标执行端 (Worker Agent)                   │
│                                                             │
│  • 消耗目标平台的独立订阅/Token 额度                         │
│  • 直接读写本地工作区文件                                   │
└─────────────────────────────────────────────────────────────┘
              │
              │  (3) 修改落盘 & 进程退出
              ▼
[ 提取 git diff 与结构化结果 ] ──> 回传主控继续心流
```

- **零额外 API Key**：直接复用本地各家 CLI 已登录的认证会话与订阅额度。
- **上下文防污染**：Worker 的冗长思考（CoT）、交互式控制字符与进度条被拦截在桥接层内部，仅回传精炼结论与 `git diff` 统计。
- **会话持久保持**：如果 Worker 遇到分叉决策或需要确认，原样回传交互选项并保留 `session_id`，用户做出选择后无缝续接。

---

## 安装指南 (Installation)

不同开发工具的插件与扩展管理方式不同。根据你常用的宿主（Host），直接复制对应的指令即可完成安装。

### 前置要求

1. **Node.js** >= 18
2. 本地已安装并登录至少一个受支持的 Agent CLI（如 `codex`、`claude`、`agy`、`cursor`、`gemini`）。
3. （可选）如果你打算以源码方式本地安装或二次开发，先克隆本仓库并安装依赖：
   ```bash
   git clone https://github.com/wei292224644/agent-plugin-agent.git
   cd agent-plugin-agent
   npm install
   ```

---

### Claude Code

Claude Code 原生支持通过插件市场进行扩展。

#### 远程一键安装（推荐）

在系统终端中运行：

```bash
claude plugin marketplace add https://github.com/wei292224644/agent-plugin-agent
claude plugin install baton@agent-plugin-agent
```

或者在已开启的 `claude` 交互终端内直接输入 Slash 命令：

```text
/plugin marketplace add https://github.com/wei292224644/agent-plugin-agent
/plugin install baton@agent-plugin-agent
```

#### 本地克隆安装

在克隆好的 `agent-plugin-agent` 目录下执行：

```bash
claude plugin marketplace add .
claude plugin install baton@agent-plugin-agent
```

---

### Antigravity (agy)

Antigravity 原生支持插件系统与技能自动加载。

#### 远程一键安装（推荐）

在终端中直接运行：

```bash
agy plugin install https://github.com/wei292224644/agent-plugin-agent
```

#### 本地克隆安装

在克隆好的 `agent-plugin-agent` 目录下执行：

```bash
agy plugin install .
```

> **更新**：重新执行一次相同的安装指令即可覆盖更新到最新版本。

---

### Codex CLI

Codex 命令行支持通过插件体系注册并接入 MCP。

#### 终端命令安装

在系统终端中运行：

```bash
codex plugin marketplace add https://github.com/wei292224644/agent-plugin-agent
codex plugin add baton@agent-plugin-agent
```

#### 交互式安装

在 `codex` 交互界面中输入：

```text
/plugins
```

搜索 `baton`，然后选择 `Install Plugin`。

#### 本地克隆安装

在克隆好的 `agent-plugin-agent` 目录下执行：

```bash
codex plugin marketplace add .
codex plugin add baton@agent-plugin-agent
```

---

### Codex App

适用于 Codex 桌面客户端：

1. 打开 Codex App，点击左侧边栏的 **Plugins**。
2. 搜索 `Baton`（或点击添加自定义市场源：`https://github.com/wei292224644/agent-plugin-agent`）。
3. 点击 **Install** 确认安装。

---

### Cursor (Agent CLI 与 IDE)

#### Cursor Agent CLI 终端安装

Cursor 官方 Agent CLI 支持直接添加 Git 地址：

```bash
agent plugin marketplace add https://github.com/wei292224644/agent-plugin-agent
agent plugin install baton@agent-plugin-agent
```

或者在 Cursor Agent 聊天框中输入：

```text
/add-plugin baton
```

#### Cursor IDE (MCP 模式配置)

如果你主要使用 Cursor 编辑器窗口，可将其作为 MCP 服务器挂载：

在项目根目录 `.cursor/mcp.json`（或全局 Cursor 设置中的 MCP 配置）中添加：

```json
{
  "mcpServers": {
    "baton": {
      "command": "node",
      "args": ["<仓库绝对路径>/src/cli.mjs", "mcp"]
    }
  }
}
```

---

### Gemini CLI

Gemini CLI 采用扩展（Extensions）系统。

#### 远程安装

在终端中执行：

```bash
gemini extensions install https://github.com/wei292224644/agent-plugin-agent
```

#### 本地链接模式（推荐用于本地开发）

在克隆好的 `agent-plugin-agent` 目录下执行：

```bash
gemini extensions link .
```

#### 扩展更新

```bash
gemini extensions update baton
```

---

### 通用 MCP 客户端 (Claude Desktop / Windsurf 等)

本仓库提供标准的 MCP Stdio 协议服务，可以接入任何兼容 MCP 的客户端（例如 Claude Desktop、Windsurf、Zed、Cline、Roo Code）。

在宿主的 MCP 配置文件中添加：

```json
{
  "mcpServers": {
    "baton": {
      "command": "node",
      "args": ["<仓库绝对路径>/src/cli.mjs", "mcp"]
    }
  }
}
```

---

## 验证安装

无论使用哪种安装方式，均可在本地运行探测命令，快速核实本机已正确识别的 Agent 算力：

```bash
node src/cli.mjs agents
```

输出示例：

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

只有 `installed: true` 的 Agent 才可以作为下发目标。

---

## 使用方法与工作流

### 宿主内自动救援 (Rescue 技能)

安装插件后，宿主 Agent 会自动加载 [skills/baton-rescue/SKILL.md](skills/baton-rescue/SKILL.md) 技能。

在日常对话中，当遇到需要换环境实现、局部跨文件排错，或你直接对宿主说：
> “把这个重构任务 rescue 给 Codex 做”  
> “交给 Claude 跑一下测试并修复”

宿主 Agent 会调用 `delegate_task`。这一次返回发生在子进程还活着的时候，而不是等任务做完。主会话随即开一个后台子 Agent，调用 `task_wait` 守到结束。结束由宿主的子 Agent 完成通知送回。

**路由规则**：
- 用户指定了目标（如“交给 codex”）：直接派给指定 Agent。
- 用户未指名：默认将实现与排错派给 `codex`。
- 如果当前会话本身已经是 Codex：自动转派给 `claude`。
- **严禁派给自己**：绝不向当前宿主自身派发任务。

---

### 命令行直接调用 (CLI)

除了作为 MCP 工具供模型调度外，你也可以在终端直接使用 CLI：

```bash
# 1. 查看本机检测到的 Agent 列表
node src/cli.mjs agents

# 2. 直接委派任务给指定 Agent
node src/cli.mjs delegate --target claude --prompt "只回复 pong，不要改文件"

# 3. 指定超时时间 (秒) 与关联文件
node src/cli.mjs delegate --target codex --prompt "重构 auth 逻辑并补全单元测试" --file src/auth.ts --timeout 600

# 4. 从标准输入 (stdin) 读取提示词
cat prompt.txt | node src/cli.mjs delegate --target agy

# 5. 查看、守着或停掉派工。同一目录有多单时带上 --task <id>
node src/cli.mjs status
node src/cli.mjs wait --task <id>
node src/cli.mjs cancel

# 6. 启动标准 MCP 服务 (stdio 模式)
node src/cli.mjs mcp
```

---

### 交互式决断与会话续接 (needs_decision)

`delegate_task` 工具包含以下参数：
- `target_agent`: `codex` | `claude` | `gemini` | `agy` | `cursor`
- `prompt`: 独立、自洽的任务描述
- `files`: （可选）子任务需要重点关注的文件路径列表
- `timeout_seconds`: 超时时间（默认 300 秒，上限 1800 秒）
- `session_id`: （可选）前次任务的会话 ID，用于会话续接

**返回状态 (`status`)**：
- `success`: 任务成功。附带 `summary`、`session_id`、`git_changes`（修改文件数、增删行数）。
- `needs_decision`: 目标 Agent 遇到了不确定的分支选择。返回包含 `question`、`options` 与 `session_id`。宿主会将问题和选项呈现给用户；得到用户选择后，**携带同一个 `session_id` 再次调用 `delegate_task`**，目标 Agent 即可在原上下文中继续推进。
- `failed` / `timed_out` / `not_installed` / `not_authenticated`: 异常中断。附带错误摘要，宿主停止下发。
- `cancelled`: 宿主用 `task_cancel` 停掉了这一单。

### 子 Agent 跑起来之后

`delegate_task` 先把子进程拉起来。进程还活着，才返回：

- `status: "running"` 表示子 Agent 已经启动。返回里有 `task_id`、目标、已运行时长，以及已经打出来的输出。`session_id` 要等对方 CLI 自己打印出来才有。续接仍用 `session_id`，不用 `task_id`。
- 进程马上退出（没登录、一启动就崩）时，同一次调用直接返回 `failed` 或 `not_authenticated`，不会说已经跑起来。
- 同一个工作区可以同时跑多单。会不会改到同一批文件，由调用方自己判断。每一单有自己的 `task_id`。
- 带 `task_id` 的 `task_wait` 守到这一单结束，返回最终结果（`success`、`needs_decision`、`failed`、`timed_out`、`cancelled`）。已经结束的一单立刻返回。落盘仍是 `running`、但当前进程里没有这单时，立刻失败，不挂起。MCP 调用在等待期间约每 15 秒发一次进度通知。
- 带 `task_id` 的 `task_status` 只看一眼：进行中返回时长、最近输出和目前的 `git_changes`，结束后返回最终结果。不传 `task_id` 时，这个目录只有一单在跑才看那一单。有多单在跑时返回 `status: "running"` 和 `tasks` 清单（`task_id`、`target_agent`、`duration_ms`）。等结束用 `task_wait`，不要轮询 `task_status`。
- 带 `task_id` 的 `task_cancel` 杀掉该进程并返回 `cancelled`。不传 `task_id` 时，只有一单在跑才停它。有多单在跑时一单都不停，返回 `failed` 和 `task_ids`。

---

## 各平台底层调用规范

Baton 抹平了各家 CLI 的交互差异与参数格式，避免模型胡乱拼接 shell 产生安全隐患：

| Agent | 首次调用命令规范 | 会话续接 (Resume) 规范 | 关键注意项 |
| :--- | :--- | :--- | :--- |
| **Codex** | `codex exec --json --color never --approve-for-me --cd <cwd> -` | `codex exec resume --json <thread_id> -` | `--approve-for-me` 已使用 workspace-write 沙箱，且在 codex-cli 0.167.0 上与 `--sandbox` 互斥。`exec resume` 不接受 `--sandbox`、`--cd`、`--color`。严禁加 `--ephemeral`。 |
| **Claude Code** | `claude -p --output-format json --permission-mode acceptEdits --permission-prompts none` | 追加 `--resume <session_id>` | 走非交互 `-p` 模式并静默确认。 |
| **Gemini** | `gemini -p <prompt> --output-format json --skip-trust --approval-mode auto_edit` | 追加 `--resume <session_id>` | 跳过可信提示，开启自动编辑确认。 |
| **Antigravity (agy)** | `agy --print <prompt> --mode accept-edits --output-format json` | 追加 `--conversation <conversation_id>` | 自动接受代码变更。 |
| **Cursor** | `agent --print --force --trust --output-format json --workspace <cwd>` | 追加 `--resume <session_id>` | 优先定位 `cursor-agent` 或 `agent` CLI，不调用 IDE 宿主 `cursor` 命令。 |

---

## 安全机制与防死锁设计

1. **防递归死锁标记 (`BATON_DELEGATION=1`)**：子进程启动时自动注入环境变量 `BATON_DELEGATION=1`。若下游 Agent 试图再次调用 Baton 桥，桥接层直接拦截并返回 `failed`，防止 A 调 B、B 又调 A 的无限死循环。
2. **真实 TTY 与超时断路器**：严格实施超时守护与挂起检测，防止子进程因等待交互输入而永久静默挂起。

---

## 手工冒烟测试

推荐在一个独立的临时 Git 仓库中测试整套链路：

1. **检查环境可用性**：
   ```bash
   node src/cli.mjs agents
   ```
   确认需要测试的目标平台 `installed: true`。
2. **单次极简派工验证**：
   ```bash
   node src/cli.mjs delegate --target claude --prompt "只回复一个词 pong，不要改动任何文件"
   ```
   验证返回 `status: "success"`，`git_changes.files_changed` 为 0，并记录返回的 `session_id`。
3. **会话上下文续接验证**：
   携带上一步获得的 `session_id` 再次派发：
   ```bash
   node src/cli.mjs delegate --target claude --session <上步返回的 session_id> --prompt "我上一句让你回复的词是什么？"
   ```
   确认其能够基于原上下文正确回答。
4. **账号就绪排查**：
   若 Gemini 账号已升级或迁移至 Antigravity，可能会遇到 `IneligibleTierError`（状态为 `not_authenticated`），此时在当前机器上使用 `agy` 目标即可。

---

## 开发与单元测试

本项目的单元测试严格进行参数组装与隔离验证，**不消耗真实模型额度**：

```bash
# 运行单元测试
npm test
```

测试覆盖：
- 参数拼装安全规范（严格脱离脆弱 shell 字符串拼接）
- 各 Agent 的首次调度与 resume 参数规范差异
- 缺少二进制、未鉴权、同一工作区多单并行、超时断路器与防重入递归拦截
- Git 脏状态与 Diff 解析精度

---

曾用名：**Agent-Plugin-Agent (APA)**。旧安装串 `apa@apa` 已失效，请使用 `baton@agent-plugin-agent`。
