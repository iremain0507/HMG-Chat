"use client";

// components/admin/OpenApiToolServersManager.tsx — P22-T6-21(마무리 · admin UI · T1-12 완성용).
//   P22-T1-12 가 서버측(GET/POST/DELETE/refresh + SSRF 이중검증 + org 404 격리)을 완성했으나
//   소비 UI 가 없어 acceptance 4번째(admin 패널에서 spec 등록 → 채팅에서 호출)가 미완이었다.
//   McpServersManager(components/settings)를 미러하되 OpenAPI 고유 정보구조를 따른다:
//   · 카드에 specUrl 이 아니라 실제 호출 대상인 baseUrl 을 크게 — 등록 후 사용자가 확인할 값은
//     "어디로 요청이 나가는가"이고, SSRF 검증도 baseUrl 기준이기 때문(Open WebUI 툴서버 화면 동일).
//   · 도구 목록은 hover 팝오버가 아니라 클릭 토글(aria-expanded) — OpenAPI 는 operation 이 수십 개
//     나올 수 있어 hover 로는 스캔이 어렵고 키보드 접근도 불안정하다.
//   · 등록은 MCP 의 3단계 모달과 달리 단일 폼 — discovery 가 POST 응답에 동기 포함되고 실패 시
//     에러코드(SSRF_BLOCKED/INVALID_SPEC)가 즉시 오므로 중간 "검증 중" 단계가 정보를 더하지 않는다.
//   서버 무접촉(API 소비만). 색상은 DESIGN.md 시맨틱 토큰만.
import React, { useRef, useState } from "react";
import {
  useOpenApiToolServers,
  type OpenApiToolServerDto,
} from "../../hooks/useOpenApiToolServers";
import { useFocusTrap } from "../../hooks/useFocusTrap";

const FOCUS_RING =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2";

const STATUS_DOT: Record<OpenApiToolServerDto["status"], string> = {
  active: "bg-success",
  degraded: "bg-warning",
  suspended: "bg-accent",
};

function scopeLabel(server: OpenApiToolServerDto): string {
  if (server.userId) return "개인";
  if (server.projectId) return "프로젝트";
  return "조직";
}

function formatDiscoveredAt(iso: string | null): string {
  if (!iso) return "도구 발견 대기중";
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 60000),
  );
  if (minutes < 1) return "발견 방금 전";
  if (minutes < 60) return `발견 ${minutes}분 전`;
  if (minutes < 60 * 24) return `발견 ${Math.round(minutes / 60)}시간 전`;
  return `발견 ${Math.round(minutes / (60 * 24))}일 전`;
}

