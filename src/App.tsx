import { useCallback, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PdfPageViewer } from "./components/PdfPageViewer";
import {
  compareDocuments,
  DEFAULT_MATCH_THRESHOLD,
} from "./lib/pageAlign";
import { extractAllPages } from "./lib/pdfExtract";
import { loadPdfFromArrayBuffer, readFileAsArrayBuffer } from "./lib/loadPdf";
import { downloadDiffCsv } from "./lib/exportCsv";
import type { CompareResult, PageText } from "./lib/types";

const DEFAULT_ZOOM = 1.2;
const DEFAULT_MATCH_PERCENT = Math.round(DEFAULT_MATCH_THRESHOLD * 100);
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;

export default function App() {
  const inputARef = useRef<HTMLInputElement>(null);
  const inputBRef = useRef<HTMLInputElement>(null);
  const pagesCacheRef = useRef<{ pagesA: PageText[]; pagesB: PageText[] } | null>(
    null,
  );

  const [docA, setDocA] = useState<PDFDocumentProxy | null>(null);
  const [docB, setDocB] = useState<PDFDocumentProxy | null>(null);
  const [nameA, setNameA] = useState("");
  const [nameB, setNameB] = useState("");
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [navIndex, setNavIndex] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [matchThresholdPercent, setMatchThresholdPercent] =
    useState(DEFAULT_MATCH_PERCENT);
  const [thresholdInput, setThresholdInput] = useState(
    String(DEFAULT_MATCH_PERCENT),
  );

  const hasPreview = Boolean(docA || docB);

  const currentRow = compare?.rows[navIndex - 1] ?? null;
  const pageDiff = currentRow?.diff ?? null;

  const maxNav = useMemo(() => {
    if (compare) return compare.rows.length;
    const a = docA?.numPages ?? 0;
    const b = docB?.numPages ?? 0;
    return Math.max(a, b, 1);
  }, [compare, docA, docB]);

  const viewPageA = compare ? (currentRow?.pageA ?? null) : navIndex;
  const viewPageB = compare ? (currentRow?.pageB ?? null) : navIndex;

  const navLabel = useMemo(() => {
    if (!hasPreview) return "";
    if (compare && currentRow) {
      return `${navIndex} / ${maxNav}（${currentRow.label}）`;
    }
    const parts: string[] = [];
    if (docA) parts.push(`A: ${navIndex}/${docA.numPages}`);
    if (docB) parts.push(`B: ${navIndex}/${docB.numPages}`);
    return `${navIndex} / ${maxNav}（${parts.join(" · ")}）`;
  }, [hasPreview, compare, currentRow, navIndex, maxNav, docA, docB]);

  const goPrev = useCallback(() => {
    setNavIndex((i) => Math.max(1, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setNavIndex((i) => Math.min(maxNav, i + 1));
  }, [maxNav]);

  const zoomIn = useCallback(() => {
    setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 10) / 10));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 10) / 10));
  }, []);

  const zoomReset = useCallback(() => {
    setZoom(DEFAULT_ZOOM);
  }, []);

  const exportCsv = useCallback(() => {
    if (!compare) return;
    const baseA = nameA.split("（")[0] || "A.pdf";
    const baseB = nameB.split("（")[0] || "B.pdf";
    downloadDiffCsv(compare, baseA, baseB);
  }, [compare, nameA, nameB]);

  const loadFile = useCallback(async (file: File, side: "A" | "B") => {
    setError(null);
    setLoading(true);
    try {
      const buffer = await readFileAsArrayBuffer(file);
      const doc = await loadPdfFromArrayBuffer(buffer);
      if (side === "A") {
        setDocA(doc);
        setNameA(`${file.name}（${doc.numPages} ページ）`);
      } else {
        setDocB(doc);
        setNameB(`${file.name}（${doc.numPages} ページ）`);
      }
      setCompare(null);
      pagesCacheRef.current = null;
      setNavIndex(1);
    } catch (e) {
      setError(
        `PDF の読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const onFileChange = useCallback(
    (side: "A" | "B") => async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) await loadFile(file, side);
      e.target.value = "";
    },
    [loadFile],
  );

  const clampPercent = (n: number) => Math.min(100, Math.max(0, n));

  const applyCompare = useCallback(
    (pagesA: PageText[], pagesB: PageText[], percent: number) => {
      const pct = clampPercent(percent);
      setMatchThresholdPercent(pct);
      setThresholdInput(String(pct));
      setCompare(compareDocuments(pagesA, pagesB, pct / 100));
      setNavIndex(1);
    },
    [],
  );

  const commitThreshold = useCallback(() => {
    const parsed = Number.parseInt(thresholdInput, 10);
    if (Number.isNaN(parsed)) {
      setThresholdInput(String(matchThresholdPercent));
      return;
    }
    const cache = pagesCacheRef.current;
    if (cache) {
      applyCompare(cache.pagesA, cache.pagesB, parsed);
    } else {
      const pct = clampPercent(parsed);
      setMatchThresholdPercent(pct);
      setThresholdInput(String(pct));
    }
  }, [thresholdInput, matchThresholdPercent, applyCompare]);

  const runCompare = useCallback(async () => {
    if (!docA || !docB) {
      setError("PDF A と PDF B の両方を読み込んでください。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [pagesA, pagesB] = await Promise.all([
        extractAllPages(docA),
        extractAllPages(docB),
      ]);
      pagesCacheRef.current = { pagesA, pagesB };
      applyCompare(pagesA, pagesB, matchThresholdPercent);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [docA, docB, matchThresholdPercent, applyCompare]);

  return (
    <div className="app">
      <header className="toolbar">
        <h1>PDF Diff</h1>
        <div className="toolbar-actions">
          <input
            ref={inputARef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={onFileChange("A")}
          />
          <input
            ref={inputBRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={onFileChange("B")}
          />
          <button
            type="button"
            onClick={() => inputARef.current?.click()}
            disabled={loading}
          >
            PDF A
          </button>
          <button
            type="button"
            onClick={() => inputBRef.current?.click()}
            disabled={loading}
          >
            PDF B
          </button>
          {docA && docB && (
            <label
              className="toolbar-threshold"
              title="ペア条件: 宛先（御中・様の直前）は両方ある場合に完全一致必須。本文は全文一致率がこの値以上。候補が複数なら全文一致率が最も高い B を選択"
            >
              <span>一致率</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
                onBlur={commitThreshold}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
              />
              <span>%</span>
            </label>
          )}
          <button
            type="button"
            className="primary"
            onClick={runCompare}
            disabled={loading || !docA || !docB}
          >
            比較
          </button>
          {hasPreview && (
            <div className="toolbar-page-nav">
              <button
                type="button"
                onClick={goPrev}
                disabled={navIndex <= 1}
                title="前のページ"
              >
                ◀
              </button>
              <span className="toolbar-page-label">{navLabel}</span>
              <button
                type="button"
                onClick={goNext}
                disabled={navIndex >= maxNav}
                title="次のページ"
              >
                ▶
              </button>
            </div>
          )}
          {hasPreview && (
            <div className="toolbar-zoom">
              <button type="button" onClick={zoomOut} disabled={zoom <= ZOOM_MIN} title="縮小">
                −
              </button>
              <button type="button" onClick={zoomReset} title="倍率リセット">
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" onClick={zoomIn} disabled={zoom >= ZOOM_MAX} title="拡大">
                ＋
              </button>
            </div>
          )}
          {compare && (
            <button type="button" onClick={exportCsv} title="差分を CSV で保存">
              CSV出力
            </button>
          )}
        </div>
        <div className="file-names">
          <span>{nameA || "A: 未選択"}</span>
          <span>{nameB || "B: 未選択"}</span>
        </div>
      </header>

      {loading && <div className="loading-banner">処理中…</div>}
      {error && <div className="error-banner">{error}</div>}

      {compare && (
        <div className="summary">
          差分 {compare.totalChanges} 文字 / ページ A:{compare.pageCountA} 枚 B:
          {compare.pageCountB} 枚 → 表示 {compare.rows.length} 組（一致率{" "}
          {matchThresholdPercent}%: 宛先完全一致＋本文一致率でペア）
        </div>
      )}

      <div className="main">
        <aside className="sidebar">
          <h2>ページ</h2>
          {compare ? (
            <ul className="page-list">
              {compare.rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={navIndex === row.id ? "active" : ""}
                    onClick={() => setNavIndex(row.id)}
                  >
                    <div className="page-list-head">
                      <span className="page-list-label">{row.label}</span>
                      <span
                        className={
                          row.diff.changeCount > 0 || row.kind !== "match"
                            ? "has-diff"
                            : ""
                        }
                      >
                        {row.kind === "insert"
                          ? "追加"
                          : row.kind === "delete"
                            ? "削除"
                            : row.diff.changeCount > 0
                              ? `${row.diff.changeCount} 文字`
                              : "—"}
                      </span>
                    </div>
                    <div className="page-list-anchors">
                      {row.pageA != null && (
                        <span className="page-list-anchor">
                          A: {row.anchorA || "（未取得）"}
                        </span>
                      )}
                      {row.pageB != null && (
                        <span className="page-list-anchor">
                          B: {row.anchorB || "（未取得）"}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : hasPreview ? (
            <p className="hint">
              プレビュー中（{navLabel}）。差分は「比較」を押してください。
            </p>
          ) : (
            <p className="hint">2つの PDF を読み込むとプレビューが表示されます。</p>
          )}
        </aside>

        <section className="viewers">
          {hasPreview ? (
            <>
              <div className="viewer-row">
                {docA && viewPageA != null && viewPageA <= docA.numPages ? (
                  <PdfPageViewer
                    doc={docA}
                    pageNumber={viewPageA}
                    scale={zoom}
                    highlights={pageDiff?.highlightsA}
                    label="A"
                    anchorText={compare ? currentRow?.anchorA : undefined}
                  />
                ) : (
                  <div className="page-missing">A: このページはありません</div>
                )}
                {docB && viewPageB != null && viewPageB <= docB.numPages ? (
                  <PdfPageViewer
                    doc={docB}
                    pageNumber={viewPageB}
                    scale={zoom}
                    highlights={pageDiff?.highlightsB}
                    label="B"
                    anchorText={compare ? currentRow?.anchorB : undefined}
                  />
                ) : (
                  <div className="page-missing">B: このページはありません</div>
                )}
              </div>
              {compare && (
                <p className="legend">
                  <span className="swatch delete" /> 削除（A）{" "}
                  <span className="swatch insert" /> 追加（B）
                </p>
              )}
            </>
          ) : (
            <div className="placeholder">PDF を選択してください</div>
          )}
        </section>
      </div>
    </div>
  );
}
