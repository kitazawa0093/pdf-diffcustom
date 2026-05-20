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
  diff: PageDiffResult;
}
