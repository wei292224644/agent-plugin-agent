export const OUTPUT_CONTRACT = [
  "完成前用下面两种结尾之一。标记必须各占一行。",
  "需要用户做选择时停下来，不要猜，也不要继续后面的步骤：",
  "BATON_DECISION",
  "question: <一个问题>",
  "options: <选项A> | <选项B>",
  "BATON_END",
  "",
  "做完时：",
  "BATON_RESULT",
  "summary: <做了什么>",
  "BATON_END",
  "",
  "不要再调用其他 Agent。",
].join("\n");

export function buildPrompt(prompt: unknown, files?: string[]) {
  const focus = files?.length
    ? `Focus on these files:\n${files.map((file) => `- ${file}`).join("\n")}\n\n`
    : "";
  return `${focus}${String(prompt).trim()}\n\n${OUTPUT_CONTRACT}`;
}

export function interpret(text: string | null | undefined): { kind: "decision"; question: string; options: string[] } | { kind: "result"; summary: string } | null {
  if (!text) return null;
  const re = /(?:APA|BATON)_(DECISION|RESULT)\r?\n([\s\S]*?)\r?\n(?:APA|BATON)_END/g;
  let last = null;
  for (const match of text.matchAll(re)) last = match;
  if (!last) return null;
  const body = last[2];
  if (last[1] === "DECISION") {
    const question = body.match(/^question:\s*(.*)$/m)?.[1]?.trim() || "";
    const options = (body.match(/^options:\s*(.*)$/m)?.[1] || "")
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);
    return { kind: "decision", question, options };
  }
  const summary = body.replace(/^summary:\s*/m, "").trim();
  return { kind: "result", summary };
}

