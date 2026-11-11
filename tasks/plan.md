# Implementation Plan: failure-summary + plugin-setup

规格：`docs/superpowers/specs/2026-11-11-failure-summary-design.md`、`docs/superpowers/specs/2026-11-11-baton-setup-design.md`  
版本：`0.2.5`  
状态：已完成

## Overview

两模块互不依赖。先改失败摘要，再加 `/baton:setup`。最后把插件版本升到 `0.2.5`，宿主才能拉到新 skill。

## Architecture Decisions

- 摘要和 `quota_exceeded` 只放在 `describe()`。不改 Codex `messageFrom`。
- setup 用 `scripts/setup.mjs`，不走 `src/cli.mjs`。后者顶层 import MCP SDK，依赖没装时进不了子命令。
- 安装目录由脚本自己的路径决定，且 `package.json` name 必须是 `baton`。

## Dependency graph

```
failure-summary (runner + skills)
plugin-setup (script + skill + README)    互不依赖
        \                    /
         version 0.2.5
```

## Risks

| 风险 | 缓解 |
|---|---|
| 成功输出里出现 rate limit 被误判成额度 | 只在 `exitCode !== 0` 时判额度，且排在登录失败之后 |
| setup 装到用户项目 | 脚本拒绝 name 不是 baton 的目录；skill 写明找不到根就停 |
| `src/cli.mjs` 在缺依赖时不能当 setup 入口 | 独立脚本，测试断言源码不引用 SDK |

## Checkpoint

`npm test` 全绿；`node scripts/setup.mjs --json` 在本仓库为 `ready: true`。
