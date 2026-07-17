"use client";

// components/layout/Banner.tsx — P19-T6-15: AppShell 상단 org 배너 실표시.
//   P19-T1-10 이 org_settings.banner 를 typed 목록으로 확장했으나 클라가 GET /api/v1/config
//   응답(banner 필드)을 아직 소비하지 않아 "저장돼도 안 뜨던" gap. type 별 시맨틱 토큰 스타일 +
//   dismissible 인 경우만 닫기 버튼 노출(닫은 배너는 상위(AppShell)가 세션 동안 sessionStorage 로 기억).
import React from "react";
import { X } from "lucide-react";

export interface AppBanner {
  type: "info" | "success" | "warning" | "error";
  title?: string;
  content: string;
  dismissible: boolean;
}

const TYPE_STYLES: Record<AppBanner["type"], string> = {
  info: "border-primary/30 bg-primary-50 text-primary",
  success: "border-success/30 bg-success-soft text-success",
  warning: "border-warning/30 bg-warning-soft text-warning-fg",
  error: "border-danger/30 bg-danger-soft text-danger",
};

export function bannerKey(banner: AppBanner, index: number): string {
  return `${index}:${banner.type}:${banner.content}`;
}

export interface BannerProps {
  banners: AppBanner[];
  dismissedKeys: Set<string>;
  onDismiss: (key: string) => void;
}

export function Banner({ banners, dismissedKeys, onDismiss }: BannerProps) {
  const visible = banners
    .map((banner, index) => ({ banner, key: bannerKey(banner, index) }))
    .filter(({ key }) => !dismissedKeys.has(key));

  if (visible.length === 0) return null;

  return (
    <div
      data-testid="app-banner-list"
      className="flex flex-col gap-1 border-b border-border px-3.5 py-2"
    >
      {visible.map(({ banner, key }) => (
        <div
          key={key}
          data-testid="app-banner"
          data-banner-type={banner.type}
          role="alert"
          className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${TYPE_STYLES[banner.type]}`}
        >
          <div className="min-w-0 flex-1">
            {banner.title && <p className="font-semibold">{banner.title}</p>}
            <p>{banner.content}</p>
          </div>
          {banner.dismissible && (
            <button
              type="button"
              aria-label="배너 닫기"
              title="배너 닫기"
              onClick={() => onDismiss(key)}
              className="shrink-0 rounded p-0.5 hover:bg-fg/10"
            >
              <X size={14} strokeWidth={2} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
