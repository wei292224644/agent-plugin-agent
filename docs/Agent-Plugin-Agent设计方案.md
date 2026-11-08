# Agent-Plugin-Agent (APA) 架构设计方案
> **基于 MCP 的去中心化多 Agent 算力分发与协同体系**  
> *创建时间：2026-11-06*

---

## 目录
1. [核心理念与设计愿景](#一核心理念与设计愿景)
2. [核心前提：环境与基线的增量统一](#二核心前提环境与基线的增量统一)
3. [为什么选择 MCP 作为核心媒介](#三为什么选择-mcp-作为核心媒介)
4. [关键协议与生态定位对比](#四关键协议与生态定位对比)
5. [系统整体架构设计](#五系统整体架构设计)
6. [核心技术模块详解](#六核心技术模块详解)
7. [标准工具契约 (MCP Tool Interface)](#七标准工具契约-mcp-tool-interface)
8. [MVP 实施路线图](#八mvp-实施路线图)

---

## 一、核心理念与设计愿景

### 1.1 背景痛点
当前的 AI 编码 Agent（如 Claude Code, Cursor CLI, Agy, Codex, Aider 等）能力各有侧重：
- **Claude Code**：全局工程规划、复杂跨文件重构、终端自主调试；
- **Cursor**：代码智能补全、AST 局部重构、毫秒级语法感知；
- **Agy / Gemini**：超长上下文检索、深度前沿技术调研、对抗性代码审查；
- **Aider**：严格的 Git 提交纪律与 Repo-map 映射。

然而，目前各工具之间相互割裂，社区现有的桥接多为 **1 对 1 的单向私有插件**（如 `agy-plugin-cc`），且强制用户适应特定宿主。

### 1.2 核心愿景：Any Agent as Host, Any Agent as Worker
- **去中心化 / 对等架构 (Symmetric Peer-Agent)**：无需第三方中央编排服务；
- **心流不中断 (In-Situ)**：开发者当前在哪个终端/编辑器工作，当前环境就是**主控 Agent (Host)**；
- **算力下沉**：本机安装的其他所有 AI CLI 自动降级为**可调度的子 Agent (Worker)**，随时接受任务委派。

---

## 二、核心前提：环境与基线的增量统一

```
┌─────────────────────────────────────────────────────────────┐
│ 宿主独占层 (Host-Specific Layer)                            │
│  - Cursor AST / Claude Shell Harness / Agy Deep Research    │
├─────────────────────────────────────────────────────────────┤
│ 增量统一基线层 (Unified Base Layer)  <-- 必须全局继承       │
│  - 编码哲学: ponytail (极简主义 / YAGNI / 拒绝过度封装)    │
│  - 输出风格: caveman (去废话 / 高密度直击要点)             │
│  - 工程技能: agent-skills (标准 TDD / 架构审查工作流)       │
│  - 历史记忆: hindsight (项目既定决策与踩坑记录)             │
└─────────────────────────────────────────────────────────────┘
```

> **关键命题**：**“没有环境的增量统一，算力分发就会沦为灾难。”**

### 2.1 认知漂移与失调 (Context Divergence)
如果主控 Agent 遵循极简编码准则（`ponytail`）、具备历史记忆（`hindsight`），但下游被调度的 Cursor/Codex CLI 是裸跑状态：
- 子 Agent 会破坏规范，生成过度抽象的死代码；
- 子 Agent 会重犯历史记录中已明确避开的错误；
- 子 Agent 的冗长回复会冲垮主 Agent 的上下文。

### 2.2 增量统一的落地机制
1. **基线信封动态注入 (Context Envelope Pattern)**：
   在派发任务时，中间层自动提取当前的通用规约与相关记忆，打包成 `[System Baseline]` 强制前置注入下游 CLI 命令。
2. **工作区 `.agents/` 底座规约**：
   项目根目录采用通用的 `.agents/` 目录存放共享 Skills 与规范，各 CLI 运行时通过符号链接（Symlink）或目录回退机制共享同一份逻辑。
3. **特有插件保留**：
   各平台独有的 AST 加速、IDE 视图、专有命令仍然保留在各自宿主中，只统一“认知与行为底座”。

---

## 三、为什么选择 MCP 作为核心媒介

MCP (Model Context Protocol) 是承载 `a-plugin-a` 的最佳工程抓手：

1. **生态最大公约数**：
   主流 Agent（Claude Code, Cursor, Agy, Windsurf 等）均已原生集成 MCP Client。只要输出标准 MCP Server，无需针对每家单独写专用插件。
2. **天然的上下文隔离墙 (Context Sanitization)**：
   子 Agent 在执行过程中产生的终端乱码、进度条字符、内部冗长思考（CoT）被拦截在 MCP Server 内部，仅将提炼后的摘要和代码变更提交给主控，防止上下文爆炸。
3. **解耦的进程生命周期**：
   MCP Server 作为独立守护进程，负责下游 CLI 的进程生成、超时守护、PTY 模拟和硬杀死（Kill），宿主只需关注异步 Tool Call。

---

## 四、关键协议与生态定位对比

| 协议 / 标准 | 主导方 / 载体 | 核心定位 | 在本架构中的角色 |
| :--- | :--- | :--- | :--- |
| **MCP** | Anthropic / 开源 | Agent ↔ 外部工具/数据/服务 | **核心桥接层**：主 Agent 调用 SubAgent 的统一入口。 |
| **CAP** | rsclaw-ai / cap-protocol | Orchestrator ↔ 命令行 AI Agent | **底层驱动借鉴**：提供 PTY 伪终端驱动与非交互模式的最佳实践。 |
| **ACP** | Zed / IDE 厂商 | 编辑器客户端 ↔ 编码 Agent | 外部生态参考：IDE 与 Agent 交互的协议。 |
| **A2A** | Google / Linux Foundation | Agent ↔ Agent 对等长任务协作 | 规范参考：Agent Card 能力声明与异步任务契约。 |

---

## 五、系统整体架构设计

```
[ 任意宿主 Agent (Host) ] (如 Claude Code / Cursor / Agy)
              │
              │  (1) MCP Tool Call: delegate_task(agent="cursor", prompt="...")
              ▼
┌─────────────────────────────────────────────────────────────┐
│               agent-bridge-mcp (本地通用中间件)               │
│                                                             │
│  [宿主自省]                 [算力探测]                      │
│   检测自身运行环境,          扫描本地 $PATH:                │
│   屏蔽本宿主工具 (防死锁)    发现 agy/cursor/claude/codex    │
│                                                             │
│  [基线信封注入 (Envelope)]  [PTY 虚拟终端管理器]            │
│   合并 ponytail/hindsight   管理子进程生命周期、防交互挂死  │
└─────────────────────────────────────────────────────────────┘
              │
              │  (2) 驱动非交互子进程 (如: cursor agent -p "...")
              ▼
┌─────────────────────────────────────────────────────────────┐
│               下游目标 CLI (Worker Agent)                   │
│                                                             │
│  • 执行代码生成与重构                                       │
│  • 直接读写本地工作区文件                                   │
└─────────────────────────────────────────────────────────────┘
              │
              │  (3) 修改落盘 & 进程退出 (Exit Code: 0)
              ▼
┌─────────────────────────────────────────────────────────────┐
│                 工作区事实源 (Git / File System)            │
└─────────────────────────────────────────────────────────────┘
              │
              │  (4) 提取 git diff --stat 与结构化摘要
              ▼
[ 回传精简结果给宿主 Agent ] ──> 宿主 Agent 验收并继续规划
```

---

## 六、核心技术模块详解

### 6.1 宿主自省与防自循环 (Self-Exclusion)
- **机制**：MCP 启动时检查自身父进程名称（`process.ppid`）及相关环境变量。
- **行为**：若宿主为 `claude`，则在返回的工具列表中动态剔除 `delegate_to_claude`，防止主 Agent 错误地陷入自我调用的递归死循环。

### 6.2 CLI 算力自动探测 (Auto-Discovery)
- **机制**：扫描系统环境变量 `$PATH`，动态探测可用命令：
  - `agent` 或 `cursor-agent` $\rightarrow$ 注册 `call_cursor`
  - `agy` $\rightarrow$ 注册 `call_agy`
  - `claude` $\rightarrow$ 注册 `call_claude`
  - `codex` $\rightarrow$ 注册 `call_codex`
- **扩展**：允许在全局配置文件（`~/.agent-bridge/config.json`）中指定自定义 CLI 别名与启动参数。

### 6.3 PTY 伪终端驱动与防卡死保护
- **痛点**：多数 AI CLI 在未连接真实 TTY 时会直接报错，或遇到确认提示符（`[y/n]`）导致子进程静默永久挂起。
- **方案**：
  - 底层使用 `node-pty` / Python `pty` 模拟真实终端环境；
  - 强制追加各 CLI 的静默/非交互参数（如 `-p`, `--yes`, `--headless`, `--output-format stream-json`）；
  - 设置严格的心跳监听与超时断路器（默认 5 分钟无输出直接 SIGKILL）。

### 6.4 基于 Git Diff 的状态收敛
- **严禁**：让下游 Agent 把全量代码通过 stdout 打印回传；
- **提倡**：下游 Agent 具有工作区修改权限，直接操作本地代码文件；
- **交付**：中间件通过执行 `git diff --stat` 和捕获退出状态，生成精炼的交付报告。

---

## 七、标准工具契约 (MCP Tool Interface)

### 7.1 工具定义：`delegate_task`
```json
{
  "name": "delegate_task",
  "description": "将特定编程、调查或审查任务分发给本地其他 AI CLI (如 cursor, agy, claude, codex)",
  "parameters": {
    "type": "object",
    "properties": {
      "target_agent": {
        "type": "string",
        "enum": ["cursor", "agy", "claude", "codex", "aider"],
        "description": "目标子 Agent CLI"
      },
      "prompt": {
        "type": "string",
        "description": "分配给子 Agent 的明确任务描述与边界要求"
      },
      "files": {
        "type": "array",
        "items": { "type": "string" },
        "description": "建议子 Agent 重点关注或修改的文件清单"
      },
      "timeout_seconds": {
        "type": "number",
        "description": "最大运行超时（默认 300 秒）"
      }
    },
    "required": ["target_agent", "prompt"]
  }
}
```

### 7.2 返回数据格式（回传给主 Agent）
```json
{
  "status": "success",
  "target_agent": "cursor",
  "execution_time_seconds": 18.4,
  "summary": "已完成 src/services/auth.ts 的重构，提取了 Token 校验公共函数",
  "git_changes": {
    "files_changed": 2,
    "insertions": 28,
    "deletions": 14,
    "diff_stat": "src/services/auth.ts | 35 +++++++++++++++++++----------------\n src/types/auth.ts    |  7 +++++++\n 2 files changed, 28 insertions(+), 14 deletions(-)"
  }
}
```

---

## 八、MVP 实施路线图

### 第一阶段：CLI 驱动内核与 PTY 封装 (Day 1 - 3)
- 实现基础子进程包装器，支持指定工作区目录运行目标命令；
- 使用 `node-pty` 测试跑通 `cursor agent -p`、`claude -p` 和 `agy run` 的非交互式执行；
- 建立标准的 ANSI 控制符过滤与 Git Diff 采集逻辑。

### 第二阶段：MCP Server 包装与自省 (Day 4 - 6)
- 编写标准 MCP Server，暴露 `delegate_task` 和 `list_available_agents`；
- 加入父进程识别与防自循环逻辑；
- 在 Claude Code 与 Cursor 中分别挂载该 MCP Server，验证双向调用。

### 第三阶段：基线信封 (Base Envelope) 注入 (Day 7 - 10)
- 读取全局 `~/.agents/` 或当前项目的规则（如 `ponytail`、`caveman` 准则）；
- 在任务派发时完成上下文动态拼装与注入，验证子 Agent 行为的一致性；
- 输出完整的安装与分发说明。
