// lib/citation-plugin.ts — 19-UIUX-UPGRADE.md § P10-T6-09.
//   text_delta 안의 "[N]" 인용 마커를 citation 칩(<sup data-citation-index>)으로 변환하는
//   remark 플러그인. unified/unist-util-visit 는 apps/web 의 직접 의존성이 아니므로(신규
//   dep 미지정) 실제 unified 파이프라인 없이, 플러그인이 받는 최소 mdast-like 트리 구조를
//   직접 구성해 순수 함수로 검증한다.
import { describe, it, expect } from "vitest";
import { remarkCitations } from "../citation-plugin";

interface FakeNode {
  type: string;
  value?: string;
  children?: FakeNode[];
  data?: Record<string, unknown>;
}

describe("remarkCitations", () => {
  it("텍스트 노드 안의 [N] 마커를 citation-chip sup 노드로 분리한다", () => {
    const tree: FakeNode = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "정답은 42입니다[1]." }],
        },
      ],
    };

    remarkCitations()(tree as never);

    const paragraph = tree.children?.[0];
    expect(paragraph?.children).toHaveLength(3);
    expect(paragraph?.children?.[0]).toMatchObject({
      type: "text",
      value: "정답은 42입니다",
    });
    expect(paragraph?.children?.[1]).toMatchObject({
      data: {
        hName: "sup",
        hProperties: { "data-citation-index": "1" },
      },
    });
    expect(paragraph?.children?.[2]).toMatchObject({
      type: "text",
      value: ".",
    });
  });

  it("복수 마커 [1][2] 를 각각 별개의 citation 노드로 변환한다", () => {
    const tree: FakeNode = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "근거[1][2]" }],
        },
      ],
    };

    remarkCitations()(tree as never);

    const paragraph = tree.children?.[0];
    expect(paragraph?.children).toHaveLength(3);
    expect(paragraph?.children?.[1]?.data).toMatchObject({
      hProperties: { "data-citation-index": "1" },
    });
    expect(paragraph?.children?.[2]?.data).toMatchObject({
      hProperties: { "data-citation-index": "2" },
    });
  });

  it("마커가 없는 텍스트는 그대로 둔다", () => {
    const tree: FakeNode = {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", value: "그냥 문장" }] },
      ],
    };

    remarkCitations()(tree as never);

    expect(tree.children?.[0]?.children).toEqual([
      { type: "text", value: "그냥 문장" },
    ]);
  });

  it("children 이 없는 리프 노드(예: inlineCode)는 건드리지 않는다", () => {
    const tree: FakeNode = {
      type: "root",
      children: [{ type: "inlineCode", value: "arr[1]" }],
    };

    expect(() => remarkCitations()(tree as never)).not.toThrow();
    expect(tree.children?.[0]).toEqual({ type: "inlineCode", value: "arr[1]" });
  });
});
