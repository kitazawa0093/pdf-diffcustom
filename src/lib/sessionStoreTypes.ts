import type { CompareSettings, CompareResult, PageText } from "./types";

export interface StoredPdf {
  fileName: string;
  data: ArrayBuffer;
}

export interface PersistedSessionV1 {
  version: 1;
  id: string;
  savedAt: number;
  pdfA: StoredPdf | null;
  pdfB: StoredPdf | null;
  settings: CompareSettings;
  autoCompare: boolean;
  bookmarks?: string[];
  /** 比較結果表示時のページ位置（1始まり） */
  navIndex?: number;
  /** 再計算なしで復元するための抽出済みテキスト */
  cachedPagesA?: PageText[];
  cachedPagesB?: PageText[];
  /** 保存時点の比較結果 */
  compareResult?: CompareResult;
  /** compareResult / cachedPages が有効なときの設定 */
  compareCacheSettings?: CompareSettings;
  /** 比較前に PDF A/B のページを絞り込む名前リスト */
  filterList?: string[];
  /** 比較リストの一致方法（未設定時は部分一致） */
  filterListMatchMode?: "partial" | "exact";
}

export interface SessionMeta {
  id: string;
  title: string;
  savedAt: number;
  fileNameA: string | null;
  fileNameB: string | null;
  autoCompare: boolean;
}

export function compareSettingsEqual(
  a: CompareSettings,
  b: CompareSettings,
): boolean {
  return (
    a.matchPercent === b.matchPercent &&
    a.amountWarnPercent === b.amountWarnPercent &&
    a.amountErrorPercent === b.amountErrorPercent
  );
}

export function createSessionId(): string {
  return crypto.randomUUID();
}

export function buildSessionTitle(
  fileNameA: string | null,
  fileNameB: string | null,
): string {
  if (fileNameA && fileNameB) return `${fileNameA} ↔ ${fileNameB}`;
  if (fileNameA) return fileNameA;
  if (fileNameB) return fileNameB;
  return "無題の比較";
}

export function metaFromSession(
  id: string,
  session: PersistedSessionV1,
): SessionMeta {
  return {
    id,
    title: buildSessionTitle(
      session.pdfA?.fileName ?? null,
      session.pdfB?.fileName ?? null,
    ),
    savedAt: session.savedAt,
    fileNameA: session.pdfA?.fileName ?? null,
    fileNameB: session.pdfB?.fileName ?? null,
    autoCompare: session.autoCompare,
  };
}

export function formatSavedAt(ms: number): string {
  return new Date(ms).toLocaleString("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** pdf.js 読み込みで元バッファが detach されないようコピー */
export function cloneArrayBuffer(buffer: ArrayBuffer): ArrayBuffer {
  const src = new Uint8Array(buffer);
  const copy = new Uint8Array(src.byteLength);
  copy.set(src);
  return copy.buffer;
}
