"use client";

// components/settings/ApiKeysManager.tsx — P19-T6-16: API 키 발급/목록/폐기 매니저.
//   /api/v1/api-keys(P19-T1-11) 를 lib/apiKeys.ts 로 소비 — 발급 직후에만 평문 키를
//   배너로 1회 노출(재조회 시 서버가 마스킹된 keyPrefix 만 반환). PromptsManager 와
//   동일한 카드형 레이아웃/토큰 컨벤션.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiKeyDto,
} from "../../lib/apiKeys";
import { useFocusTrap } from "../../hooks/useFocusTrap";

const FOCUS_RING =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2";

export function ApiKeysManager() {
  const [keys, setKeys] = useState<ApiKeyDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [revokingIds, setRevokingIds] = useState<Set<string>>(new Set());
  const dialogRef = useRef<HTMLDivElement>(null);

  const closeModal = useCallback(() => setShowModal(false), []);
  useFocusTrap(dialogRef, { active: showModal, onClose: closeModal });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listApiKeys();
      setKeys(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await createApiKey(name);
      if (created) {
        setCreatedKey(created.key);
        setName("");
        closeModal();
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke(id: string) {
    if (revokingIds.has(id)) return;
    setRevokingIds((prev) => new Set(prev).add(id));
    try {
      const ok = await revokeApiKey(id);
      if (ok) setKeys((prev) => prev.filter((k) => k.id !== id));
    } finally {
      setRevokingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-xl font-bold text-fg">API 키</h2>
        <span className="font-mono text-[11px] text-fg-subtle">
          /settings/api-keys
        </span>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className={`ml-auto h-[34px] rounded-md bg-primary px-3.5 text-[13px] font-semibold text-primary-fg ${FOCUS_RING}`}
        >
          ＋ API 키 발급
        </button>
      </div>

      {createdKey && (
        <div
          data-testid="api-key-created-banner"
          className="mt-3.5 rounded-[10px] border border-accent/30 bg-accent/5 p-3.5 text-[13px] text-fg"
        >
          <p className="font-semibold text-accent">
            이 키는 지금만 표시됩니다. 안전한 곳에 복사해 두세요.
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-border bg-bg px-2 py-1 font-mono text-[12.5px] text-fg">
              {createdKey}
            </code>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(createdKey)}
              className={`h-7 shrink-0 rounded-md border border-border px-2.5 text-xs text-fg ${FOCUS_RING}`}
            >
              복사
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCreatedKey(null)}
            className={`mt-1.5 text-xs text-fg-muted ${FOCUS_RING}`}
          >
            닫기
          </button>
        </div>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-fg-muted">불러오는 중…</p>
      ) : keys.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">발급된 API 키가 없습니다.</p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {keys.map((k) => (
            <div
              key={k.id}
              data-testid={`api-key-card-${k.id}`}
              className="rounded-[10px] border border-border bg-bg p-4"
            >
              <div className="text-[14px] font-semibold text-fg">{k.name}</div>
              <div className="mt-1 font-mono text-[12.5px] text-fg-muted">
                {k.keyPrefix}••••
              </div>
              <div className="mt-1 text-[11px] text-fg-subtle">
                {k.lastUsedAt
                  ? `마지막 사용: ${new Date(k.lastUsedAt).toLocaleDateString()}`
                  : "미사용"}
              </div>
              <button
                type="button"
                onClick={() => void handleRevoke(k.id)}
                disabled={revokingIds.has(k.id)}
                className={`mt-3 h-7 rounded-md px-2.5 text-xs text-fg-muted disabled:opacity-60 ${FOCUS_RING}`}
              >
                폐기
              </button>
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
            aria-label="API 키 발급"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-[14px] border border-border bg-bg p-4 shadow-lg"
          >
            <form onSubmit={(e) => void handleSubmit(e)}>
              <label className="block text-xs text-fg-muted">
                이름
                <input
                  aria-label="이름"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={`mt-1 h-8 w-full rounded-md border border-border px-2.5 text-[13px] text-fg ${FOCUS_RING}`}
                />
              </label>
              <button
                type="submit"
                disabled={saving || !name.trim()}
                className={`mt-3.5 h-8 w-full rounded-md bg-primary text-[12.5px] font-semibold text-primary-fg disabled:opacity-60 ${FOCUS_RING}`}
              >
                발급
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
