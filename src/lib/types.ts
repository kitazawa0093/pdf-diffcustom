/** viewport 座標（左上原点）の矩形。抽出時 scale=1 */
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 1文字とその位置 */
export interface CharBox {
  char: string;
  rect: PdfRect;
  index: number;
}

export interface PageText {
  pageNumber: number;
  chars: CharBox[];
  text: string;
}

export type DiffKind = "equal" | "insert" | "delete";

export interface HighlightRect {
  rect: PdfRect;
  kind: DiffKind;
}

export type PageAlignKind = "match" | "change" | "delete" | "insert";

export interface DiffChangeRecord {
  kind: "delete" | "insert";
  oldText: string;
  newText: string;
  length: number;
}

export interface PageDiffResult {
  /** ナビ用 id（整列後の連番） */
  id?: number;
  pageA: number | null;
  pageB: number | null;
  kind?: PageAlignKind;
  /** A側に表示するハイライト */
  highlightsA: HighlightRect[];
  /** B側に表示するハイライト */
  highlightsB: HighlightRect[];
  changeCount: number;
  /** CSV 出力用の差分一覧 */
  changes: DiffChangeRecord[];
}

export interface CompareResult {
  pageCountA: number;
  pageCountB: number;
  /** 整列後の行（追加・削除ページを含む） */
  rows: AlignedPageRow[];
  totalChanges: number;
}

export type AmountAlertLevel = "none" | "warn" | "error";

/** 1組の金額比較（A↔B） */
export interface AmountPairCompare {
  amountA: number | null;
  amountB: number | null;
  alert: AmountAlertLevel;
}

/** 比較・金額ずれのしきい値（%） */
export interface CompareSettings {
  matchPercent: number;
  amountWarnPercent: number;
  amountErrorPercent: number;
}

export interface AlignedPageRow {
  id: number;
  pageA: number | null;
  pageB: number | null;
  kind: PageAlignKind;
  label: string;
  /** 御中・様 から取った A 側の宛先文字列 */
  anchorA: string;
  /** 御中・様 から取った B 側の宛先文字列 */
  anchorB: string;
  /** ペア時の宛先一致率 0〜100（両方に宛先があるときのみ） */
  nameMatchPercent: number | null;
  /** A 側に抽出した金額一覧（昇順） */
  amountsA: number[];
  /** B 側に抽出した金額一覧（昇順） */
  amountsB: number[];
  /** 並べて対応した金額ペアごとの比較 */
  amountPairs: AmountPairCompare[];
  /** 金額のずれ（A 左枠の色・全ペアの最悪） */
  amountAlert: AmountAlertLevel;
  diff: PageDiffResult;
}
