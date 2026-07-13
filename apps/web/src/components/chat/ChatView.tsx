"use client";

// components/chat/ChatView.tsx — LLM 채팅 UI (ChatGPT/Claude 스타일).
//   헤더 + 메시지 버블(user 우측/assistant 아바타+마크다운) + 스트리밍 커서 + 하단 컴포저.
//   데이터: useSessionStream({ messages, isStreaming, send, stop }). Hyundai WIA CI 토큰.
import React, {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useSessionStream } from "../../hooks/useSessionStream";
import { Markdown } from "./Markdown";

const SUGGESTIONS = [
  "프로젝트 요약해줘",
  "회의록 초안 작성해줘",
  "이 코드 리뷰해줘",
];

export function ChatView({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { messages, isStreaming, send, stop } = useSessionStream(sessionId);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming]);

  function autogrow() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }

  async function submit() {
    const content = input.trim();
    if (!content || isStreaming) return;
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
    await send(content);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  const empty = messages.length === 0;

  return (
    <div className="flex h-[100dvh] flex-col bg-bg text-fg">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="rounded-lg px-2 py-1 text-sm text-fg-muted hover:text-fg"
        >
          ← 홈
        </button>
        <span className="text-sm font-semibold text-primary">WChat</span>
        <button
          type="button"
          onClick={() => router.push(`/chat/${crypto.randomUUID()}`)}
          className="rounded-lg border border-border px-3 py-1 text-sm text-fg-muted hover:border-primary hover:text-fg"
        >
          ＋ 새 채팅
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {empty ? (
          <div className="grid h-full place-items-center px-6">
            <div className="text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary text-2xl font-bold text-primary-fg">
                W
              </div>
              <h1 className="mt-5 text-2xl font-semibold">
                무엇을 도와드릴까요?
              </h1>
              <p className="mt-2 text-fg-muted">
                메시지를 입력해 대화를 시작하세요.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setInput(s);
                      taRef.current?.focus();
                    }}
                    className="rounded-full border border-border bg-surface px-3.5 py-2 text-sm text-fg-muted hover:border-primary hover:text-fg"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <ul
            aria-label="메시지 목록"
            className="mx-auto max-w-3xl space-y-6 px-4 py-6"
          >
            {messages.map((m, i) => (
              <MessageItem
                key={m.id}
                role={m.role}
                content={m.content}
                streaming={
                  isStreaming &&
                  i === messages.length - 1 &&
                  m.role === "assistant"
                }
              />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border px-4 py-3">
        <form
          onSubmit={onSubmit}
          className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border bg-surface p-2"
        >
          <textarea
            id="chat-input"
            ref={taRef}
            rows={1}
            aria-label="메시지 입력"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autogrow();
            }}
            onKeyDown={onKeyDown}
            placeholder="메시지를 입력하세요…  (Enter 전송 · Shift+Enter 줄바꿈)"
            className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-1.5 text-fg outline-none placeholder:text-fg-muted"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={() => stop()}
              aria-label="Stop"
              className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-accent text-lg leading-none text-white"
            >
              ■
            </button>
          ) : (
            <button
              type="submit"
              aria-label="전송"
              disabled={!input.trim()}
              className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-primary text-lg leading-none text-primary-fg transition disabled:opacity-40"
            >
              ↑
            </button>
          )}
        </form>
        <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-fg-muted">
          WChat은 dev-stub 응답을 표시할 수 있습니다.
        </p>
      </div>
    </div>
  );
}

function MessageItem({
  role,
  content,
  streaming,
}: {
  role: "user" | "assistant";
  content: string;
  streaming: boolean;
}) {
  if (role === "user") {
    return (
      <li data-role="user" className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2.5 text-primary-fg">
          {content}
        </div>
      </li>
    );
  }
  return (
    <li data-role="assistant" className="flex gap-3">
      <div className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-lg bg-primary text-sm font-bold text-primary-fg">
        W
      </div>
      <div className="min-w-0 flex-1 pt-1">
        {content ? <Markdown>{content}</Markdown> : null}
        {streaming && (
          <span
            className="ml-0.5 inline-block h-4 w-[3px] animate-pulse bg-fg align-middle"
            aria-label="응답 생성 중"
          />
        )}
      </div>
    </li>
  );
}
