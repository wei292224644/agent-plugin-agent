# Baton 品牌改名设计

日期：2026-11-09  
状态：待实现

## 问题

当前产品叫 APA（Agent-Plugin-Agent），安装串为 `apa@apa`。存在三点问题：

1. marketplace 与 plugin 叠同一缩写，读感怪
2. APA 易与「美国心理学会」撞车，且不表达产品含义
3. 全称 Agent-Plugin-Agent 像结构描述，不像产品名；核心价值是「把有边界的活交给另一家本地 Agent CLI」

## 目标名

| 角色 | 值 |
|------|-----|
| 显示名 | Baton |
| 一句话 | 把一块有边界的工作交给另一家本地 Agent CLI（交接棒） |
| 插件 / package / MCP / CLI bin | `baton` |
| marketplace `name` | `agent-plugin-agent` |
| Skill | `baton-rescue`（目录 `skills/baton-rescue/`） |
| 防递归环境变量 | `BATON_DELEGATION`（值 `"1"`） |

### 安装写法（Claude / Codex 等）

```text
/plugin marketplace add wei292224644/agent-plugin-agent
/plugin install baton@agent-plugin-agent
```

约定说明：

- `marketplace add` 使用 GitHub `owner/repo`
- `plugin install` 使用 `插件名@marketplace名`（与 addyosmani/agent-skills 同一约定）

本地开发安装示例同样改为 `baton@agent-plugin-agent`（marketplace 指向本仓库时）。

## 范围

### 会改

- 根与各端 `plugin.json`、`marketplace.json`、MCP 配置（`.mcp.json`、`.cursor-mcp.json`、`.codex-mcp.json`、`mcp_config.json`、`gemini-extension.json` 等）中的 `apa` / `APA`
- `package.json` / `package-lock.json`：`name`、`bin.baton`
- `src/mcp.mjs`：MCP server `name`
- `src/runner.mjs` 及测试：`APA_DELEGATION` → `BATON_DELEGATION`，相关失败文案
- `skills/apa-rescue/` → `skills/baton-rescue/`（含 `SKILL.md` 的 `name` 与正文）
- `test/apa.test.mjs` → `test/baton.test.mjs`（及断言）
- `README.md`、`README.zh-CN.md`、`docs/Agent-Plugin-Agent设计方案.md` 中的品牌与安装示例
- 用户可见文案中的 APA / Agent-Plugin-Agent → Baton（设计文档标题可改为 Baton，并注明曾用名 APA）

### 故意不动

- MCP 工具名：`delegate_task`、`list_agents`（行为未变）
- GitHub 仓库名：暂保持 `agent-plugin-agent`（安装第一行依赖此路径）
- 工具参数与返回状态语义

### 兼容策略

- **不做** `apa` / `APA_DELEGATION` 运行时别名；视为 breaking rename
- 版本升到 `0.2.0`；README 注明旧安装串 `apa@apa` 失效
- marketplace `owner.name` 改为 `wei292224644`（与 GitHub 源一致）

## 非目标

- 不改派工协议、adapter、会话续跑逻辑
- 不在本次改名中重命名 GitHub 仓库
- 不新增功能

## 验收

1. 仓库内用户可见与配置入口不再出现产品名 `APA` / 插件 id `apa`（历史设计文档中的「曾用名」说明除外）
2. 文档安装示例为 `baton@agent-plugin-agent`
3. `npm test` 通过；防递归用例断言 `BATON_DELEGATION`
4. CLI 入口为 `baton`（`package.json` bin）

## 实现顺序建议

1. 配置与 package / bin / env 符号
2. skill 目录与测试重命名
3. 源码字符串与 MCP server name
4. README 与设计文档
5. 跑测试并人工扫一遍残留 `apa`/`APA`
