// artifact-create-handler.ts — artifact_create AgentTool: 기존 db/artifact-service.ts
// (createArtifactService, P5-T4 에 이미 구현된 storage-kind 라우팅+생성자 격리 로직) 를 호출해
// 아티팩트를 등록한다. orchestrator.ts 가 json 결과의 { artifact: {...} } 필드를 duck-typing 으로
// 감지해 artifact_created ChatEvent 로 펼친다(knowledge-search-handler.ts 의 citations 패턴과 동일,
// P10-T2-04). 큰 파일(S3 라우팅)은 이 태스크 범위 밖 — 텍스트형 아티팩트(inline 저장)만 지원.
import { WChatError } from "@wchat/interfaces";
import type {
  AgentTool,
  AgentToolSpec,
  ArtifactRecord,
} from "@wchat/interfaces";
import {
  createArtifactService,
  type ArtifactDataAccess,
} from "../../db/artifact-service.js";

const VALID_TYPES = new Set<ArtifactRecord["type"]>([
  "pptx",
  "pdf",
  "docx",
  "xlsx",
  "markdown",
  "html",
  "image",
  "other",
]);

export interface ArtifactCreateToolDeps {
  da: ArtifactDataAccess;
}

export const artifactCreateToolSpec: AgentToolSpec = {
  name: "artifact_create",
  description:
    "문서/코드 등 아티팩트를 생성해 우측 패널에 표시합니다. filename/type/content 를 받습니다.",
  inputSchema: {
    type: "object",
    properties: {
      filename: { type: "string" },
      type: {
        type: "string",
        enum: [...VALID_TYPES],
      },
      content: { type: "string" },
    },
    required: ["filename", "type", "content"],
  },
  permissionTier: "tool",
  defaultPolicy: "allow",
};

export function createArtifactCreateTool(
  deps: ArtifactCreateToolDeps,
): AgentTool {
  const service = createArtifactService(deps.da);
  return {
    spec: artifactCreateToolSpec,
    async invoke({ toolCallId, args, ctx }) {
      const filename =
        typeof args.filename === "string" ? args.filename.trim() : "";
      const type = typeof args.type === "string" ? args.type : "";
      const content = typeof args.content === "string" ? args.content : "";

      if (
        !filename ||
        !content ||
        !VALID_TYPES.has(type as ArtifactRecord["type"])
      ) {
        return {
          toolCallId,
          content: {
            kind: "error",
            error: new WChatError(
              "INVALID_INPUT",
              "tool",
              false,
              "filename/type/content 가 필요합니다(type 은 지원되는 아티팩트 종류여야 함).",
            ),
          },
        };
      }

      const data = Buffer.from(content, "utf-8");
      const record = await service.createArtifact(
        { userId: ctx.userId },
        {
          sessionId: ctx.sessionId,
          type: type as ArtifactRecord["type"],
          filename,
          data,
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
              sizeBytes: record.sizeBytes,
              downloadUrl: `/api/v1/artifacts/${record.id}/content`,
            },
          },
        },
      };
    },
  };
}
