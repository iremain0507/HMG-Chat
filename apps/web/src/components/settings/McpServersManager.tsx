"use client";

// components/settings/McpServersManager.tsx — design-reference F10(커넥터 설정) 핸드오프
// 정렬(P13-T6-11). 상태 도트(active=success/degraded=warning/suspended=danger) + 스코프
// 배지(개인/프로젝트/조직 — projectId/userId 유무로 도출, McpServerDto 확장 없음) + 도구 N개
// hover 팝오버(정책은 도구명 규칙 기반 휴리스틱: read/query/search/get/list = 읽기 전용, 그
// 외 = 승인 필요 — inputSchema 에 정책 필드가 없어 이름 규칙으로 근사) + 보안 배지 2종(SSRF
// 가드 활성/도구 설명 변경 시 재승인, 고정 카피) + 등록 3단계 모달(정보 입력 → 검증·발견 →
// 발견된 도구 확인). 실제 등록/삭제는 useMcpServers 의 기존 create/remove 그대로 사용 —
// discovery 는 서버가 POST 응답에 동기 반환하므로 별도 폴링 없이 create() 완료 후 바로
// 3단계로 전환한다.
import React, { useRef, useState } from "react";
import { useMcpServers, type McpServerDto } from "../../hooks/useMcpServers";
import { useFocusTrap } from "../../hooks/useFocusTrap";

function scopeLabel(server: McpServerDto): string {
  if (server.userId) return "개인";
  if (server.projectId) return "프로젝트";
  return "조직";
}

function inferToolPolicy(name: string): "readonly" | "approval" {
  return /(read|query|search|get|list)/i.test(name) ? "readonly" : "approval";
}

function formatSyncedAt(iso: string | null): string {
  if (!iso) return "동기화 대기중";
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 60000),
  );
  if (minutes < 1) return "동기화 방금 전";
  if (minutes < 60) return `동기화 ${minutes}분 전`;
  return `동기화 ${Math.round(minutes / 60)}시간 전`;
}

const STATUS_DOT: Record<McpServerDto["status"], string> = {
  active: "bg-success",
  degraded: "bg-warning",
  suspended: "bg-accent",
};

const CARD_BORDER: Record<McpServerDto["status"], string> = {
  active: "border-border",
  degraded: "border-warning",
  suspended: "border-accent",
};

const FOCUS_RING =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2";

type RegisterStep = "info" | "discovering" | "preview";

