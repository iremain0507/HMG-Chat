"use client";

// components/channels/ChannelsWorkspace.tsx — P22-T6-12 채널(실시간 멀티유저 + @model 협업).
//   Open WebUI Channels 파리티: 좌측 채널 목록(참여/나가기) + 우측 방 뷰(오래된 순 메시지,
//   부모 아래 중첩되는 스레드 답글, 메시지별 이모지 리액션, 컴포저).
//
//   @model — 본문에 @model 이 들어가면 서버가 어시스턴트 답변을 만들어 스트림으로 보낸다.
//   그 답변은 role:"assistant" 라 사람 메시지와 시각적으로 명확히 구분한다(사람 이름 자리에
//   "모델" 배지). 채널은 여러 사람이 함께 읽는 화면이라, 모델이 한 말을 동료가 한 말로
//   오인하면 그대로 오판이 된다 — 구분은 장식이 아니라 안전장치다.
//
//   시각 디자인은 DESIGN.md 시맨틱 토큰만 사용(하드코딩 hex 금지, 라이트/다크 양방향).
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useChannels,
  useChannelRoom,
  type ChannelDto,
  type ChannelMessageDto,
} from "../../hooks/useChannels";
import { showToast } from "../../lib/toast";

const FOCUS_RING =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2";

// 고정 피커 — 채널 리액션은 "빠른 합의 신호"라 자유 이모지보다 소수 고정셋이 읽기 쉽다.
const REACTION_EMOJIS = ["👍", "🎉", "✅", "❤️"] as const;

const MENTION = "@model";

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 사람 표시명 — 서버가 아직 표시명을 싣지 않으므로 userId 를 짧게 보여준다. */
function authorLabel(message: ChannelMessageDto): string {
  if (message.userId === "me") return "나";
  return message.userId.slice(0, 12);
}

interface MessageItemProps {
  message: ChannelMessageDto;
  childrenOf: Map<string, ChannelMessageDto[]>;
  onToggleReaction(messageId: string, emoji: string): void;
  onReply(message: ChannelMessageDto): void;
  depth: number;
}

