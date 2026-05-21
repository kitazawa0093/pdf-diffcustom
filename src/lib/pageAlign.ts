import { diffChars } from "diff";
import {
  comparePageAmounts,
  amountsForSinglePage,
  DEFAULT_AMOUNT_ERROR_PERCENT,
  DEFAULT_AMOUNT_WARN_PERCENT,
} from "./invoiceAmount";
import type { PageAmountCompareResult } from "./invoiceAmount";
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

/** 宛先（名前・社名）同士の類似度。両方に宛先があるときだけ 0〜1、なければ 0 */
function nameAnchorSimilarity(pageA: PageText, pageB: PageText): number {
  const hA = normalizeAnchorPart(anchorForPage(pageA));
  const hB = normalizeAnchorPart(anchorForPage(pageB));
  if (!hA || !hB) return 0;
  return pageSimilarity(hA, hB);
}

function anchorsExactlyMatch(pageA: PageText, pageB: PageText): boolean {
  const hA = normalizeAnchorPart(anchorForPage(pageA));
  const hB = normalizeAnchorPart(anchorForPage(pageB));
  return hA.length > 0 && hB.length > 0 && hA === hB;
}

interface PairCandidateScore {
  nameSim: number;
  exactName: boolean;
  fullPage: number;
}

function scorePairCandidate(pageA: PageText, pageB: PageText): PairCandidateScore {
  return {
    nameSim: nameAnchorSimilarity(pageA, pageB),
    exactName: anchorsExactlyMatch(pageA, pageB),
    fullPage: pageSimilarity(pageA.text, pageB.text),
  };
}

/** 候補に入れるか（宛先ありなら名前一致率、なければ全文一致率で判定） */
function isPairEligible(
  pageA: PageText,
  pageB: PageText,
  threshold: number,
): boolean {
  const anchorA = normalizeAnchorPart(anchorForPage(pageA));
  const anchorB = normalizeAnchorPart(anchorForPage(pageB));
  const { nameSim, fullPage } = scorePairCandidate(pageA, pageB);

  if (anchorA && anchorB) return nameSim >= threshold;
  return fullPage >= threshold;
}

function betterPairCandidate(a: PairCandidateScore, b: PairCandidateScore): boolean {
  if (a.exactName !== b.exactName) return a.exactName > b.exactName;
  const NAME_EPS = 1e-6;
  if (Math.abs(a.nameSim - b.nameSim) > NAME_EPS) return a.nameSim > b.nameSim;
  return a.fullPage > b.fullPage;
}

function amountForPage(page: PageText | null): PageAmountCompareResult {
  if (!page) {
    return {
      amountsA: [],
      amountsB: [],
      amountPairs: [],
      amountAlert: "none",
    };
  }
  return amountsForSinglePage(page.text, "A");
}

function amountForPageB(page: PageText): PageAmountCompareResult {
  return amountsForSinglePage(page.text, "B");
}

function compareCandidateScores(
  a: PairCandidateScore,
  b: PairCandidateScore,
): number {
  if (betterPairCandidate(a, b)) return -1;
  if (betterPairCandidate(b, a)) return 1;
  return 0;
}

/**
 * A のページ順で割り当て。候補 B が既に別の A に付いていても、
 * 今の A の方がより良い一致なら B を取り、押し出された A を別の B に再割り当てする。
 */
