import { diffChars } from "diff";
import type { AlignedPageRow, CompareResult, CharBox, PageText } from "./types";
import { diffPagePair } from "./diffPages";

export const DEFAULT_MATCH_THRESHOLD = 0.82;

/** ページ左上カラム（宛先ブロック）の矩形比率 */
const HEADER_REGION_WIDTH_RATIO = 0.62;
const HEADER_REGION_HEIGHT_RATIO = 0.45;
const BOX_SORT_Y_TOLERANCE = 2;
const LINE_Y_TOLERANCE = 4;

/** 「御中」「様」と同じ行内で、マーカー直前に取る最大文字数 */
export const RECIPIENT_PREFIX_MAX_LEN = 80;
const RECIPIENT_MARKERS = ["御中", "様"] as const;

/** 0〜1 の類似度（請求書ページの対応付け用） */
export function pageSimilarity(textA: string, textB: string): number {
  if (textA === textB) return 1;
  if (!textA || !textB) return 0;

  const parts = diffChars(textA, textB);
  let equal = 0;
  for (const p of parts) {
    if (!p.added && !p.removed) equal += p.value.length;
  }
  return (2 * equal) / (textA.length + textB.length);
}

function pageExtent(chars: CharBox[]): { width: number; height: number } {
  let width = 0;
  let height = 0;
  for (const c of chars) {
    width = Math.max(width, c.rect.x + c.rect.width);
    height = Math.max(height, c.rect.y + c.rect.height);
  }
  return { width: width || 1, height: height || 1 };
}

/** pdfExtract と同様の読み順（ゆるい行クラスタリング付き） */
function sortBoxesReadingOrder(chars: CharBox[]): CharBox[] {
  return [...chars].sort((a, b) => {
    const yDiff = a.rect.y - b.rect.y;
    if (Math.abs(yDiff) > BOX_SORT_Y_TOLERANCE) return yDiff;
    return a.rect.x - b.rect.x;
  });
}

function charOverlapsHeaderRegion(c: CharBox, xMax: number, yMax: number): boolean {
  const { x, y, width } = c.rect;
  const r = x + width;
  const b = y + c.rect.height;
  return x < xMax && y < yMax && r > 0 && b > 0;
}

function charsToText(chars: CharBox[]): string {
  return sortBoxesReadingOrder(chars)
    .map((c) => c.char)
    .join("");
}

function clusterTextLines(chars: CharBox[]): string[] {
  if (chars.length === 0) return [];
  const sorted = sortBoxesReadingOrder(chars);
  const groups: CharBox[][] = [];
  let current: CharBox[] = [];
  let anchorY = sorted[0]!.rect.y;

  for (const c of sorted) {
    if (current.length === 0 || Math.abs(c.rect.y - anchorY) <= LINE_Y_TOLERANCE) {
      current.push(c);
      if (current.length === 1) anchorY = c.rect.y;
    } else {
      groups.push(current);
      current = [c];
      anchorY = c.rect.y;
    }
  }
  if (current.length > 0) groups.push(current);

  return groups
    .map((lineChars) =>
      [...lineChars]
        .sort((a, b) => a.rect.x - b.rect.x)
        .map((c) => c.char)
        .join("")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => line.length > 0);
}

function normalizeAnchorPart(text: string): string {
  return text.replace(/\s+/g, "").trim();
}

function extractAnchorsFromLine(
  line: string,
  prefixMaxLen = RECIPIENT_PREFIX_MAX_LEN,
): string[] {
  const parts: string[] = [];

  for (const marker of RECIPIENT_MARKERS) {
    let from = 0;
    while (from < line.length) {
      const idx = line.indexOf(marker, from);
      if (idx === -1) break;

      if (marker === "様" && idx > 0 && line[idx - 1] === "同") {
        from = idx + 1;
        continue;
      }

      let before = normalizeAnchorPart(line.slice(0, idx));
      if (before.length > prefixMaxLen) {
        before = before.slice(-prefixMaxLen);
      }
      if (before) parts.push(before);
      from = idx + marker.length;
    }
  }

  return parts;
}

