"use client";

// components/chat/ShareExportMenu.tsx — 19-UIUX-UPGRADE.md § P10-T6-16 공유/내보내기.
//   내보내기(md/JSON)는 클라이언트가 이미 보유한 messages 를 그대로 직렬화해 즉시 다운로드
//   트리거(신규 서버 계약 없음). 공유는 세션의 최신 아티팩트를 명시적 opt-in 확인 후에만
//   기존 ArtifactShare 계약(components/artifacts/ShareDialog.tsx, 16-API-CONTRACT § 8)으로 위임.
import React, { useEffect, useRef, useState } from "react";
import { ShareDialog } from "../artifacts/ShareDialog";
import { ConversationShareDialog } from "./ConversationShareDialog";
import type { ArtifactSummary } from "../../hooks/useSessionStream";
import { useDismiss } from "../../hooks/useDismiss";
import { useExclusiveOverlay } from "../../hooks/useExclusiveOverlay";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  conversationToJson,
  conversationToMarkdown,
  downloadTextFile,
  type ExportMessage,
} from "../../lib/export-conversation";
import {
  importConversationsFromFile,
  SESSIONS_CHANGED_EVENT,
} from "../../lib/importConversations";
import { showToast } from "../../lib/toast";

type MenuState =
  "closed" | "menu" | "confirm" | "share-dialog" | "conversation-share-dialog";

const FOCUS_RING =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2";

const PRINT_ROLE_LABEL: Record<ExportMessage["role"], string> = {
  user: "사용자",
  assistant: "어시스턴트",
};

