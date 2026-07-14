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
import { MessageActions } from "./MessageActions";

const BOTTOM_THRESHOLD_PX = 80;

const SUGGESTIONS = [
  "프로젝트 요약해줘",
  "회의록 초안 작성해줘",
  "이 코드 리뷰해줘",
];

export function ChatView({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { messages, isStreaming, send, stop } = useSessionStream(sessionId);
  const [input, setInput] = useState("");
  const [autoFollow, setAutoFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && autoFollow) el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming, autoFollow]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoFollow(distanceFromBottom < BOTTOM_THRESHOLD_PX);
  }

  function scrollToBottom() {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAutoFollow(true);
  }

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
    <div className="flex h-full flex-col bg-bg text-fg">
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

      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          data-testid="chat-scroll"
          onScroll={onScroll}
          className="h-full overflow-y-auto"
        >
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
              {messages.map((m, i) => {
                const canRegenerate = m.role === "assistant" && !isStreaming;
                return (
                  <MessageItem
                    key={m.id}
                    role={m.role}
                    content={m.content}
                    error={m.error ?? false}
                    streaming={
                      isStreaming &&
                      i === messages.length - 1 &&
                      m.role === "assistant"
                    }
                    {...(canRegenerate
                      ? {
                          onRegenerate: () => {
                            const priorUser = messages
                              .slice(0, i)
                              .reverse()
                              .find((prev) => prev.role === "user");
                            if (priorUser) void send(priorUser.content);
                          },
                        }
                      : {})}
                  />
                );
              })}
            </ul>
          )}
        </div>
        {!autoFollow && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-fg-muted shadow-md hover:border-primary hover:text-fg"
          >
            최신으로↓
          </button>
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
  error,
  onRegenerate,
}: {
  role: "user" | "assistant";
  content: string;
  streaming: boolean;
  error?: boolean;
  onRegenerate?: () => void;
}) {
  if (error) {
    return (
      <li data-role="error" className="flex gap-3">
        <div className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-lg bg-accent text-sm font-bold text-white">
          !
        </div>
        <div className="min-w-0 flex-1 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">
          <span className="font-semibold">오류</span> · {content}
        </div>
      </li>
    );
  }
  if (role === "user") {
    return (
      <li data-role="user" className="group flex justify-end">
        <div className="max-w-[80%]">
          <div className="whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2.5 text-primary-fg">
            {content}
          </div>
          <div className="mt-1 flex justify-end opacity-0 transition-opacity group-hover:opacity-100">
            <MessageActions role="user" content={content} />
          </div>
        </div>
      </li>
    );
  }
  return (
    <li data-role="assistant" className="group flex gap-3">
      <div className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-lg bg-primary text-sm font-bold text-primary-fg">
        W
      </div>
      <div className="min-w-0 flex-1 pt-1">
        {content ? <Markdown streaming={streaming}>{content}</Markdown> : null}
        {streaming && !content && (
          <div
            data-testid="shimmer"
            aria-label="응답 생성 중"
            className="space-y-2"
          >
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-surface" />
            <div className="h-3.5 w-1/2 animate-pulse rounded bg-surface" />
          </div>
        )}
        {streaming && content && (
          <span
            className="ml-0.5 inline-block h-4 w-[3px] animate-pulse bg-fg align-middle"
            aria-label="응답 생성 중"
          />
        )}
        {!streaming && (
          <div className="mt-1 opacity-0 transition-opacity group-hover:opacity-100">
            <MessageActions
              role="assistant"
              content={content}
              {...(onRegenerate ? { onRegenerate } : {})}
            />
          </div>
        )}
      </div>
    </li>
  );
}
