import type {
  AmountAlertLevel,
  AmountPairCompare,
  AlignedPageRow,
  CompareResult,
} from "./types";

/** 金額抽出・比較（¥ の後 / 円 の前） */

export const DEFAULT_AMOUNT_WARN_PERCENT = 5;
export const DEFAULT_AMOUNT_ERROR_PERCENT = 15;

const YEN_AFTER_RE = /¥\s*([\d０-９][\d０-９,，]*)/g;
const YEN_BEFORE_RE = /([\d０-９][\d０-９,，]*)\s*円/g;

function normalizeDigits(s: string): string {
  return s
    .replace(/[０-９]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30),
    )
    .replace(/[，]/g, ",")
    .replace(/,/g, "");
}

/** ページ全文から ¥… / …円 の金額をすべて抽出 */
export function extractYenAmounts(text: string): number[] {
  const found = new Set<number>();

  for (const re of [YEN_AFTER_RE, YEN_BEFORE_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = normalizeDigits(m[1]!);
      if (!raw) continue;
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) found.add(n);
    }
  }

  return [...found].sort((a, b) => a - b);
}

/** 請求書1ページの代表金額（複数あるときは最大＝合計想定） */
export function primaryPageAmount(text: string): number | null {
  const amounts = extractYenAmounts(text);
  if (amounts.length === 0) return null;
  return amounts[amounts.length - 1]!;
}

export function worstAmountAlert(
  alerts: AmountAlertLevel[],
): AmountAlertLevel {
  if (alerts.some((a) => a === "error")) return "error";
  if (alerts.some((a) => a === "warn")) return "warn";
  return "none";
}

export interface PageAmountCompareResult {
  amountsA: number[];
  amountsB: number[];
  amountPairs: AmountPairCompare[];
  amountAlert: AmountAlertLevel;
}

/** ページ内の金額を昇順で並べ、同じ順番の A↔B をそれぞれ比較 */
export function comparePageAmounts(
  textA: string,
  textB: string,
  warnPercent = DEFAULT_AMOUNT_WARN_PERCENT,
  errorPercent = DEFAULT_AMOUNT_ERROR_PERCENT,
): PageAmountCompareResult {
  const amountsA = extractYenAmounts(textA);
  const amountsB = extractYenAmounts(textB);
  const maxLen = Math.max(amountsA.length, amountsB.length);
  const amountPairs: AmountPairCompare[] = [];

  for (let i = 0; i < maxLen; i++) {
    const amountA = amountsA[i] ?? null;
    const amountB = amountsB[i] ?? null;
    const alert = compareAmountAlert(
      amountA,
      amountB,
      warnPercent,
      errorPercent,
    );
    amountPairs.push({ amountA, amountB, alert });
  }

  return {
    amountsA,
    amountsB,
    amountPairs,
    amountAlert: worstAmountAlert(amountPairs.map((p) => p.alert)),
  };
}

/** 片側ページのみの金額（削除・追加行） */
export function amountsForSinglePage(
  text: string,
  side: "A" | "B",
): PageAmountCompareResult {
  const amounts = extractYenAmounts(text);
  const amountPairs: AmountPairCompare[] = amounts.map((n) =>
    side === "A"
      ? { amountA: n, amountB: null, alert: "none" as const }
      : { amountA: null, amountB: n, alert: "none" as const },
  );
  return {
    amountsA: side === "A" ? amounts : [],
    amountsB: side === "B" ? amounts : [],
    amountPairs,
    amountAlert: "none",
  };
}

export function formatAmountPairLine(
  pair: AmountPairCompare,
  index: number,
  total: number,
): string {
  const a = pair.amountA != null ? formatYen(pair.amountA) : "—";
  const b = pair.amountB != null ? formatYen(pair.amountB) : "—";
  const prefix = total > 1 ? `${index + 1}. ` : "";
  const mark =
    pair.alert === "error" ? " ⚠" : pair.alert === "warn" ? " △" : "";
  return `${prefix}A ${a} ↔ B ${b}${mark}`;
}

export function formatAmountLinesForSide(
  pairs: AmountPairCompare[],
  side: "A" | "B",
): string[] {
  if (pairs.length === 0) return [];
  if (side === "A") {
    return pairs.map((p, i) => formatAmountPairLine(p, i, pairs.length));
  }
  return pairs.map((p, i) => {
    const prefix = pairs.length > 1 ? `${i + 1}. ` : "";
    const b = p.amountB != null ? formatYen(p.amountB) : "—";
    return `${prefix}${b}`;
  });
}

/** 旧保存データ（amountA/B のみ）を新形式へ */
export function normalizeAmountPairs(
  row: {
    amountsA?: number[];
    amountsB?: number[];
    amountPairs?: AmountPairCompare[];
    amountAlert?: AmountAlertLevel;
    amountA?: number | null;
    amountB?: number | null;
  },
): Pick<
  PageAmountCompareResult,
  "amountsA" | "amountsB" | "amountPairs" | "amountAlert"
> {
  if (row.amountPairs && row.amountPairs.length > 0) {
    return {
      amountsA: row.amountsA ?? [],
      amountsB: row.amountsB ?? [],
      amountPairs: row.amountPairs,
      amountAlert: row.amountAlert ?? worstAmountAlert(row.amountPairs.map((p) => p.alert)),
    };
  }
  if (row.amountA != null || row.amountB != null) {
    const pair: AmountPairCompare = {
      amountA: row.amountA ?? null,
      amountB: row.amountB ?? null,
      alert: row.amountAlert ?? "none",
    };
    return {
      amountsA: row.amountA != null ? [row.amountA] : [],
      amountsB: row.amountB != null ? [row.amountB] : [],
      amountPairs: [pair],
      amountAlert: pair.alert,
    };
  }
  return {
    amountsA: [],
    amountsB: [],
    amountPairs: [],
    amountAlert: "none",
  };
}

export function normalizeCompareRows(rows: AlignedPageRow[]): AlignedPageRow[] {
  return rows.map((row) => {
    const amt = normalizeAmountPairs(row);
    return { ...row, ...amt };
  });
}

export function normalizeCompareResult(result: CompareResult): CompareResult {
  return { ...result, rows: normalizeCompareRows(result.rows) };
}

export function formatYen(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}

/** 相対差分率 0〜1（大きい方を基準） */
export function amountRelativeDiff(a: number, b: number): number {
  const base = Math.max(a, b, 1);
  return Math.abs(a - b) / base;
}

export function compareAmountAlert(
  amountA: number | null,
  amountB: number | null,
  warnPercent = DEFAULT_AMOUNT_WARN_PERCENT,
  errorPercent = DEFAULT_AMOUNT_ERROR_PERCENT,
): AmountAlertLevel {
  if (amountA == null || amountB == null) return "none";
  const diff = amountRelativeDiff(amountA, amountB);
  const warn = warnPercent / 100;
  const err = errorPercent / 100;
  if (diff >= err) return "error";
  if (diff >= warn) return "warn";
  return "none";
}
