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
  ArtifactStore,
} from "@wchat/interfaces";
import {
  createArtifactService,
  decideStorageKind,
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
  // 큰 아티팩트(>=256KB)를 S3(로컬은 ObjectStore 위임)로 업로드하는 스토어.
  // 미주입 시 큰 콘텐츠는 INVALID_INPUT 으로 거절(inline 임계 초과라 저장 불가).
  s3Store?: ArtifactStore;
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
      const sizeBytes = data.byteLength;
      const actor = { userId: ctx.userId };

      let record: ArtifactRecord;
      if (decideStorageKind(sizeBytes) === "s3") {
        if (!deps.s3Store) {
          return {
            toolCallId,
            content: {
              kind: "error",
              error: new WChatError(
                "INVALID_INPUT",
                "tool",
                false,
                "콘텐츠가 인라인 저장 한도를 초과했으나 S3 스토어가 구성되지 않았습니다.",
              ),
            },
          };
        }
        // S3 오브젝트 키는 `artifacts/${id}` 이며 조회(routes/artifacts.ts)는
        // row id 로 키를 재계산한다. 따라서 DB 가 생성한 id 를 얻은 뒤 그 id 로 업로드해야
        // 조회 키가 일치한다(chicken-egg 해소). 우선 임시 s3Key 로 row 생성 →
        // record.id 로 put → 실제 locator 로 s3Key 갱신.
        record = await service.createArtifact(actor, {
          sessionId: ctx.sessionId,
          type: type as ArtifactRecord["type"],
          filename,
          data,
          s3Key: "artifacts/pending",
        });
        const { locator } = await deps.s3Store.put({
          artifactId: record.id,
          content: data,
          sizeBytes,
          mimeType: record.mimeType ?? "application/octet-stream",
        });
        record = await deps.da.artifacts.update(record.id, { s3Key: locator });
      } else {
        record = await service.createArtifact(actor, {
          sessionId: ctx.sessionId,
          type: type as ArtifactRecord["type"],
          filename,
          data,
        });
      }

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
