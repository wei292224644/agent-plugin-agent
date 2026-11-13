export type Target = "codex" | "claude" | "agy" | "cursor";
export type Effort = "low" | "medium" | "high" | "ultra";
export type TaskStatus = "running" | "needs_input" | "success" | "failed" | "timed_out" | "cancelled" | "not_installed" | "not_authenticated" | "quota_exceeded";
export type Author = "host" | "human";
export type TaskMeta = {
  task_id: string;
  target: Target;
  cwd: string;
  created_at: string;
  updated_at: string;
  status: TaskStatus;
  turn: number;
  session_id: string | null;
  reasoning_effort?: Effort;
  idle_timeout_s: number;
  max_duration_s: number | null;
  supervisor_pid: number | null;
  child_pid: number | null;
  heartbeat_at: string | null;
  last_event_at: string | null;
  decision?: { question: string; options: string[] };
  summary?: string;
  warning?: string;
};
export type EventData =
  | { type: "turn_started"; author: Author; prompt_preview: string }
  | { type: "message"; text: string }
  | { type: "tool_call"; name: string; detail: string }
  | { type: "tool_result"; name: string; ok: boolean; detail: string }
  | { type: "raw"; stream: "stdout" | "stderr"; line: string }
  | { type: "error"; text: string }
  | { type: "turn_ended"; status: TaskStatus; exit_code: number | null };
export type BatonEvent = { ts: string; turn: number } & EventData;
export type SpawnSpec = {
  command: string;
  args: string[];
  stdin: string | null;
  lastMessagePath?: string;
  warning?: string;
};
export type Adapter = {
  id: Target;
  resolve(env: NodeJS.ProcessEnv): string | null;
  build(input: { bin: string; cwd: string; prompt: string; sessionId: string | null; reasoningEffort: Effort | null }): SpawnSpec;
  parseLine(line: string): BatonEvent[] | null;
  sessionIdFrom(line: string): string | null;
  isAuthFailure(text: string): boolean;
};
export type GitChanges = { files_changed: number; insertions: number; deletions: number; diff_stat: string };
export type Turn = { turn: number; author: Author; prompt: string; files?: string[]; status: TaskStatus; summary?: string; git_changes?: GitChanges };
