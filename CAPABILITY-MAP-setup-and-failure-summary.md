# Capability Map: #25 失败摘要 + #26 setup

日期：2026-11-11
状态：已确认

| Module id | Responsibility | Depends on |
|---|---|---|
| failure-summary | #25：失败时 `summary` 显示终止原因；额度用尽为 `quota_exceeded` | — |
| plugin-setup | #26：`/baton:setup` 在插件目录安装 npm 依赖 | — |

Build order: 两模块互不依赖。先 `failure-summary`，再 `plugin-setup`。

Specs:

- `docs/superpowers/specs/2026-11-11-failure-summary-design.md`
- `docs/superpowers/specs/2026-11-11-baton-setup-design.md`
