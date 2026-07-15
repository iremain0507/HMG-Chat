// consume-until-abort.ts — P12-T2-03: AbortSignal fan-out 취소 전파(20-MULTI-AGENT-TOOL.md
// §20.4-5). dag-planner/orchestrator-worker 가 격리 runTurn 을 소비할 때, provider 가 signal 을
// 스스로 감시하지 않는 비협조적 구현이어도(실 네트워크가 응답 없이 멈춘 상황과 동등) 부모가
// 취소하면 소비 루프가 다음 이벤트를 기다리지 않고 즉시 중단되도록 매 `.next()` 호출을 abort
// 이벤트와 경합(Promise.race)시킨다.
import { WChatError } from "@wchat/interfaces";
import type { ChatEvent } from "@wchat/interfaces";

export async function consumeUntilAbort(
  events: AsyncIterable<ChatEvent>,
  signal: AbortSignal,
  onEvent: (event: ChatEvent) => void,
): Promise<void> {
  const abortError = () =>
    new WChatError(
      "ABORTED",
      "orchestrator",
      true,
      "상위 취소로 중단되었습니다.",
    );
  if (signal.aborted) throw abortError();

  let onAbort = () => {};
  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });

  const iterator = events[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await Promise.race([iterator.next(), abortPromise]);
      if (next.done) return;
      onEvent(next.value);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
