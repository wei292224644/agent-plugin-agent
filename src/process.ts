export function isAlive(pid: number | null): boolean {
  if (!pid || !Number.isSafeInteger(pid) || pid <= 1) return false;
  // shortcut: PID 复用可能误判，需要更严格身份校验时加入进程启动时间。
  try { process.kill(pid, 0); return true; } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function killGroup(pid: number | null): void {
  if (!pid || !Number.isSafeInteger(pid) || pid <= 1) return;
  try { process.kill(-pid, "SIGKILL"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