/** 行単位で「御中」「様」の直前文字列を抽出（複数あれば連結） */
export function extractRecipientAnchorsFromLines(
  lines: string[],
  prefixMaxLen = RECIPIENT_PREFIX_MAX_LEN,
): string {
  const parts: string[] = [];
  for (const line of lines) {
    parts.push(...extractAnchorsFromLine(line, prefixMaxLen));
  }
  return [...new Set(parts)].join(" ");
}

/**
 * 平坦な文字列から抽出（行分割できない場合のフォールバック）。
 * 固定長スライスなので、行単位抽出ほど正確ではない。
 */
export function extractTextBeforeRecipientMarkers(
  text: string,
  prefixLen = RECIPIENT_PREFIX_MAX_LEN,
): string {
  const parts: string[] = [];

  for (const marker of RECIPIENT_MARKERS) {
    let from = 0;
    while (from < text.length) {
      const idx = text.indexOf(marker, from);
      if (idx === -1) break;

      if (marker === "様" && idx > 0 && text[idx - 1] === "同") {
        from = idx + 1;
        continue;
      }

      let before = normalizeAnchorPart(text.slice(Math.max(0, idx - prefixLen), idx));
      if (before) parts.push(before);
      from = idx + marker.length;
    }
  }

  return [...new Set(parts)].join(" ");
}

/**
 * ページ対応の手掛かりテキスト。
 * 左上カラムを行に分け、「御中」「様」がある行だけからマーカー直前を取る。
 */
export function extractPageAnchorText(chars: CharBox[]): string {
  if (chars.length === 0) return "";

  const { width: pageW, height: pageH } = pageExtent(chars);
  const xMax = pageW * HEADER_REGION_WIDTH_RATIO;
  const yMax = pageH * HEADER_REGION_HEIGHT_RATIO;
  const inRegion = chars.filter((c) => charOverlapsHeaderRegion(c, xMax, yMax));

  const regionAnchor = extractRecipientAnchorsFromLines(clusterTextLines(inRegion));
  if (regionAnchor) return regionAnchor;

  const pageAnchor = extractRecipientAnchorsFromLines(clusterTextLines(chars));
  if (pageAnchor) return pageAnchor;

  return extractTextBeforeRecipientMarkers(charsToText(chars));
}

/** @deprecated extractPageAnchorText を使用 */
export function extractUpperLeftText(chars: CharBox[]): string {
  return extractPageAnchorText(chars);
}

function formatLabel(pageA: number | null, pageB: number | null): string {
  if (pageA != null && pageB != null) return `A p.${pageA} ↔ B p.${pageB}`;
  if (pageA != null) return `A p.${pageA}（Bに無し）`;
  return `B p.${pageB}（Aに無し）`;
}

function anchorForPage(page: PageText | null): string {
  if (!page) return "";
  return extractPageAnchorText(page.chars);
}

/**
 * 両方に宛先文字列があるときだけ判定する。
 * - 完全一致: true
 * - 不一致: false
 * - どちらか未取得: null（宛先条件は適用しない）
 */
function recipientAnchorsExactlyMatch(
  pageA: PageText,
  pageB: PageText,
): boolean | null {
  const anchorA = normalizeAnchorPart(anchorForPage(pageA));
  const anchorB = normalizeAnchorPart(anchorForPage(pageB));
  if (anchorA && anchorB) return anchorA === anchorB;
  return null;
}

/** ペア候補: 宛先は完全一致（両方ある場合）、本文は一致率が閾値以上 */
function isPairCandidate(
  pageA: PageText,
  pageB: PageText,
  threshold: number,
): { eligible: boolean; fullPage: number } {
  const anchorMatch = recipientAnchorsExactlyMatch(pageA, pageB);
  if (anchorMatch === false) {
    return { eligible: false, fullPage: 0 };
  }

  const fullPage = pageSimilarity(pageA.text, pageB.text);
  return { eligible: fullPage >= threshold, fullPage };
}