function ToolPolicyBadge({ policy }: { policy: "readonly" | "approval" }) {
  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 text-[10.5px] ${
        policy === "readonly"
          ? "border-border bg-surface text-fg-muted"
          : "border-warning bg-warning-soft text-warning-fg"
      }`}
    >
      {policy === "readonly" ? "읽기 전용" : "승인 필요"}
    </span>
  );
}

export function McpServersManager() {
  const { servers, loading, error, create, remove } = useMcpServers();
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState<RegisterStep>("info");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] =
    useState<McpServerDto["transport"]>("streamable_http");
  const [scope, setScope] = useState<"personal" | "project" | "org">("org");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const dialogRef = useRef<HTMLDivElement>(null);

  async function handleRemove(id: string) {
    if (removingIds.has(id)) return;
    setRemovingIds((prev) => new Set(prev).add(id));
    try {
      await remove(id);
    } finally {
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  function openModal() {
    setStep("info");
    setName("");
    setUrl("");
    setScope("org");
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setStep("info");
  }

  async function handleValidate(e: React.FormEvent) {
    e.preventDefault();
    setStep("discovering");
    await create({ name, url, transport });
    setStep("preview");
  }

  const registered = servers.find((s) => s.name === name && s.url === url);

  useFocusTrap(dialogRef, { active: showModal, onClose: closeModal });

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-xl font-bold text-fg">커넥터</h2>
        <span className="font-mono text-[11px] text-fg-subtle">
          /settings/mcp
        </span>
        <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-success-soft px-2.5 text-[11.5px] font-medium text-success">
          SSRF 가드 활성
        </span>
        <span className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-primary-50 px-2.5 text-[11.5px] font-medium text-primary">
          도구 설명 변경 시 재승인
        </span>
        <button
          type="button"
          onClick={openModal}
          className={`ml-auto h-[34px] rounded-md bg-primary px-3.5 text-[13px] font-semibold text-primary-fg ${FOCUS_RING}`}
        >
          ＋ 커넥터 등록
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-accent">{error}</p>}

      {loading ? (
        <p className="mt-4 text-sm text-fg-muted">불러오는 중…</p>
      ) : servers.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">등록된 커넥터가 없습니다.</p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {servers.map((s) => (
            <div
              key={s.id}
              className={`relative rounded-[10px] border bg-bg p-4 ${CARD_BORDER[s.status]}`}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 flex-none rounded-full ${STATUS_DOT[s.status]}`}
                />
                <span className="text-[14.5px] font-semibold text-fg">
                  {s.name}
                </span>
                <span className="ml-auto rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-fg-muted">
                  {scopeLabel(s)}
                </span>
              </div>

              {s.status === "degraded" ? (
                <div className="mt-2 rounded-md bg-warning-soft p-2 text-xs leading-relaxed text-warning-fg">
                  도구 설명이 변경되었습니다 — 프롬프트 주입 방지를 위해
                  재승인이 필요합니다
                </div>
              ) : s.status === "suspended" ? (
                <div className="mt-2 text-xs text-accent">
                  연결 오류 — {formatSyncedAt(s.lastDiscoveredAt)}
                </div>
              ) : (
                <div
                  className="relative mt-2 inline-block text-[12.5px] text-fg-muted"
                  onMouseEnter={() => setHoveredId(s.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onFocus={() => setHoveredId(s.id)}
                  onBlur={() => setHoveredId(null)}
                >
                  <button
                    type="button"
                    data-testid={`mcp-tools-trigger-${s.id}`}
                    className={`font-semibold text-fg ${FOCUS_RING}`}
                  >
                    도구 {s.supportedTools.length}개
                  </button>{" "}
                  · {formatSyncedAt(s.lastDiscoveredAt)}
                  {hoveredId === s.id && s.supportedTools.length > 0 && (
                    <div
                      role="tooltip"
                      data-testid={`mcp-tools-popover-${s.id}`}
                      className="absolute left-0 top-full z-10 mt-1.5 w-[250px] rounded-[10px] border border-border bg-bg p-2 shadow-lg"
                    >
                      {s.supportedTools.map((t) => (
                        <div
                          key={t.name}
                          className="flex items-center gap-2 rounded-md px-2 py-1"
                        >
                          <span className="flex-1 font-mono text-[11.5px] text-fg">
                            {t.name}
                          </span>
                          <ToolPolicyBadge policy={inferToolPolicy(t.name)} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 flex gap-1.5">
                {s.status === "suspended" ? (
                  <button
                    type="button"
                    className={`h-7 rounded-md border border-border px-2.5 text-xs text-fg ${FOCUS_RING}`}
                  >
                    연결 확인
                  </button>
                ) : s.status === "degraded" ? (
                  <button
                    type="button"
                    className={`h-7 rounded-md bg-primary px-3 text-xs font-semibold text-primary-fg ${FOCUS_RING}`}
                  >
                    변경 검토
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`h-7 rounded-md border border-border px-2.5 text-xs text-fg ${FOCUS_RING}`}
                  >
                    새로고침
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleRemove(s.id)}
                  disabled={removingIds.has(s.id)}
                  className={`h-7 rounded-md px-2.5 text-xs text-fg-muted disabled:opacity-50 ${FOCUS_RING}`}
                >
                  비활성화
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-fg/40 px-4"
          onClick={closeModal}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-label="커넥터 등록"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-[14px] border border-border bg-bg p-4 shadow-lg"
          >
            {step === "info" && (
              <form onSubmit={(e) => void handleValidate(e)}>
                <div className="font-mono text-[10px] text-fg-subtle">
                  등록 모달 ① 정보 입력
                </div>
                <label className="mt-2.5 block text-xs text-fg-muted">
                  이름
                  <input
                    aria-label="서버 이름"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={`mt-1 h-8 w-full rounded-md border border-border px-2.5 text-[13px] text-fg ${FOCUS_RING}`}
                  />
                </label>
                <label className="mt-2.5 block text-xs text-fg-muted">
                  MCP 서버 URL
                  <input
                    aria-label="서버 URL"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className={`mt-1 h-8 w-full rounded-md border border-border px-2.5 font-mono text-xs text-fg ${FOCUS_RING}`}
                  />
                </label>
                <label className="mt-2.5 block text-xs text-fg-muted">
                  transport
                  <select
                    aria-label="transport"
                    value={transport}
                    onChange={(e) =>
                      setTransport(e.target.value as McpServerDto["transport"])
                    }
                    className={`mt-1 h-8 w-full rounded-md border border-border px-2.5 text-[13px] text-fg ${FOCUS_RING}`}
                  >
                    <option value="streamable_http">streamable_http</option>
                    <option value="sse">sse</option>
                  </select>
                </label>
                <div className="mt-2.5 text-xs text-fg-muted">스코프</div>
                <div className="mt-1.5 flex gap-1.5">
                  {(["personal", "project", "org"] as const).map((sc) => (
                    <button
                      type="button"
                      key={sc}
                      onClick={() => setScope(sc)}
                      className={`rounded-full px-2.5 py-1 text-xs ${FOCUS_RING} ${
                        scope === sc
                          ? "border border-primary/30 bg-primary-50 font-medium text-primary"
                          : "border border-border text-fg-muted"
                      }`}
                    >
                      {sc === "personal"
                        ? "개인"
                        : sc === "project"
                          ? "프로젝트"
                          : "조직"}
                    </button>
                  ))}
                </div>
                <button
                  type="submit"
                  className={`mt-3.5 h-8 w-full rounded-md bg-primary text-[12.5px] font-semibold text-primary-fg ${FOCUS_RING}`}
                >
                  다음 — 검증
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className={`mt-1.5 h-8 w-full rounded-md text-xs text-fg-muted ${FOCUS_RING}`}
                >
                  취소
                </button>
              </form>
            )}

            {step === "discovering" && (
              <div>
                <div className="font-mono text-[10px] text-fg-subtle">
                  ② 검증·도구 발견
                </div>
                <div className="mt-3 flex flex-col gap-2 text-[12.5px] text-fg">
                  <div>URL 형식·도달성 확인</div>
                  <div>SSRF 가드 — 내부망 정책 통과</div>
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 flex-none animate-spin rounded-full border-2 border-primary border-t-transparent"
                    />
                    도구 자동 발견 중
                  </div>
                </div>
              </div>
            )}

            {step === "preview" && (
              <div>
                <div className="font-mono text-[10px] text-fg-subtle">
                  ③ 발견된 도구 — 기본 정책 확인
                </div>
                <div className="mt-2.5 flex flex-col">
                  {(registered?.supportedTools ?? []).map((t) => (
                    <div
                      key={t.name}
                      className="flex items-center gap-2 border-b border-border py-1.5 last:border-b-0"
                    >
                      <span className="flex-1 font-mono text-[11.5px] text-fg">
                        {t.name}
                      </span>
                      <ToolPolicyBadge policy={inferToolPolicy(t.name)} />
                    </div>
                  ))}
                </div>
                <div className="mt-2.5 text-[11px] leading-relaxed text-fg-subtle">
                  읽기 전용은 무프롬프트, 부수효과는 HITL 게이트가 기본값
                </div>
                <button
                  type="button"
                  onClick={closeModal}
                  className={`mt-2.5 h-8 w-full rounded-md bg-primary text-[12.5px] font-semibold text-primary-fg ${FOCUS_RING}`}
                >
                  등록
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
