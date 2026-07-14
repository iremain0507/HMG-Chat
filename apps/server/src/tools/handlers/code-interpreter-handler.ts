// code-interpreter-handler.ts — code_interpreter AgentTool: SandboxTransport(E2B 실구현/dev-stub) 를
//   DI 받아 코드를 격리 샌드박스에서 실행한다. stdout/stderr 를 버퍼링해 text 결과로 반환하고,
//   실행 중 OUTPUT_DIR 에 생성된 파일이 있으면 artifact-service 로 저장해 json 결과의
//   { artifact: {...} } 로 반환한다 — orchestrator.ts 가 이를 duck-typing 해 artifact_created
//   ChatEvent 로 펼친다(artifact-create-handler.ts 와 동일 관례, 신규 ChatEvent 변형 없음).
//   ctx.signal 은 transport.start/runCommand 에 그대로 전달하고 청크 소비 중에도 매번 확인해
//   취소를 즉시 관통시킨다(20-MULTI-AGENT-TOOL.md §20.4-5).
import { WChatError } from "@wchat/interfaces";
import type {
  AgentTool,
  AgentToolSpec,
  SandboxTransport,
} from "@wchat/interfaces";
import {
  createArtifactService,
  type ArtifactDataAccess,
} from "../../db/artifact-service.js";

const OUTPUT_DIR = "/home/user/outputs";

type Language = "python" | "javascript" | "bash";

const COMMAND_BY_LANGUAGE: Record<Language, (path: string) => string> = {
  python: (path) => `python3 ${path}`,
  javascript: (path) => `node ${path}`,
  bash: (path) => `bash ${path}`,
};

const EXT_BY_LANGUAGE: Record<Language, string> = {
  python: "py",
  javascript: "js",
  bash: "sh",
};

function isLanguage(value: string): value is Language {
  return value in EXT_BY_LANGUAGE;
}

export interface CodeInterpreterToolDeps {
  transport: SandboxTransport;
  da: ArtifactDataAccess;
  templateId?: string;
}

export const codeInterpreterToolSpec: AgentToolSpec = {
  name: "code_interpreter",
  description:
    "격리된 샌드박스에서 코드를 실행해 표준출력을 반환합니다. 실행 중 생성된 파일은 아티팩트로 저장되어 우측 패널에 표시됩니다.",
  inputSchema: {
    type: "object",
    properties: {
      code: { type: "string" },
      language: { type: "string", enum: ["python", "javascript", "bash"] },
    },
    required: ["code"],
  },
  permissionTier: "tool",
  // 샌드박스 egress 기본 차단(20-MULTI-AGENT-TOOL.md §20.4-7)이 완화책 — web_search/
  // artifact_create 와 동일하게 allow(순수 계산 취급). 실 배포 시 위험 판단이 바뀌면
  // 이 값만 조정하면 된다(전용 필드 신설 없이 tags 로 역량만 인코딩).
  defaultPolicy: "allow",
  tags: ["code-exec"],
};

export function createCodeInterpreterTool(
  deps: CodeInterpreterToolDeps,
): AgentTool {
  const artifactService = createArtifactService(deps.da);

  return {
    spec: codeInterpreterToolSpec,
    async invoke({ toolCallId, args, ctx }) {
      const code = typeof args.code === "string" ? args.code : "";
      if (!code.trim()) {
        return {
          toolCallId,
          content: {
            kind: "error",
            error: new WChatError(
              "INVALID_INPUT",
              "tool",
              false,
              "code 가 필요합니다.",
            ),
          },
        };
      }
      const language: Language =
        typeof args.language === "string" && isLanguage(args.language)
          ? args.language
          : "python";
      const codePath = `/home/user/main.${EXT_BY_LANGUAGE[language]}`;

      const handle = await deps.transport.start(
        {
          sessionId: ctx.sessionId,
          templateId: deps.templateId ?? "wchat-default-v1",
        },
        ctx.signal,
      );

      try {
        await deps.transport.writeFile(handle, codePath, code);

        let stdout = "";
        let stderr = "";
        for await (const chunk of deps.transport.runCommand(
          handle,
          COMMAND_BY_LANGUAGE[language](codePath),
          {},
          ctx.signal,
        )) {
          if (ctx.signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
          if (chunk.type === "stdout") stdout += chunk.data;
          else if (chunk.type === "stderr") stderr += chunk.data;
        }
        if (ctx.signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        let files: { name: string; isDir: boolean; size: number }[] = [];
        try {
          files = await deps.transport.listDir(handle, OUTPUT_DIR);
        } catch {
          files = [];
        }
        const generated = files
          .filter((f) => !f.isDir)
          .sort((a, b) => a.name.localeCompare(b.name))[0];

        if (!generated) {
          return {
            toolCallId,
            content: { kind: "text", text: stdout || stderr },
          };
        }

        const fileData = await deps.transport.readFile(
          handle,
          `${OUTPUT_DIR}/${generated.name}`,
        );
        const record = await artifactService.createArtifact(
          { userId: ctx.userId },
          {
            sessionId: ctx.sessionId,
            type: "other",
            filename: generated.name,
            data: fileData,
          },
        );

        return {
          toolCallId,
          content: {
            kind: "json",
            data: {
              stdout,
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
      } finally {
        await deps.transport.stop(handle).catch(() => {});
      }
    },
  };
}