function assignPagesWithRebalance(
  pagesA: PageText[],
  pagesB: PageText[],
  threshold: number,
): Map<number, number> {
  const aToB = new Map<number, number>();
  const bToA = new Map<number, number>();

  function clearAssignment(iA: number): void {
    const iB = aToB.get(iA);
    if (iB === undefined) return;
    aToB.delete(iA);
    bToA.delete(iB);
  }

  function setAssignment(iA: number, iB: number): void {
    clearAssignment(iA);
    aToB.set(iA, iB);
    bToA.set(iB, iA);
  }

  function assignPage(iA: number): void {
    const pageA = pagesA[iA]!;
    const candidates: { iB: number; score: PairCandidateScore }[] = [];

    for (let iB = 0; iB < pagesB.length; iB++) {
      const pageB = pagesB[iB]!;
      if (!isPairEligible(pageA, pageB, threshold)) continue;
      candidates.push({ iB, score: scorePairCandidate(pageA, pageB) });
    }

    candidates.sort((x, y) => {
      const cmp = compareCandidateScores(x.score, y.score);
      return cmp !== 0 ? cmp : x.iB - y.iB;
    });

    for (const { iB, score } of candidates) {
      const owner = bToA.get(iB);
      if (owner === undefined) {
        setAssignment(iA, iB);
        return;
      }
      if (owner === iA) return;

      const ownerScore = scorePairCandidate(pagesA[owner]!, pagesB[iB]!);
      if (betterPairCandidate(score, ownerScore)) {
        clearAssignment(owner);
        setAssignment(iA, iB);
        assignPage(owner);
        return;
      }
    }
  }

  for (let iA = 0; iA < pagesA.length; iA++) {
    if (!aToB.has(iA)) assignPage(iA);
  }

  return aToB;
}

/**
 * A のページ順のまま B とペアにする（押し出し再割り当てあり）。
 * 両方に宛先があるとき: 名前一致率が閾値以上の候補のうち、完全一致 → 名前一致率 → 全文一致率の順で最良を選ぶ。
 * 宛先が取れないときだけ全文一致率で候補・並び替え。
 */
export function alignAndComparePages(
  pagesA: PageText[],
  pagesB: PageText[],
  matchThreshold = DEFAULT_MATCH_THRESHOLD,
  amountWarnPercent = DEFAULT_AMOUNT_WARN_PERCENT,
  amountErrorPercent = DEFAULT_AMOUNT_ERROR_PERCENT,
): AlignedPageRow[] {
  const threshold = Math.min(1, Math.max(0, matchThreshold));
  const pairByA = assignPagesWithRebalance(pagesA, pagesB, threshold);
  const usedB = new Set(pairByA.values());
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
      const amounts = comparePageAmounts(
        pageA.text,
        pageB.text,
        amountWarnPercent,
        amountErrorPercent,
      );
      const nameSim = nameAnchorSimilarity(pageA, pageB);
      rows.push({
        id,
        pageA: pageA.pageNumber,
        pageB: pageB.pageNumber,
        kind,
        anchorA: anchorForPage(pageA),
        anchorB: anchorForPage(pageB),
        nameMatchPercent:
          nameSim > 0 ? Math.round(nameSim * 100) : null,
        amountsA: amounts.amountsA,
        amountsB: amounts.amountsB,
        amountPairs: amounts.amountPairs,
        amountAlert: amounts.amountAlert,
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
    const amounts = amountForPage(pageA);
    rows.push({
      id,
      pageA: pageA.pageNumber,
      pageB: null,
      kind: "delete",
      anchorA: anchorForPage(pageA),
      anchorB: "",
      nameMatchPercent: null,
      amountsA: amounts.amountsA,
      amountsB: [],
      amountPairs: amounts.amountPairs,
      amountAlert: "none",
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
    const amounts = amountForPageB(pageB);
    rows.push({
      id,
      pageA: null,
      pageB: pageB.pageNumber,
      kind: "insert",
      anchorA: "",
      anchorB: anchorForPage(pageB),
      nameMatchPercent: null,
      amountsA: [],
      amountsB: amounts.amountsB,
      amountPairs: amounts.amountPairs,
      amountAlert: "none",
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
  amountWarnPercent = DEFAULT_AMOUNT_WARN_PERCENT,
  amountErrorPercent = DEFAULT_AMOUNT_ERROR_PERCENT,
): CompareResult {
  const rows = alignAndComparePages(
    pagesA,
    pagesB,
    matchThreshold,
    amountWarnPercent,
    amountErrorPercent,
  );
  const totalChanges = rows.reduce((n, r) => n + r.diff.changeCount, 0);

  return {
    pageCountA: pagesA.length,
    pageCountB: pagesB.length,
    rows,
    totalChanges,
  };
}
