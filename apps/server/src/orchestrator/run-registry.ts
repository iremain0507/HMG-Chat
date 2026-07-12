// run-registry.ts — abort flow (L06, 08-SPRINT-PLAN.md § Phase 2).
// 프로세스 내 sessionId → 진행 중인 run 의 AbortController 매핑.
// DELETE /sessions/:id/active-run (routes/sessions.ts) 이 여기서 controller 를 찾아 abort() 한다.
export interface ActiveRunHandle {
  sessionId: string;
  jobId: string;
  controller: AbortController;
}

const registry = new Map<string, ActiveRunHandle>();

export function registerRun(sessionId: string, jobId: string): ActiveRunHandle {
  const handle: ActiveRunHandle = {
    sessionId,
    jobId,
    controller: new AbortController(),
  };
  registry.set(sessionId, handle);
  return handle;
}

export function unregisterRun(sessionId: string, jobId: string): void {
  const current = registry.get(sessionId);
  if (current && current.jobId === jobId) {
    registry.delete(sessionId);
  }
}

// Stop 클릭 → true(진행 중이던 run 을 찾아 abort() 호출), 없으면 false.
export function abortRun(sessionId: string): boolean {
  const handle = registry.get(sessionId);
  if (!handle) return false;
  handle.controller.abort();
  return true;
}
