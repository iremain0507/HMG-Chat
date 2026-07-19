// image-generate-handler.ts — image_generate AgentTool: ImageGenPort(실 provider/dev-stub) 로
//   프롬프트에서 이미지를 생성해 kind=image artifact 로 저장하고, orchestrator 가 duck-typing 으로
//   artifact_created ChatEvent 로 펼치는 json { artifact: {...} } 를 반환한다(artifact-create-handler.ts
//   와 동일 패턴, P22-T1-08). org imageGenEnabled=false 는 web_search 의 invoke-time settings resolve
//   와 동일 seam 으로 invoke 시점에 거절한다(assembleBuiltinTools 는 전역 feature 게이트, 여기는 org 게이트).
import { WChatError } from "@wchat/interfaces";
import type { AgentTool, AgentToolSpec } from "@wchat/interfaces";
import {
  createArtifactService,
  type ArtifactDataAccess,
} from "../../db/artifact-service.js";
import type { ImageGenPort } from "../image-gen-port.js";

// settings-service.ts(SettingsService.resolve)와 구조적으로 호환되는 최소 계약만 의존
// (web-search-handler.ts 의 WebSearchSettingsResolverPort 와 동일한 순환 회피 패턴 — 필요 필드만 pick).
export interface ImageGenSettingsResolverPort {
  resolve(orgId: string): Promise<{ imageGenEnabled?: boolean }>;
}

export interface ImageGenerateToolDeps {
  port: ImageGenPort;
  da: ArtifactDataAccess;
  // 주입 시 invoke 시점에 ctx.orgId 로 org 설정(imageGenEnabled)을 동적 조회해 org 별 on/off 를 반영.
  // 미주입 시 비파괴(항상 허용) — 조립 단계(assembleBuiltinTools)의 전역 feature 게이트가 상위에서 결정.
  settings?: ImageGenSettingsResolverPort;
}

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const imageGenerateToolSpec: AgentToolSpec = {
  name: "image_generate",
  description:
    "텍스트 프롬프트로 이미지를 생성해 아티팩트로 저장하고 대화에 인라인 표시합니다.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      size: { type: "string" },
      n: { type: "integer" },
    },
    required: ["prompt"],
  },
  permissionTier: "tool",
  defaultPolicy: "allow",
  tags: ["media", "write"],
};

export function createImageGenerateTool(
  deps: ImageGenerateToolDeps,
): AgentTool {
  const service = createArtifactService(deps.da);
  return {
    spec: imageGenerateToolSpec,
    async invoke({ toolCallId, args, ctx }) {
      const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
      if (!prompt) {
        return {
          toolCallId,
          content: {
            kind: "error",
            error: new WChatError(
              "INVALID_INPUT",
              "tool",
              false,
              "prompt 가 필요합니다.",
            ),
          },
        };
      }

      // org-scoped 게이트: settings 주입 시 imageGenEnabled=false 면 invoke 시점 거절(L1).
      if (deps.settings) {
        try {
          const resolved = await deps.settings.resolve(ctx.orgId);
          if (resolved.imageGenEnabled === false) {
            return {
              toolCallId,
              content: {
                kind: "error",
                error: new WChatError(
                  "IMAGE_GEN_DISABLED",
                  "tool",
                  false,
                  "이 조직에서는 이미지 생성이 비활성화되어 있습니다.",
                ),
              },
            };
          }
        } catch (error) {
          // resolve 실패는 fail-soft — 게이트를 막지 않고 진행(L2, web_search 폴백과 동일 원칙).
          ctx.logger?.warn({
            category: "system",
            msg: "image_generate: org imageGenEnabled resolve 실패 — 허용으로 폴백",
            orgId: ctx.orgId,
            context: { error: String(error) },
          });
        }
      }

      try {
        const size = typeof args.size === "string" ? args.size : undefined;
        const images = await deps.port.generate(prompt, {
          ...(size ? { size } : {}),
          n: 1,
          signal: ctx.signal,
        });
        const image = images[0];
        if (!image) {
          return {
            toolCallId,
            content: {
              kind: "error",
              error: new WChatError(
                "IMAGE_GEN_FAILED",
                "tool",
                true,
                "이미지 생성 결과가 비어 있습니다.",
              ),
            },
          };
        }

        const ext = MIME_EXT[image.mimeType] ?? "png";
        const slug =
          prompt
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 40) || "image";
        const record = await service.createArtifact(
          { userId: ctx.userId },
          {
            sessionId: ctx.sessionId,
            type: "image",
            filename: `${slug}.${ext}`,
            mimeType: image.mimeType,
            data: image.data,
          },
        );

        return {
          toolCallId,
          content: {
            kind: "json",
            data: {
              artifact: {
                artifactId: record.id,
                artifactKind: record.type,
                filename: record.filename,
                mimeType: record.mimeType,
                sizeBytes: record.sizeBytes,
                downloadUrl: `/api/v1/artifacts/${record.id}/content`,
              },
            },
          },
        };
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        return {
          toolCallId,
          content: {
            kind: "error",
            error: new WChatError(
              "IMAGE_GEN_FAILED",
              "tool",
              true,
              "이미지 생성에 실패했습니다.",
              err,
            ),
          },
        };
      }
    },
  };
}
