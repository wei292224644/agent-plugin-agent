# Baton 调度代理（轻编排）

日期：2026-11-10  
状态：MVP 已落地 skill（worktree / 写入锁延后）

## Problem Statement

How Might We：本机主控只下目标，由一层调度代理选 CLI、拆派、再派并汇总，而不做成高自控的事件型超级 Agent，也不绑死任何工程方法论？

## Recommended Direction

**技能先行的调度代理（流程无关）。**

- **运输层（Baton）**：任意宿主 ↔ 本机各家 CLI；`delegate_task` / `task_wait` / `task_cancel`。不认「你是不是在跑 SDD / Speckit / OpenSpec」。
- **方法层**：来自工作区已有材料（`.agents/`、OpenSpec、Speckit、自研规约，或什么都没有）。有则塞进信封；没有就空手派工。
- **调度代理**：宿主自己的后台子 Agent，角色 = orchestrator：`list_agents` → 拆任务 → 多次 `delegate_task` → 守候/`task_wait` → 汇总。工人仍是各家 CLI。
- **不学 dsh 的域模型**：不要 Trigger / Eval / Ticket / Mandate / 面板；只学 orchestrator vs worker 的角色分工。

一句话：**Baton = 多 CLI 的总线；流程 = 乘客自带的行李。** 总线管安全与生命周期，不管航线图。

## Key Assumptions to Validate

- [ ] 主控把「选哪家」交给代理后，本机自用仍可接受
- [ ] 调度代理在**宿主侧**调 baton，不被 `BATON_DELEGATION` 误伤
- [ ] 多单并行时，靠代理 prompt 里的路径边界暂时够用（暂不加写入锁）
- [ ] 「方法信封可空」不会让工人比现在更差（现在本也就很少强制方法）

## MVP Scope

- 新可选 skill：`baton-orchestrate`（示范怎么调度，**不是**强制方法论）
- 调度代理 prompt 模板：目标、禁止/允许路径、最多派几家、失败是否换家、是否并行
- 沿用现有 MCP 工具，不改协议
- 文档写清：orchestrator（宿主子 Agent）≠ worker（CLI）；信封内容由工作区决定，默认可空
- README 一句：Baton 不绑定 agent-skills / Speckit / OpenSpec

## Not Doing (and Why)

- 绑定 agent-skills / Speckit / OpenSpec 为默认流程 — 会把桥做成教派插件，换流程就要换产品
- dsh 式 Source / Eval / Mandate / 面板 — 自控过高，本机不需要
- 新中央编排服务 — 违背 In-Situ
- worker CLI 内再挂 baton 深递归 — 已有防死锁；MVP 调度只发生在宿主侧
- 写入范围锁 / 排队策略 — 以后再加；先靠代理 prompt
- 把「调度」做成必装核心路径 — 单跳 `baton-rescue` 仍是合法默认用法

## Open Questions（MVP 默认）

- 调度代理模型：跟主控同模型
- 再派第二家：默认失败换家，不无故双跑
- 最大并发：默认 3；要更多问主控
- worktree 隔离：延后

## 和现状的关系

| 已有 | 角色 |
|---|---|
| `baton-rescue` | 单跳派工 + 守候 |
| `task_wait` | 宿主子 Agent 守一单 |
| `skills/baton-orchestrate/` | 多跳调度：选家、拆派、再派、汇总 |

单调感来自「只有一跳派工」，用编排 skill 加厚用法；不必先加 Engine。