export function OpenApiToolServersManager() {
  const { servers, loading, error, create, refresh, remove } =
    useOpenApiToolServers();
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [specUrl, setSpecUrl] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const dialogRef = useRef<HTMLDivElement>(null);

  function closeModal() {
    setShowModal(false);
  }

  useFocusTrap(dialogRef, { active: showModal, onClose: closeModal });

  function openModal() {
    setName("");
    setSpecUrl("");
    setBaseUrl("");
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return; // 이중제출 가드 — POST 가 spec fetch 를 동반해 수 초 걸릴 수 있다.
    setSubmitting(true);
    try {
      const ok = await create({
        name,
        specUrl,
        ...(baseUrl.trim() !== "" ? { baseUrl: baseUrl.trim() } : {}),
      });
      // 실패 시 모달을 유지해야 사용자가 URL 을 고쳐 재시도할 수 있다(에러는 폼 안에 표시).
      if (ok) setShowModal(false);
    } finally {
      setSubmitting(false);
    }
  }

  /** refresh/remove 는 같은 카드에서 동시 실행되면 목록 재로딩이 경합하므로 id 단위로 잠근다. */
  async function withBusy(id: string, fn: () => Promise<void>) {
    if (busyIds.has(id)) return;
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await fn();
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <section data-testid="openapi-tool-servers-manager">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-xl font-bold text-fg">OpenAPI 툴서버</h2>
        <span className="font-mono text-[11px] text-fg-subtle">
          /admin/tool-servers
        </span>
        <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-success-soft px-2.5 text-[11.5px] font-medium text-success">
          SSRF 가드 활성
        </span>
        <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-primary-50 px-2.5 text-[11.5px] font-medium text-primary">
          JSON 스펙만 지원
        </span>
        <button
          type="button"
          onClick={openModal}
          className={`ml-auto h-[34px] rounded-md bg-primary px-3.5 text-[13px] font-semibold text-primary-fg ${FOCUS_RING}`}
        >
          ＋ 툴서버 등록
        </button>
      </div>

      {error && !showModal && (
        <p role="alert" className="mt-2 text-sm text-accent">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-fg-muted">불러오는 중…</p>
      ) : servers.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">
          등록된 OpenAPI 툴서버가 없습니다.
        </p>
      ) : (
        <ul className="mt-5 flex flex-col gap-3">
          {servers.map((s) => (
            <li
              key={s.id}
              className="rounded-[10px] border border-border bg-bg p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 flex-none rounded-full ${STATUS_DOT[s.status]}`}
                />
                <span className="text-[14.5px] font-semibold text-fg">
                  {s.name}
                </span>
                <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-fg-muted">
                  {scopeLabel(s)}
                </span>
                <span className="ml-auto text-[11.5px] text-fg-subtle">
                  {formatDiscoveredAt(s.lastDiscoveredAt)}
                </span>
              </div>

              <div className="mt-1.5 font-mono text-[12px] text-fg-muted">
                {s.baseUrl}
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  aria-expanded={expandedId === s.id}
                  onClick={() =>
                    setExpandedId((prev) => (prev === s.id ? null : s.id))
                  }
                  className={`h-7 rounded-md border border-border px-2.5 text-xs font-semibold text-fg ${FOCUS_RING}`}
                >
                  도구 {s.supportedTools.length}개
                </button>
                <button
                  type="button"
                  aria-label={`${s.name} 도구 다시 발견`}
                  disabled={busyIds.has(s.id)}
                  onClick={() => void withBusy(s.id, () => refresh(s.id))}
                  className={`h-7 rounded-md border border-border px-2.5 text-xs text-fg disabled:opacity-50 ${FOCUS_RING}`}
                >
                  새로고침
                </button>
                <button
                  type="button"
                  aria-label={`${s.name} 삭제`}
                  disabled={busyIds.has(s.id)}
                  onClick={() => void withBusy(s.id, () => remove(s.id))}
                  className={`h-7 rounded-md px-2.5 text-xs text-fg-muted disabled:opacity-50 ${FOCUS_RING}`}
                >
                  삭제
                </button>
              </div>

              {expandedId === s.id && (
                <ul
                  data-testid={`openapi-tools-${s.id}`}
                  className="mt-2.5 flex flex-col rounded-md border border-border"
                >
                  {s.supportedTools.length === 0 ? (
                    <li className="px-2.5 py-2 text-[12px] text-fg-muted">
                      발견된 도구가 없습니다 — 스펙을 확인하고 새로고침하세요.
                    </li>
                  ) : (
                    s.supportedTools.map((t) => (
                      <li
                        key={t.name}
                        className="flex flex-wrap items-center gap-2 border-b border-border px-2.5 py-1.5 last:border-b-0"
                      >
                        <span className="font-mono text-[11.5px] text-fg">
                          {t.name}
                        </span>
                        <span className="text-[11.5px] text-fg-muted">
                          {t.description}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {showModal && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-fg/40 px-4"
          onClick={closeModal}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-label="OpenAPI 툴서버 등록"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-[14px] border border-border bg-bg p-4 shadow-lg"
          >
            <form onSubmit={(e) => void handleSubmit(e)}>
              <div className="text-[13px] font-semibold text-fg">
                OpenAPI 툴서버 등록
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-fg-subtle">
                스펙 URL 을 등록하면 operation 이 자동으로 도구로 변환됩니다.
                내부망 주소는 SSRF 가드가 차단합니다.
              </p>
              <label className="mt-2.5 block text-xs text-fg-muted">
                이름
                <input
                  aria-label="툴서버 이름"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={`mt-1 h-8 w-full rounded-md border border-border px-2.5 text-[13px] text-fg ${FOCUS_RING}`}
                />
              </label>
              <label className="mt-2.5 block text-xs text-fg-muted">
                OpenAPI 스펙 URL
                <input
                  aria-label="OpenAPI 스펙 URL"
                  value={specUrl}
                  onChange={(e) => setSpecUrl(e.target.value)}
                  placeholder="https://api.example.com/openapi.json"
                  className={`mt-1 h-8 w-full rounded-md border border-border px-2.5 font-mono text-xs text-fg ${FOCUS_RING}`}
                />
              </label>
              <label className="mt-2.5 block text-xs text-fg-muted">
                base URL (선택 — 미입력 시 스펙의 servers[0])
                <input
                  aria-label="base URL"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className={`mt-1 h-8 w-full rounded-md border border-border px-2.5 font-mono text-xs text-fg ${FOCUS_RING}`}
                />
              </label>

              {error && (
                <p role="alert" className="mt-2.5 text-[12px] text-accent">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className={`mt-3.5 h-8 w-full rounded-md bg-primary text-[12.5px] font-semibold text-primary-fg disabled:opacity-60 ${FOCUS_RING}`}
              >
                {submitting ? "등록 중…" : "등록"}
              </button>
              <button
                type="button"
                onClick={closeModal}
                className={`mt-1.5 h-8 w-full rounded-md text-xs text-fg-muted ${FOCUS_RING}`}
              >
                취소
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
