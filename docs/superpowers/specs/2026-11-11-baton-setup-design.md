# Spec: `/baton:setup` 安装插件依赖

日期：2026-11-11
状态：已确认
Issue：#26

## Objective

插件市场安装只 clone，不跑 `npm install`。宿主接着执行 `node …/src/cli.mjs mcp`，`src/mcp.mjs` 立刻 import `@modelcontextprotocol/sdk`，进程以 `ERR_MODULE_NOT_FOUND` 退出。`delegate_task` 注册不上。

用户在宿主里跑 `/baton:setup`。它检查插件目录里的依赖，缺了就问一次，同意后只在插件目录安装，然后告诉用户重载插件。

成功标准：没装依赖时 MCP 起不来，但 `/baton:setup` 仍能跑完；用户点一次安装后，插件目录里有 SDK；重载之后 MCP 能启动。

## 已定假设

1. 这一份只覆盖 #26。#25 见 `docs/superpowers/specs/2026-11-11-failure-summary-design.md`。不打 esbuild / ncc bundle，不在 MCP 启动时自动 `npm install`。
2. 形态是 skill，不是 Claude `commands/setup.md`。文件 `skills/setup/SKILL.md`，frontmatter `name: setup`，斜杠命令是 `/baton:setup`。
3. 流程照 `/codex:setup`：先检查；依赖缺失且有 npm 时只问一次；选安装才装；已经装好，或没有 npm，不再问。
4. 两个选项，安装在前，并标 `(Recommended)`：`安装依赖 (Recommended)`、`暂时跳过`。没有 AskUserQuestion 时，在对话里问同样两个选项。
5. 检查器是 `scripts/setup.mjs`，只用 Node 内置模块。不能做成 `node src/cli.mjs setup`：`src/cli.mjs` 顶层 import `./mcp.mjs`，依赖没装时进程进不了子命令。
6. 安装目录是脚本所在仓库根（`scripts/` 的上一级），且 `package.json` 的 `name` 必须是 `baton`。不在用户项目目录里装。
7. 有 `package-lock.json` 时跑 `npm ci --omit=dev`，否则 `npm install --omit=dev`。
8. 就绪 = `node_modules/@modelcontextprotocol/sdk/package.json` 和 `node_modules/zod/package.json` 都在。
9. 装完只提示重载插件。setup 不负责把已经崩溃的 MCP 进程拉起来。
10. skill 正文用英文，和 `baton-rescue` 一样。问用户的那两句用中文。
11. README 中英文安装节各加一句：市场安装之后跑 `/baton:setup`。

## Contract

检查：

```bash
node <plugin-root>/scripts/setup.mjs --json
```

stdout 一个 JSON：

- `plugin_root`：实际检查的目录
- `package`：`package.json` 的 `name`，读不到则为 `null`
- `npm`：`npm --version` 能否成功
- `deps_installed` / `ready`：两个包的 `package.json` 是否都在
- `next`：给用户看的一句中文

`package` 不是 `baton` 时 `ready` 为 false，`next` 说明这不是 baton 插件目录。

安装（仅在用户同意后）：

```bash
node <plugin-root>/scripts/setup.mjs --install --json
```

已经 `ready`，或 `package` 不是 `baton`：不调用 npm，`installed: false`。
否则执行 npm，再检查一次。成功时 `installed: true`，`next` 为「依赖已装上。重载插件，让 MCP 重新启动。」失败时 `installed: false`，带 `error`（npm 输出尾部，最长 2000 字）。

脚本自己以 `import.meta.url` 定位插件根。`--root` 只给测试用。

skill 找脚本的顺序：`$CLAUDE_PLUGIN_ROOT`、`$CURSOR_PLUGIN_ROOT`，然后是本次加载的 `skills/setup/SKILL.md` 再向上两级，最后是报错栈里 `src/mcp.mjs` 的插件目录。找不到就停，不要在当前工作区 `npm install`。

## Commands

```bash
npm test
node --test test/setup.test.mjs
node scripts/setup.mjs --json
```

## Project Structure

- `skills/setup/SKILL.md`：`/baton:setup` 的步骤。
- `scripts/setup.mjs`：检查和安装。不 import SDK，不 import `src/`。
- `test/setup.test.mjs`：检查、拒绝装错目录、安装命令。
- `README.md`、`README.zh-CN.md`：安装节补一句。

## Code Style

沿用仓库 ESM、小函数、早返回。用户可见的 `next` 用中文。不新增依赖。测试用假的 `spawn`，不真的跑 `npm ci`。

## Testing Strategy

`node --test`。断言：

- 空的 baton 目录：`ready` 为 false；假 npm 可用时 `npm` 为 true。
- 放上两个包的 `package.json` 后 `ready` 为 true。
- `package.json` name 不是 `baton` 时，`--install` 不调用 npm。
- 有 lockfile 的 baton 目录，`--install` 的参数是 `ci --omit=dev`，`cwd` 是该目录。
- 没有 lockfile 时参数是 `install --omit=dev`。
- `scripts/setup.mjs` 源码不出现 `@modelcontextprotocol`、`mcp.mjs`、`cli.mjs`。

## Boundaries

- Always：先有失败测试再写 `scripts/setup.mjs`；安装前确认目录名是 `baton`。
- Ask first：为了让宿主拉到新 skill 而升版本号。
- Never：在用户项目里 `npm install`；在 MCP 启动路径里自动安装；把 SDK 打进 bundle 当作本单的做法；让 `src/cli.mjs` 在依赖缺失时承担 setup。

## Success Criteria

- 宿主能通过 `/baton:setup` 打开这份 skill。
- 依赖缺失时，skill 先问再装；跳过则原样展示检查结果，不装。
- `npm test` 通过，且包含上面的断言。
- `node scripts/setup.mjs --json` 在本仓库（依赖已安装）打印 `ready: true`。
- 不改 `src/mcp.mjs` 的启动方式。

## Open Questions

无。版本升到 `0.2.5`，两单一起发。