export function ShareExportMenu({
  title,
  messages,
  artifacts,
  sessionId,
}: {
  title: string;
  messages: ExportMessage[];
  artifacts: ArtifactSummary[];
  sessionId: string;
}) {
  const [state, setState] = useState<MenuState>("closed");
  const [printRequested, setPrintRequested] = useState(false);
  const latestArtifact = artifacts[artifacts.length - 1] ?? null;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const menuOverlay = useExclusiveOverlay(`share-export-menu-${sessionId}`);

  useEffect(() => {
    if (!menuOverlay.isOpen && state === "menu") setState("closed");
  }, [menuOverlay.isOpen, state]);

  useDismiss(
    menuRef,
    () => {
      menuOverlay.close();
      setState("closed");
      triggerRef.current?.focus();
    },
    { enabled: state === "menu", triggerRef },
  );

  useFocusTrap(confirmRef, {
    active: state === "confirm",
    onClose: () => setState("closed"),
  });

  function toggleMenu() {
    if (state === "closed") {
      menuOverlay.open();
      setState("menu");
    } else {
      menuOverlay.close();
      setState("closed");
    }
  }

  function exportMarkdown() {
    downloadTextFile(
      `${title}.md`,
      conversationToMarkdown(title, messages),
      "text/markdown",
    );
    setState("closed");
  }

  function exportJson() {
    downloadTextFile(
      `${title}.json`,
      conversationToJson(title, messages),
      "application/json",
    );
    setState("closed");
  }

  // P22-T6-13(계약배치 C9) — 가져오기. 메뉴 항목은 숨은 file input 을 대신 클릭할 뿐이고,
  // 실제 읽기/포맷판별/POST 는 lib/importConversations.ts 가 담당(파싱 단일출처는 서버).
  // 성공 시 SESSIONS_CHANGED_EVENT 를 발행해 SessionList 가 목록을 다시 읽게 한다.
  async function onImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 같은 파일을 연속으로 고를 때도 change 가 다시 발화하도록 값을 비운다.
    e.target.value = "";
    if (!file) return;
    setState("closed");
    const result = await importConversationsFromFile(file);
    if (!result.ok) {
      showToast(
        "error",
        "대화를 가져오지 못했습니다. JSON 형식을 확인해주세요.",
      );
      return;
    }
    showToast(
      "success",
      `대화 ${result.createdSessionIds.length}건을 가져왔습니다.`,
    );
    window.dispatchEvent(new CustomEvent(SESSIONS_CHANGED_EVENT));
  }

  function exportPdf() {
    setState("closed");
    setPrintRequested(true);
    window.print();
  }

  return (
    <div className="relative">
      {printRequested && (
        <div data-testid="chat-print-view" className="chat-print-view">
          <h1>{title}</h1>
          {messages.map((m, i) => (
            <section key={i}>
              <h2>{PRINT_ROLE_LABEL[m.role]}</h2>
              <p>{m.content}</p>
            </section>
          ))}
        </div>
      )}
      {/* 메뉴가 닫혀도 언마운트되지 않도록 메뉴 밖에 둔다(선택 중 메뉴가 닫혀도 change 수신). */}
      <input
        ref={importInputRef}
        data-testid="import-file-input"
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={onImportFileChange}
      />
      <button
        ref={triggerRef}
        type="button"
        data-testid="share-export-trigger"
        aria-haspopup="menu"
        aria-expanded={state === "menu"}
        onClick={toggleMenu}
        className={`flex items-center gap-1 rounded-md px-2 py-1 text-sm text-fg-muted hover:text-fg ${FOCUS_RING}`}
      >
        <span>공유/내보내기</span>
        <span aria-hidden="true">▾</span>
      </button>

      {state === "menu" && (
        <div
          ref={menuRef}
          data-testid="share-export-menu"
          className="absolute right-0 top-full z-10 mt-1 w-56 rounded-[10px] border border-border bg-surface p-1 shadow-lg"
        >
          <button
            type="button"
            onClick={exportMarkdown}
            className={`block w-full rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-bg ${FOCUS_RING}`}
          >
            마크다운으로 내보내기
          </button>
          <button
            type="button"
            onClick={exportJson}
            className={`block w-full rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-bg ${FOCUS_RING}`}
          >
            JSON으로 내보내기
          </button>
          <button
            type="button"
            onClick={exportPdf}
            className={`block w-full rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-bg ${FOCUS_RING}`}
          >
            PDF로 내보내기
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className={`block w-full rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-bg ${FOCUS_RING}`}
          >
            대화 가져오기
          </button>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            disabled={!latestArtifact}
            title={latestArtifact ? undefined : "공유할 아티팩트가 없습니다"}
            onClick={() => {
              triggerRef.current?.focus();
              setState("confirm");
            }}
            className={`block w-full rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-bg disabled:opacity-40 disabled:hover:bg-transparent ${FOCUS_RING}`}
          >
            대화 공유
          </button>
          <button
            type="button"
            onClick={() => setState("conversation-share-dialog")}
            className={`block w-full rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-bg ${FOCUS_RING}`}
          >
            대화 스냅샷 공유
          </button>
        </div>
      )}

      {state === "confirm" && latestArtifact && (
        <div
          ref={confirmRef}
          tabIndex={-1}
          data-testid="share-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-label="공유 확인"
          className={`absolute right-0 top-full z-10 mt-1 w-72 rounded-[10px] border border-border bg-surface p-3 shadow-lg ${FOCUS_RING}`}
        >
          <p className="text-sm text-fg">
            이 대화의 최신 아티팩트({latestArtifact.filename})를 공개 링크로
            공유하시겠습니까? 링크를 아는 누구나 볼 수 있습니다.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setState("closed")}
              className={`rounded-md px-2 py-1 text-xs text-fg-muted hover:text-fg ${FOCUS_RING}`}
            >
              취소
            </button>
            <button
              type="button"
              data-testid="share-confirm-accept"
              onClick={() => setState("share-dialog")}
              className={`rounded-md bg-primary px-2 py-1 text-xs text-primary-fg hover:opacity-90 ${FOCUS_RING}`}
            >
              공유
            </button>
          </div>
        </div>
      )}

      {state === "share-dialog" && latestArtifact && (
        <ShareDialog
          artifactId={latestArtifact.artifactId}
          onClose={() => setState("closed")}
        />
      )}

      {state === "conversation-share-dialog" && (
        <ConversationShareDialog
          sessionId={sessionId}
          onClose={() => setState("closed")}
        />
      )}
    </div>
  );
}
