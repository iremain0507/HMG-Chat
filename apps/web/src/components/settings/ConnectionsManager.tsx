"use client";

// components/settings/ConnectionsManager.tsx — P22-T6-14: 외부 OpenAI 호환 provider 연결 관리.
//   Open WebUI 의 Admin > Settings > Connections 파리티(base URL + 키 등록 · enable 토글 ·
//   verify 버튼 · 모델 목록). /api/v1/connections(P22-T6-14 서버측) 를 lib/connections.ts 로
//   소비하며 ApiKeysManager/PromptsManager 와 동일한 카드형 레이아웃·토큰 컨벤션을 따른다.
//
//   보안: 서버 응답에는 평문 API 키가 없다(keyPrefix 만). 입력 폼에 넣은 평문 키는 요청 직후
//   state 에서 지워지고 어떤 경로로도 목록/카드에 렌더하지 않는다.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  createConnection,
  deleteConnection,
  listConnections,
  updateConnection,
  verifyConnection,
  type ProviderConnectionDto,
} from "../../lib/connections";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { showToast } from "../../lib/toast";

const FOCUS_RING =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2";

interface FormState {
  name: string;
  baseUrl: string;
  apiKey: string;
}

const EMPTY_FORM: FormState = { name: "", baseUrl: "", apiKey: "" };

type VerifyState = "verified" | "failed" | "unverified";

function verifyStateOf(
  conn: ProviderConnectionDto,
  failed: boolean,
): VerifyState {
  if (failed) return "failed";
  return conn.verifiedAt ? "verified" : "unverified";
}

const VERIFY_BADGE: Record<VerifyState, { label: string; className: string }> =
  {
    verified: {
      label: "검증됨",
      className: "bg-success-soft text-success",
    },
    failed: {
      label: "검증 실패",
      className: "bg-accent/10 text-accent",
    },
    unverified: {
      label: "미검증",
      className: "border border-border bg-surface text-fg-muted",
    },
  };

