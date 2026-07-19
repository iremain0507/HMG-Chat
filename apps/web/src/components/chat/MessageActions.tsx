"use client";

// components/chat/MessageActions.tsx — P10-T6-03 hover 액션바.
// 복사(마크다운 원문) / 재생성(assistant 전용) / 👍👎 피드백.
// P19-T6-07: sessionId/messageId 가 주어지면 피드백이 서버(P19-T1-07)에 영속된다
// (낙관적 업데이트 후 서버 응답으로 확정, 실패 시 롤백). 둘 다 없으면(예: 기존 테스트)
// 로컬 표시 전용으로 남는다.
import React, { useRef, useState } from "react";
import { copyText } from "../../lib/clipboard";
import { sendMessageFeedback } from "../../lib/messageFeedback";
import { useDismiss } from "../../hooks/useDismiss";
import { useSpeechSynthesis } from "../../hooks/useSpeechSynthesis";
import type { StreamMessageMeta } from "../../hooks/useSessionStream";

export function MessageActions({
  role,
  content,
  sessionId,
  messageId,
  meta,
  onRegenerate,
  onEdit,
  onDelete,
}: {
  role: "user" | "assistant";
  content: string;
  sessionId?: string;
  messageId?: string;
  meta?: StreamMessageMeta;
  onRegenerate?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  // P20-T6-05 — 삭제는 실수 방지를 위해 두 번 클릭(확인) 필요. 첫 클릭은 확인 상태로만
  // 전환하고, 확인 상태에서 다시 클릭해야 실제 onDelete 를 호출한다.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // P20-T6-06 — 생성 메타(Info): stop ChatEvent.usage(토큰)·message_start~stop 경과시간을
  // 클릭 시에만 노출하는 팝오버(항상 보이면 hover 액션바가 번잡해짐).
  const [showInfo, setShowInfo] = useState(false);
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const infoPanelRef = useRef<HTMLDivElement>(null);
  useDismiss(
    infoPanelRef,
    () => {
      setShowInfo(false);
      infoButtonRef.current?.focus();
    },
    { enabled: showInfo, triggerRef: infoButtonRef },
  );
  // P22-T6-09 — 낭독(TTS): assistant 응답을 브라우저 네이티브 speechSynthesis 로 읽어준다.
  //   미지원 런타임에서는 supported=false 라 버튼 자체를 렌더하지 않는다.
  const tts = useSpeechSynthesis();
  const hasInfo =
    role === "assistant" &&
    meta !== undefined &&
    (meta.inputTokens !== undefined ||
      meta.outputTokens !== undefined ||
      meta.elapsedMs !== undefined);

  function handleDeleteClick() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    onDelete?.();
  }

  async function copy() {
    if (!(await copyText(content))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function toggleFeedback(next: "up" | "down") {
    const previous = feedback;
    const nextState = previous === next ? null : next;
    setFeedback(nextState);
    if (!sessionId || !messageId) return;
    const rating = next === "up" ? 1 : -1;
    const saved = await sendMessageFeedback(sessionId, messageId, rating);
    if (saved === undefined) {
      setFeedback(previous);
      return;
    }
    setFeedback(saved === 1 ? "up" : saved === -1 ? "down" : null);
  }

  return (
    <div className="flex items-center gap-1 text-fg-muted">
      <button
        type="button"
        aria-label="복사"
        onClick={() => void copy()}
        className="rounded-md p-1 text-xs hover:bg-surface hover:text-fg"
      >
        {copied ? "복사됨" : "복사"}
      </button>
      {role === "user" && onEdit && (
        <button
          type="button"
          aria-label="편집"
          onClick={onEdit}
          className="rounded-md p-1 text-xs hover:bg-surface hover:text-fg"
        >
          편집
        </button>
      )}
      {role === "assistant" && onRegenerate && (
        <button
          type="button"
          aria-label="재생성"
          onClick={onRegenerate}
          className="rounded-md p-1 text-xs hover:bg-surface hover:text-fg"
        >
          재생성
        </button>
      )}
      {role === "assistant" && tts.supported && (
        <button
          type="button"
          aria-label="낭독"
          aria-pressed={tts.speaking}
          data-testid="message-read-aloud"
          onClick={() => tts.toggle(content)}
          className="rounded-md p-1 text-xs hover:bg-surface hover:text-fg aria-pressed:text-primary"
        >
          {tts.speaking ? "정지" : "낭독"}
        </button>
      )}
      {role === "assistant" && (
        <>
          <button
            type="button"
            aria-label="좋아요"
            aria-pressed={feedback === "up"}
            onClick={() => void toggleFeedback("up")}
            className="rounded-md p-1 text-xs hover:bg-surface hover:text-fg aria-pressed:text-primary"
          >
            👍
          </button>
          <button
            type="button"
            aria-label="싫어요"
            aria-pressed={feedback === "down"}
            onClick={() => void toggleFeedback("down")}
            className="rounded-md p-1 text-xs hover:bg-surface hover:text-fg aria-pressed:text-accent"
          >
            👎
          </button>
        </>
      )}
      {onDelete && (
        <button
          type="button"
          aria-label={confirmingDelete ? "정말 삭제?" : "삭제"}
          onClick={handleDeleteClick}
          onBlur={() => setConfirmingDelete(false)}
          className="rounded-md p-1 text-xs hover:bg-surface hover:text-accent"
        >
          {confirmingDelete ? "정말 삭제?" : "삭제"}
        </button>
      )}
      {hasInfo && (
        <div className="relative">
          <button
            ref={infoButtonRef}
            type="button"
            aria-label="정보"
            aria-expanded={showInfo}
            onClick={() => setShowInfo((v) => !v)}
            className="rounded-md p-1 text-xs hover:bg-surface hover:text-fg"
          >
            정보
          </button>
          {showInfo && (
            <div
              ref={infoPanelRef}
              role="dialog"
              aria-label="메시지 정보"
              data-testid="message-info-popover"
              className="absolute bottom-full right-0 z-10 mb-1 w-44 space-y-1 rounded-md border border-border bg-bg p-2 text-xs text-fg shadow-md"
            >
              {meta?.model && (
                <div className="flex justify-between gap-2">
                  <span className="text-fg-muted">모델</span>
                  <span>{meta.model}</span>
                </div>
              )}
              {meta?.inputTokens !== undefined && (
                <div className="flex justify-between gap-2">
                  <span className="text-fg-muted">입력 토큰</span>
                  <span>{meta.inputTokens}</span>
                </div>
              )}
              {meta?.outputTokens !== undefined && (
                <div className="flex justify-between gap-2">
                  <span className="text-fg-muted">출력 토큰</span>
                  <span>{meta.outputTokens}</span>
                </div>
              )}
              {meta?.elapsedMs !== undefined && (
                <div className="flex justify-between gap-2">
                  <span className="text-fg-muted">응답 시간</span>
                  <span>{(meta.elapsedMs / 1000).toFixed(1)}초</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
