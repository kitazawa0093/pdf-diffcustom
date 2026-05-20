import { diffChars } from "diff";
import { unionRects } from "./pdfExtract";
import type {
  CharBox,
  DiffChangeRecord,
  DiffKind,
  HighlightRect,
  PageDiffResult,
  PageText,
  PdfRect,
} from "./types";

function highlightMinWidth(char: string, height: number): number {
  if (char === " " || char === "\u3000") return height * 0.18;
  return height * 0.3;
}

function charsToHighlights(
  chars: CharBox[],
  kind: DiffKind,
): HighlightRect[] {
  if (chars.length === 0) return [];
  const merged: HighlightRect[] = [];
  let group: CharBox[] = [chars[0]!];

  const flush = () => {
    if (group.length === 0) return;
    const rect = unionRects(group.map((c) => c.rect));
    if (!rect) return;
    const minW = highlightMinWidth(group[0]!.char, rect.height);
    if (rect.width < minW) rect.width = minW;
    merged.push({ rect, kind });
    group = [];
  };

  for (let i = 1; i < chars.length; i++) {
    const prev = group[group.length - 1]!;
    const cur = chars[i]!;
    const hGap = cur.rect.x - (prev.rect.x + prev.rect.width);
    const gap =
      hGap < -1 ||
      hGap > Math.max(2, prev.rect.height * 0.08) ||
      Math.abs(cur.rect.y - prev.rect.y) > prev.rect.height * 0.45;

    if (gap) {
      flush();
      group = [cur];
    } else {
      group.push(cur);
    }
  }
  flush();
  return merged;
}

export function diffPagePair(
  pageA: PageText | null,
  pageB: PageText | null,
): PageDiffResult {
  const textA = pageA?.text ?? "";
  const textB = pageB?.text ?? "";

  const parts = diffChars(textA, textB);
  const highlightsA: HighlightRect[] = [];
  const highlightsB: HighlightRect[] = [];
  const changes: DiffChangeRecord[] = [];
  let idxA = 0;
  let idxB = 0;
  let changeCount = 0;

  for (const part of parts) {
    const len = part.value.length;
    if (part.added) {
      const boxes = pageB?.chars.slice(idxB, idxB + len) ?? [];
      highlightsB.push(...charsToHighlights(boxes, "insert"));
      if (len > 0) {
        changeCount += len;
        changes.push({ kind: "insert", oldText: "", newText: part.value, length: len });
      }
      idxB += len;
    } else if (part.removed) {
      const boxes = pageA?.chars.slice(idxA, idxA + len) ?? [];
      highlightsA.push(...charsToHighlights(boxes, "delete"));
      if (len > 0) {
        changeCount += len;
        changes.push({ kind: "delete", oldText: part.value, newText: "", length: len });
      }
      idxA += len;
    } else {
      idxA += len;
      idxB += len;
    }
  }

  return {
    pageA: pageA?.pageNumber ?? null,
    pageB: pageB?.pageNumber ?? null,
    highlightsA,
    highlightsB,
    changeCount,
    changes,
  };
}

/** 抽出スケール (1) から表示スケールへ合わせる */
export function scaleRect(
  rect: PdfRect,
  displayScale: number,
  extractScale = 1,
): PdfRect {
  const ratio = displayScale / extractScale;
  return {
    x: rect.x * ratio,
    y: rect.y * ratio,
    width: rect.width * ratio,
    height: rect.height * ratio,
  };
}