export function ConnectionsManager() {
  const [connections, setConnections] = useState<ProviderConnectionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [verifyingIds, setVerifyingIds] = useState<Set<string>>(new Set());
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const dialogRef = useRef<HTMLDivElement>(null);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setEditingId(null);
    setFormError(null);
    setForm(EMPTY_FORM); // 평문 키를 state 에 남기지 않는다.
  }, []);
  useFocusTrap(dialogRef, { active: showModal, onClose: closeModal });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setConnections(await listConnections());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function markBusy(id: string, busy: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowModal(true);
  }

  function openEdit(conn: ProviderConnectionDto) {
    setEditingId(conn.id);
    // 평문 키는 서버가 돌려주지 않으므로 항상 빈칸에서 시작 — 입력했을 때만 교체된다.
    setForm({ name: conn.name, baseUrl: conn.baseUrl, apiKey: "" });
    setFormError(null);
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.baseUrl.trim()) {
      setFormError("이름과 Base URL 은 필수입니다.");
      return;
    }
    if (!editingId && !form.apiKey.trim()) {
      setFormError("API 키는 필수입니다.");
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      if (editingId) {
        const result = await updateConnection(editingId, {
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
        });
        if ("error" in result) {
          setFormError(result.error);
          return;
        }
        const updated = result.connection;
        setConnections((prev) =>
          prev.map((c) => (c.id === updated.id ? updated : c)),
        );
        showToast("success", "연결을 수정했습니다.");
      } else {
        const result = await createConnection({
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          apiKey: form.apiKey.trim(),
        });
        if ("error" in result) {
          setFormError(result.error);
          return;
        }
        setConnections((prev) => [...prev, result.connection]);
        showToast("success", "연결을 추가했습니다.");
      }
      closeModal();
    } finally {
      setSaving(false);
    }
  }

  async function handleVerify(conn: ProviderConnectionDto) {
    if (verifyingIds.has(conn.id)) return;
    setVerifyingIds((prev) => new Set(prev).add(conn.id));
    try {
      const result = await verifyConnection(conn.id);
      if ("error" in result) {
        setFailedIds((prev) => new Set(prev).add(conn.id));
        showToast("error", result.error);
        return;
      }
      setConnections((prev) =>
        prev.map((c) => (c.id === conn.id ? result.connection : c)),
      );
      setFailedIds((prev) => {
        const next = new Set(prev);
        if (result.verified) next.delete(conn.id);
        else next.add(conn.id);
        return next;
      });
      showToast(
        result.verified ? "success" : "error",
        result.verified
          ? `${conn.name} 연결을 검증했습니다.`
          : `${conn.name} 검증 실패: ${result.message ?? "응답을 확인할 수 없습니다."}`,
      );
    } finally {
      setVerifyingIds((prev) => {
        const next = new Set(prev);
        next.delete(conn.id);
        return next;
      });
    }
  }

  async function handleToggle(conn: ProviderConnectionDto) {
    if (busyIds.has(conn.id)) return;
    const nextEnabled = !conn.enabled;
    markBusy(conn.id, true);
    // 낙관적 업데이트 — 실패하면 되돌린다(ApiKeysManager 의 revoke 패턴 확장).
    setConnections((prev) =>
      prev.map((c) => (c.id === conn.id ? { ...c, enabled: nextEnabled } : c)),
    );
    try {
      const result = await updateConnection(conn.id, { enabled: nextEnabled });
      if ("error" in result) {
        setConnections((prev) =>
          prev.map((c) =>
            c.id === conn.id ? { ...c, enabled: conn.enabled } : c,
          ),
        );
        showToast("error", result.error);
        return;
      }
      const updated = result.connection;
      setConnections((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      );
    } finally {
      markBusy(conn.id, false);
    }
  }

  async function handleDelete(conn: ProviderConnectionDto) {
    if (busyIds.has(conn.id)) return;
    markBusy(conn.id, true);
    try {
      const ok = await deleteConnection(conn.id);
      if (!ok) {
        showToast("error", "연결을 삭제하지 못했습니다.");
        return;
      }
      setConnections((prev) => prev.filter((c) => c.id !== conn.id));
      setConfirmDeleteId(null);
      showToast("success", "연결을 삭제했습니다.");
    } finally {
      markBusy(conn.id, false);
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-xl font-bold text-fg">연결</h2>
        <span className="font-mono text-[11px] text-fg-subtle">
          /settings/connections
        </span>
        <button
          type="button"
          onClick={openCreate}
          className={`ml-auto h-[34px] rounded-md bg-primary px-3.5 text-[13px] font-semibold text-primary-fg ${FOCUS_RING}`}
        >
          ＋ 연결 추가
        </button>
      </div>

      <p className="mt-2 text-[12.5px] text-fg-muted">
        OpenAI 호환 엔드포인트를 등록하면 해당 provider 의 모델을 사용할 수
        있습니다. API 키는 서버에 암호화 저장되며 앞자리만 표시됩니다.
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-fg-muted">불러오는 중…</p>
      ) : connections.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">등록된 연결이 없습니다.</p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          {connections.map((conn) => {
            const state = verifyStateOf(conn, failedIds.has(conn.id));
            const badge = VERIFY_BADGE[state];
            const verifying = verifyingIds.has(conn.id);
            return (
              <div
                key={conn.id}
                data-testid={`connection-card-${conn.id}`}
                className={`rounded-[10px] border bg-bg p-4 ${
                  conn.enabled ? "border-border" : "border-border opacity-70"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-fg">
                    {conn.name}
                  </span>
                  <span
                    data-testid={`connection-verify-badge-${conn.id}`}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={conn.enabled}
                    aria-label={`사용: ${conn.name}`}
                    onClick={() => void handleToggle(conn)}
                    disabled={busyIds.has(conn.id)}
                    className={`ml-auto inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border transition disabled:opacity-60 ${FOCUS_RING} ${
                      conn.enabled
                        ? "border-primary bg-primary"
                        : "border-border bg-surface"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mx-0.5 h-[16px] w-[16px] rounded-full bg-bg transition ${
                        conn.enabled ? "translate-x-[16px]" : ""
                      }`}
                    />
                  </button>
                </div>

                <div className="mt-1.5 truncate text-[12.5px] text-fg-muted">
                  {conn.baseUrl}
                </div>
                <div className="mt-1 font-mono text-[12.5px] text-fg-subtle">
                  {conn.keyPrefix}
                  ••••••
                </div>
                <div className="mt-1 text-[11px] text-fg-subtle">
                  {conn.verifiedAt
                    ? `마지막 검증: ${new Date(conn.verifiedAt).toLocaleString()}`
                    : "검증 기록 없음"}
                </div>

                {conn.models.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {conn.models.map((m) => (
                      <span
                        key={m}
                        className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-fg-muted"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    aria-label={`검증: ${conn.name}`}
                    onClick={() => void handleVerify(conn)}
                    disabled={verifying}
                    className={`h-7 rounded-md border border-border px-2.5 text-xs text-fg disabled:opacity-60 ${FOCUS_RING}`}
                  >
                    {verifying ? "검증 중…" : "검증"}
                  </button>
                  <button
                    type="button"
                    aria-label={`편집: ${conn.name}`}
                    onClick={() => openEdit(conn)}
                    className={`h-7 rounded-md border border-border px-2.5 text-xs text-fg ${FOCUS_RING}`}
                  >
                    편집
                  </button>
                  {confirmDeleteId === conn.id ? (
                    <>
                      <button
                        type="button"
                        aria-label={`삭제 확인: ${conn.name}`}
                        onClick={() => void handleDelete(conn)}
                        disabled={busyIds.has(conn.id)}
                        className={`h-7 rounded-md bg-accent px-2.5 text-xs font-semibold text-white disabled:opacity-60 ${FOCUS_RING}`}
                      >
                        삭제 확인
                      </button>
                      <button
                        type="button"
                        aria-label={`삭제 취소: ${conn.name}`}
                        onClick={() => setConfirmDeleteId(null)}
                        className={`h-7 rounded-md px-2.5 text-xs text-fg-muted ${FOCUS_RING}`}
                      >
                        취소
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      aria-label={`삭제: ${conn.name}`}
                      onClick={() => setConfirmDeleteId(conn.id)}
                      className={`h-7 rounded-md px-2.5 text-xs text-fg-muted ${FOCUS_RING}`}
                    >
                      삭제
                    </button>
                  )}
                </div>
              </div>
            );
          })}
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
            aria-label={editingId ? "연결 편집" : "연결 추가"}
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-[14px] border border-border bg-bg p-4 shadow-lg"
          >
            <form onSubmit={(e) => void handleSubmit(e)}>
              <label className="block text-xs text-fg-muted">
                이름
                <input
                  aria-label="이름"
                  value={form.name}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, name: e.target.value }));
                    if (formError) setFormError(null);
                  }}
                  className={`mt-1 h-8 w-full rounded-md border border-border px-2.5 text-[13px] text-fg ${FOCUS_RING}`}
                />
              </label>
              <label className="mt-2.5 block text-xs text-fg-muted">
                Base URL
                <input
                  aria-label="Base URL"
                  value={form.baseUrl}
                  placeholder="https://api.openai.com/v1"
                  onChange={(e) => {
                    setForm((f) => ({ ...f, baseUrl: e.target.value }));
                    if (formError) setFormError(null);
                  }}
                  className={`mt-1 h-8 w-full rounded-md border border-border px-2.5 font-mono text-[13px] text-fg ${FOCUS_RING}`}
                />
              </label>
              <label className="mt-2.5 block text-xs text-fg-muted">
                API 키
                <input
                  aria-label="API 키"
                  type="password"
                  autoComplete="off"
                  value={form.apiKey}
                  placeholder={
                    editingId ? "변경할 때만 입력" : "sk-…" /* 신규는 필수 */
                  }
                  onChange={(e) => {
                    setForm((f) => ({ ...f, apiKey: e.target.value }));
                    if (formError) setFormError(null);
                  }}
                  className={`mt-1 h-8 w-full rounded-md border border-border px-2.5 font-mono text-[13px] text-fg ${FOCUS_RING}`}
                />
              </label>
              {formError && (
                <p className="mt-2 text-xs text-accent">{formError}</p>
              )}
              <button
                type="submit"
                disabled={saving}
                className={`mt-3.5 h-8 w-full rounded-md bg-primary text-[12.5px] font-semibold text-primary-fg disabled:opacity-60 ${FOCUS_RING}`}
              >
                {editingId ? "저장" : "추가"}
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
