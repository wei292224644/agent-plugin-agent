import { start } from "../../src/tasks.ts";
const result = await start({ target: "codex", prompt: "parent lifetime", cwd: process.cwd() });
process.stdout.write(`${JSON.stringify(result)}\n`);
setInterval(() => {}, 1000);