function MessageItem({
  message,
  childrenOf,
  onToggleReaction,
  onReply,
  depth,
}: MessageItemProps) {
  const isAssistant = message.role === "assistant";
  const replies = childrenOf.get(message.id) ?? [];

  return (
    <li
      data-testid={`channel-message-${message.id}`}
      data-role={message.role}
      className="flex flex-col gap-1"
    >
      <div
        className={`rounded-xl border px-3 py-2 ${
          isAssistant
            ? "border-primary/40 bg-primary-50"
            : "border-border bg-surface"
        }`}
      >
        <div className="flex items-baseline gap-2">
          {isAssistant ? (
            <span
              data-testid="channel-model-badge"
              className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-fg"
            >
              모델
            </span>
          ) : (
            <span className="text-sm font-semibold text-fg">
              {authorLabel(message)}
            </span>
          )}
          <span className="text-xs text-fg-muted tabular-nums">
            {timeLabel(message.createdAt)}
          </span>
        </div>

        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-fg">
          {message.content}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-1">
          {REACTION_EMOJIS.map((emoji) => {
            const agg = message.reactions.find((r) => r.emoji === emoji);
            const count = agg?.count ?? 0;
            const mine = agg?.reactedByMe ?? false;
            return (
              <button
                key={emoji}
                type="button"
                aria-pressed={mine}
                aria-label={`${emoji} 반응${count > 0 ? ` ${count}개` : ""}`}
                onClick={() => onToggleReaction(message.id, emoji)}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${FOCUS_RING} ${
                  mine
                    ? "border-primary bg-primary-50 text-fg"
                    : "border-border text-fg-muted hover:border-primary hover:text-fg"
                }`}
              >
                <span aria-hidden="true">{emoji}</span>
                {count > 0 ? (
                  <span className="tabular-nums">{count}</span>
                ) : null}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => onReply(message)}
            aria-label={`${authorLabel(message)} 메시지에 답글`}
            className={`ml-1 rounded-full border border-border px-2 py-0.5 text-xs text-fg-muted hover:border-primary hover:text-fg ${FOCUS_RING}`}
          >
            답글
          </button>
        </div>
      </div>

      {replies.length > 0 ? (
        <ul
          data-testid={`channel-thread-${message.id}`}
          className="ml-6 flex flex-col gap-2 border-l-2 border-border pl-3"
        >
          {replies.map((reply) => (
            <MessageItem
              key={reply.id}
              message={reply}
              childrenOf={childrenOf}
              onToggleReaction={onToggleReaction}
              onReply={onReply}
              depth={depth + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ChannelsWorkspace() {
  const {
    channels,
    loading: channelsLoading,
    error: channelsError,
    create,
    join,
    leave,
  } = useChannels();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ChannelMessageDto | null>(null);
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    loading: roomLoading,
    error: roomError,
    send,
    toggleReaction,
  } = useChannelRoom(selectedId);

  const selected = channels.find((c) => c.id === selectedId) ?? null;

  // 목록이 처음 로드되면 첫 채널을 자동 선택한다(빈 화면보다 바로 대화를 보여준다).
  useEffect(() => {
    if (selectedId === null && channels.length > 0) {
      setSelectedId((channels[0] as ChannelDto).id);
    }
  }, [channels, selectedId]);

  // 새 메시지가 붙으면 바닥으로 — 실시간 채널은 최신이 기준선이다.
  // scrollIntoView 는 best-effort(jsdom 등 미구현 환경에서 화면 로직을 막지 않는다).
  useEffect(() => {
    listEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length]);

  // parentId 로 스레드를 구성한다. 루트(부모 없음)만 최상위로 렌더하고, 나머지는
  // 부모 아래 중첩된다. 부모가 (아직) 로컬에 없는 답글은 고아가 되지 않도록 루트로 승격.
  const { roots, childrenOf } = useMemo(() => {
    const byId = new Set(messages.map((m) => m.id));
    const kids = new Map<string, ChannelMessageDto[]>();
    const top: ChannelMessageDto[] = [];
    for (const m of messages) {
      if (m.parentId && byId.has(m.parentId)) {
        kids.set(m.parentId, [...(kids.get(m.parentId) ?? []), m]);
      } else {
        top.push(m);
      }
    }
    return { roots: top, childrenOf: kids };
  }, [messages]);

  const insertMention = useCallback(() => {
    setDraft((prev) => (prev.includes(MENTION) ? prev : `${MENTION} ${prev}`));
    composerRef.current?.focus();
  }, []);

  async function handleSend() {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const ok = await send(content, replyTo?.id ?? null);
      if (ok) {
        setDraft("");
        setReplyTo(null);
      }
      // 실패 시 draft 를 남겨 사용자가 다시 시도할 수 있게 한다(에러는 아래 alert 로 노출).
    } finally {
      setSending(false);
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await create({ name });
      setNewName("");
      showToast("success", "채널을 만들었습니다.");
    } finally {
      setCreating(false);
    }
  }

  const error = roomError ?? channelsError;

  return (
    <div className="flex h-full min-h-0 gap-4" data-testid="channels-workspace">
      {/* 좌측 — 채널 목록 */}
      <aside className="flex w-64 shrink-0 flex-col gap-2 border-r border-border pr-4">
        <h2 className="text-sm font-semibold text-fg">채널</h2>

        <div className="flex gap-1">
          <label htmlFor="channel-new-name" className="sr-only">
            새 채널 이름
          </label>
          <input
            id="channel-new-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="새 채널 이름"
            className={`min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg placeholder:text-fg-muted ${FOCUS_RING}`}
          />
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating || newName.trim() === ""}
            data-testid="channel-create"
            className={`rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-fg hover:opacity-90 disabled:opacity-50 ${FOCUS_RING}`}
          >
            만들기
          </button>
        </div>

        {channelsLoading ? (
          <p className="text-sm text-fg-muted">불러오는 중…</p>
        ) : channels.length === 0 ? (
          <p className="text-sm text-fg-muted">
            아직 채널이 없습니다. 위에서 새 채널을 만들어 보세요.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 overflow-y-auto">
            {channels.map((channel) => (
              <li
                key={channel.id}
                data-testid={`channel-item-${channel.id}`}
                className="flex items-center gap-1"
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(channel.id);
                    setReplyTo(null);
                  }}
                  aria-current={channel.id === selectedId ? "true" : undefined}
                  className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-left ${FOCUS_RING} ${
                    channel.id === selectedId
                      ? "bg-primary-50 text-fg"
                      : "text-fg-muted hover:bg-surface hover:text-fg"
                  }`}
                >
                  <span className="block truncate text-sm font-medium">
                    {channel.name}
                  </span>
                  <span className="block truncate text-xs text-fg-muted">
                    멤버 {channel.memberCount}명
                  </span>
                </button>
                {channel.isMember ? (
                  <button
                    type="button"
                    onClick={() => void leave(channel.id)}
                    aria-label={`${channel.name} 채널 나가기`}
                    className={`shrink-0 rounded-md border border-border px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-accent ${FOCUS_RING}`}
                  >
                    나가기
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void join(channel.id)}
                    aria-label={`${channel.name} 채널 참여`}
                    className={`shrink-0 rounded-md border border-border px-2 py-1 text-xs text-fg hover:border-primary ${FOCUS_RING}`}
                  >
                    참여
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* 우측 — 방 뷰 */}
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        {error ? (
          <p role="alert" className="text-sm text-accent">
            {error}
          </p>
        ) : null}

        {!selected ? (
          <p className="text-sm text-fg-muted">왼쪽에서 채널을 선택하세요.</p>
        ) : (
          <>
            <header className="border-b border-border pb-2">
              <h3 className="text-base font-semibold text-fg">
                {selected.name}
              </h3>
              {selected.description ? (
                <p className="text-xs text-fg-muted">{selected.description}</p>
              ) : null}
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {roomLoading ? (
                <p className="text-sm text-fg-muted">메시지를 불러오는 중…</p>
              ) : roots.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  아직 메시지가 없습니다. 첫 메시지를 남겨보세요.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {roots.map((message) => (
                    <MessageItem
                      key={message.id}
                      message={message}
                      childrenOf={childrenOf}
                      onToggleReaction={(id, emoji) =>
                        void toggleReaction(id, emoji)
                      }
                      onReply={(m) => {
                        setReplyTo(m);
                        composerRef.current?.focus();
                      }}
                      depth={0}
                    />
                  ))}
                </ul>
              )}
              <div ref={listEndRef} />
            </div>

            {/* 컴포저 */}
            <div className="flex flex-col gap-2 border-t border-border pt-2">
              {replyTo ? (
                <div className="flex items-center gap-2 text-xs text-fg-muted">
                  <span className="truncate">
                    답글 대상: {replyTo.content.slice(0, 40)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setReplyTo(null)}
                    aria-label="답글 대상 해제"
                    className={`rounded-md border border-border px-2 py-0.5 hover:border-accent hover:text-accent ${FOCUS_RING}`}
                  >
                    취소
                  </button>
                </div>
              ) : null}

              <label htmlFor="channel-composer" className="sr-only">
                메시지 입력
              </label>
              <textarea
                id="channel-composer"
                ref={composerRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                rows={3}
                placeholder="메시지를 입력하세요. @model 을 넣으면 모델이 답합니다."
                className={`resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-fg placeholder:text-fg-muted ${FOCUS_RING}`}
              />

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={insertMention}
                  data-testid="channel-mention-model"
                  className={`rounded-md border border-border px-2.5 py-1 text-xs text-fg hover:border-primary ${FOCUS_RING}`}
                >
                  @model 호출
                </button>
                <span className="text-xs text-fg-muted">
                  @model 을 포함하면 모델이 채널에 답변합니다.
                </span>
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={sending || draft.trim() === ""}
                  data-testid="channel-send"
                  className={`ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg hover:opacity-90 disabled:opacity-50 ${FOCUS_RING}`}
                >
                  {sending ? "전송 중…" : "보내기"}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
