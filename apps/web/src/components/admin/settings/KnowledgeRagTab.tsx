"use client";
// components/admin/settings/KnowledgeRagTab.tsx — P14-T6-03 Knowledge/RAG 탭.
import React from "react";
import {
  LABEL_CLASS,
  INPUT_CLASS,
  ERROR_CLASS,
  CHECKBOX_LABEL_CLASS,
} from "./tabStyles";

export type KnowledgeRagValue = {
  ragTopK: number;
  ragRrfK: number;
  ragChunkSizeTokens: number;
  ragChunkOverlapTokens: number;
  ragHybridEnabled: boolean;
  ragRelevanceThreshold: number;
};

export type KnowledgeRagErrors = Partial<
  Record<keyof Omit<KnowledgeRagValue, "ragHybridEnabled">, string>
>;

export interface KnowledgeRagTabProps {
  value: KnowledgeRagValue;
  errors: KnowledgeRagErrors;
  onChange: (patch: Partial<KnowledgeRagValue>) => void;
}

export function KnowledgeRagTab({
  value,
  errors,
  onChange,
}: KnowledgeRagTabProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <label className={LABEL_CLASS}>
        검색 결과 수(ragTopK)
        <input
          type="number"
          data-testid="admin-settings-ragTopK"
          className={INPUT_CLASS}
          value={value.ragTopK}
          onChange={(e) => onChange({ ragTopK: Number(e.target.value) })}
        />
        {errors.ragTopK && (
          <span
            data-testid="admin-settings-ragTopK-error"
            className={ERROR_CLASS}
          >
            {errors.ragTopK}
          </span>
        )}
      </label>

      <label className={LABEL_CLASS}>
        RRF k(ragRrfK)
        <input
          type="number"
          data-testid="admin-settings-ragRrfK"
          className={INPUT_CLASS}
          value={value.ragRrfK}
          onChange={(e) => onChange({ ragRrfK: Number(e.target.value) })}
        />
        {errors.ragRrfK && (
          <span
            data-testid="admin-settings-ragRrfK-error"
            className={ERROR_CLASS}
          >
            {errors.ragRrfK}
          </span>
        )}
      </label>

      <label className={LABEL_CLASS}>
        청크 크기(ragChunkSizeTokens)
        <input
          type="number"
          data-testid="admin-settings-ragChunkSizeTokens"
          className={INPUT_CLASS}
          value={value.ragChunkSizeTokens}
          onChange={(e) =>
            onChange({ ragChunkSizeTokens: Number(e.target.value) })
          }
        />
        {errors.ragChunkSizeTokens && (
          <span
            data-testid="admin-settings-ragChunkSizeTokens-error"
            className={ERROR_CLASS}
          >
            {errors.ragChunkSizeTokens}
          </span>
        )}
      </label>

      <label className={LABEL_CLASS}>
        청크 겹침(ragChunkOverlapTokens)
        <input
          type="number"
          data-testid="admin-settings-ragChunkOverlapTokens"
          className={INPUT_CLASS}
          value={value.ragChunkOverlapTokens}
          onChange={(e) =>
            onChange({ ragChunkOverlapTokens: Number(e.target.value) })
          }
        />
        {errors.ragChunkOverlapTokens && (
          <span
            data-testid="admin-settings-ragChunkOverlapTokens-error"
            className={ERROR_CLASS}
          >
            {errors.ragChunkOverlapTokens}
          </span>
        )}
      </label>

      <label className={LABEL_CLASS}>
        관련도 임계값(ragRelevanceThreshold)
        <input
          type="number"
          step="0.05"
          data-testid="admin-settings-ragRelevanceThreshold"
          className={INPUT_CLASS}
          value={value.ragRelevanceThreshold}
          onChange={(e) =>
            onChange({ ragRelevanceThreshold: Number(e.target.value) })
          }
        />
        {errors.ragRelevanceThreshold && (
          <span
            data-testid="admin-settings-ragRelevanceThreshold-error"
            className={ERROR_CLASS}
          >
            {errors.ragRelevanceThreshold}
          </span>
        )}
      </label>

      <label className={CHECKBOX_LABEL_CLASS}>
        <input
          type="checkbox"
          data-testid="admin-settings-ragHybridEnabled"
          checked={value.ragHybridEnabled}
          onChange={(e) => onChange({ ragHybridEnabled: e.target.checked })}
        />
        하이브리드 검색 사용(ragHybridEnabled)
      </label>
    </div>
  );
}
