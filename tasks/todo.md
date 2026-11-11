# Tasks: failure-summary + plugin-setup

- [x] Task 1: 失败摘要
  - Acceptance: 额度用尽为 `quota_exceeded` 且 summary 不含 HTML/rmcp；普通 `turn.failed` 仍是 `failed`；登录失败仍是 `not_authenticated`
  - Verify: `node --test --test-name-pattern "failure summary"`
  - Files: `src/runner.mjs`, `test/baton.test.mjs`, `skills/baton-orchestrate/SKILL.md`, `skills/baton-rescue/SKILL.md`
- [x] Task 2: `/baton:setup`
  - Acceptance: 检查器不 import SDK；缺依赖先问再装；只在 baton 插件根目录 `npm ci`
  - Verify: `node --test test/setup.test.mjs`
  - Files: `scripts/setup.mjs`, `skills/setup/SKILL.md`, `test/setup.test.mjs`, `README.md`, `README.zh-CN.md`
- [x] Task 3: 版本 `0.2.5`
  - Acceptance: 各插件清单和 `package.json` 都是 `0.2.5`
  - Verify: `npm test`
  - Files: `package.json`, `package-lock.json`, `plugin.json`, `src/mcp.mjs`, 各宿主 `plugin.json` / `marketplace.json`

## Checkpoint: After Tasks 1-3

- [x] `npm test` 全绿（23）
- [x] `node scripts/setup.mjs --json` 打印 `ready: true`
