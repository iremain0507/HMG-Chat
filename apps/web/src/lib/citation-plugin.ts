// lib/citation-plugin.ts — 19-UIUX-UPGRADE.md § P10-T6-09.
//   text_delta 안의 "[N]" 인용 마커를 citation 칩(<sup data-citation-index>)으로 변환하는
//   remark 플러그인. unified/unist-util-visit 는 apps/web 의 직접 의존성이 아니므로(신규
//   dep 미지정) 실제 unified 파이프라인에 얹되(remark-rehype 의 data.hName/hProperties
//   패스스루 관례를 사용) 트리 순회는 의존성 없이 직접 구현한다.
export interface CitationTreeNode {
  type: string;
  value?: string;
  children?: CitationTreeNode[];
  data?: Record<string, unknown>;
}

const CITATION_MARKER = /\[(\d+)\]/g;

function splitTextNode(node: CitationTreeNode): CitationTreeNode[] {
  if (node.type !== "text" || typeof node.value !== "string") return [node];
  const value = node.value;
  CITATION_MARKER.lastIndex = 0;
  if (!CITATION_MARKER.test(value)) return [node];
  CITATION_MARKER.lastIndex = 0;

  const parts: CitationTreeNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CITATION_MARKER.exec(value)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: value.slice(lastIndex, match.index) });
    }
    parts.push({
      type: "citationChip",
      data: {
        hName: "sup",
        hProperties: { "data-citation-index": match[1] },
      },
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < value.length) {
    parts.push({ type: "text", value: value.slice(lastIndex) });
  }
  return parts;
}

function visit(node: CitationTreeNode): void {
  if (!Array.isArray(node.children)) return;
  node.children = node.children.flatMap((child) => {
    visit(child);
    return splitTextNode(child);
  });
}

export function remarkCitations() {
  return function transformer(tree: CitationTreeNode): void {
    visit(tree);
  };
}