/**
 * A の 1 ページ目から順に、まだ使っていない B のうちページとペアにする。
 * 候補条件: 両方に宛先があれば完全一致必須、かつ全文一致率が閾値以上。
 * 宛先が未取得の場合は全文一致率のみで判定。候補が複数なら全文一致率が最も高い B を選ぶ。
 * 候補がなければその A は未ペア（削除側）。残った B は追加側。
 * 表示順は A のページ順を維持し、B にのみ存在するページは末尾に並べる。
 */
export function alignAndComparePages(
  pagesA: PageText[],
  pagesB: PageText[],
  matchThreshold = DEFAULT_MATCH_THRESHOLD,
): AlignedPageRow[] {
  const threshold = Math.min(1, Math.max(0, matchThreshold));
  const usedB = new Set<number>();
  const pairs: { iA: number; iB: number }[] = [];

  for (let iA = 0; iA < pagesA.length; iA++) {
    const pageA = pagesA[iA]!;
    let bestI = -1;
    let bestFullPage = -1;
    for (let iB = 0; iB < pagesB.length; iB++) {
      if (usedB.has(iB)) continue;
      const pageB = pagesB[iB]!;
      const { eligible, fullPage } = isPairCandidate(pageA, pageB, threshold);
      if (!eligible) continue;
      if (fullPage > bestFullPage) {
        bestFullPage = fullPage;
        bestI = iB;
      }
    }
    if (bestI >= 0) {
      usedB.add(bestI);
      pairs.push({ iA, iB: bestI });
    }
  }

  const pairByA = new Map<number, number>();
  for (const { iA, iB } of pairs) {
    pairByA.set(iA, iB);
  }
  const unmatchedB = pagesB.map((_, i) => i).filter((i) => !usedB.has(i));

  const rows: AlignedPageRow[] = [];
  let id = 0;

  for (let iA = 0; iA < pagesA.length; iA++) {
    const pageA = pagesA[iA]!;
    const iB = pairByA.get(iA);
    id++;

    if (iB !== undefined) {
      const pageB = pagesB[iB]!;
      const diff = diffPagePair(pageA, pageB);
      const kind: AlignedPageRow["kind"] =
        diff.changeCount > 0 ? "change" : "match";
      rows.push({
        id,
        pageA: pageA.pageNumber,
        pageB: pageB.pageNumber,
        kind,
        anchorA: anchorForPage(pageA),
        anchorB: anchorForPage(pageB),
        diff: {
          ...diff,
          pageA: pageA.pageNumber,
          pageB: pageB.pageNumber,
          kind,
        },
        label: formatLabel(pageA.pageNumber, pageB.pageNumber),
      });
      continue;
    }

    const diff = diffPagePair(pageA, null);
    rows.push({
      id,
      pageA: pageA.pageNumber,
      pageB: null,
      kind: "delete",
      anchorA: anchorForPage(pageA),
      anchorB: "",
      diff: {
        ...diff,
        pageA: pageA.pageNumber,
        pageB: null,
        kind: "delete",
      },
      label: formatLabel(pageA.pageNumber, null),
    });
  }

  for (const iB of unmatchedB) {
    id++;
    const pageB = pagesB[iB]!;
    const diff = diffPagePair(null, pageB);
    rows.push({
      id,
      pageA: null,
      pageB: pageB.pageNumber,
      kind: "insert",
      anchorA: "",
      anchorB: anchorForPage(pageB),
      diff: {
        ...diff,
        pageA: null,
        pageB: pageB.pageNumber,
        kind: "insert",
      },
      label: formatLabel(null, pageB.pageNumber),
    });
  }

  return rows;
}

export function compareDocuments(
  pagesA: PageText[],
  pagesB: PageText[],
  matchThreshold = DEFAULT_MATCH_THRESHOLD,
): CompareResult {
  const rows = alignAndComparePages(pagesA, pagesB, matchThreshold);
  const totalChanges = rows.reduce((n, r) => n + r.diff.changeCount, 0);

  return {
    pageCountA: pagesA.length,
    pageCountB: pagesB.length,
    rows,
    totalChanges,
  };
}
