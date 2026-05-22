import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PdfPageViewer } from "./components/PdfPageViewer";
import {
  compareDocuments,
  DEFAULT_MATCH_THRESHOLD,
} from "./lib/pageAlign";
import { extractAllPages } from "./lib/pdfExtract";
import { loadPdfFromArrayBuffer, readFileAsArrayBuffer } from "./lib/loadPdf";
import { downloadDiffCsv } from "./lib/exportCsv";
import {
  DEFAULT_AMOUNT_ERROR_PERCENT,
  DEFAULT_AMOUNT_WARN_PERCENT,
  formatAmountLinesForSide,
  formatYen,
  normalizeAmountPairs,
  normalizeCompareResult,
} from "./lib/invoiceAmount";
import type { CompareResult, CompareSettings, PageText } from "./lib/types";
import {
  pageBookmarkKey,
  previewBookmarkKey,
  toggleBookmarkKey,
} from "./lib/pageBookmarks";
import { searchTextIncludes, normalizeForSearch } from "./lib/searchNormalize";
import {
  compareSettingsEqual,
  cloneArrayBuffer,
  deletePersistedSession,
  loadPersistedSession,
  savePersistedSession,
  type StoredPdf,
} from "./lib/sessionStore";

const DEFAULT_ZOOM = 1.2;
const DEFAULT_MATCH_PERCENT = Math.round(DEFAULT_MATCH_THRESHOLD * 100);
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;

/** 宛先名・ページラベル・取り込み PDF 名の部分一致（大小文字・半角全角を無視） */
function rowMatchesNameSearch(
  row: { label: string; anchorA: string; anchorB: string },
  query: string,
  importFileNames: { a: string; b: string },
): boolean {
  return searchTextIncludes(
    [importFileNames.a, importFileNames.b, row.label, row.anchorA, row.anchorB].join(
      "\n",
    ),
    query,
  );
}

function normalizeCompareSettings(
  raw: Partial<CompareSettings>,
): CompareSettings {
  const matchPercent = Math.min(
    100,
    Math.max(0, raw.matchPercent ?? DEFAULT_MATCH_PERCENT),
  );
  let amountWarnPercent = Math.min(
    100,
    Math.max(0, raw.amountWarnPercent ?? DEFAULT_AMOUNT_WARN_PERCENT),
  );
  let amountErrorPercent = Math.min(
    100,
    Math.max(0, raw.amountErrorPercent ?? DEFAULT_AMOUNT_ERROR_PERCENT),
  );
  if (amountErrorPercent < amountWarnPercent) {
    amountErrorPercent = amountWarnPercent;
  }
  return { matchPercent, amountWarnPercent, amountErrorPercent };
}

export function DiffWorkspace({
  sessionId,
  onBack,
  initialNameSearch,
  initialNavIndex,
}: {
  sessionId: string;
  onBack: () => void;
  initialNameSearch?: string;
  initialNavIndex?: number;
}) {
  const inputARef = useRef<HTMLInputElement>(null);
  const inputBRef = useRef<HTMLInputElement>(null);
  const pagesCacheRef = useRef<{ pagesA: PageText[]; pagesB: PageText[] } | null>(
    null,
  );
  const pdfAStoreRef = useRef<StoredPdf | null>(null);
  const pdfBStoreRef = useRef<StoredPdf | null>(null);
  const loadStartedRef = useRef<string | null>(null);
  const activePageItemRef = useRef<HTMLLIElement | null>(null);

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
  const [amountWarnPercent, setAmountWarnPercent] = useState(
    DEFAULT_AMOUNT_WARN_PERCENT,
  );
  const [amountWarnInput, setAmountWarnInput] = useState(
    String(DEFAULT_AMOUNT_WARN_PERCENT),
  );
  const [amountErrorPercent, setAmountErrorPercent] = useState(
    DEFAULT_AMOUNT_ERROR_PERCENT,
  );
  const [amountErrorInput, setAmountErrorInput] = useState(
    String(DEFAULT_AMOUNT_ERROR_PERCENT),
  );
  const [bookmarkKeys, setBookmarkKeys] = useState<string[]>([]);
  const [bookmarkFilterOnly, setBookmarkFilterOnly] = useState(false);
  const [nameSearchQuery, setNameSearchQuery] = useState(
    initialNameSearch ?? "",
  );

  const bookmarkSet = useMemo(() => new Set(bookmarkKeys), [bookmarkKeys]);
  const nameSearchNorm = useMemo(
    () => normalizeForSearch(nameSearchQuery.trim()),
    [nameSearchQuery],
  );

  const importFileNames = useMemo(
    () => ({
      a: nameA.split("（")[0]?.trim() ?? "",
      b: nameB.split("（")[0]?.trim() ?? "",
    }),
    [nameA, nameB],
  );

  const compareSettings = useMemo(
    (): CompareSettings => ({
      matchPercent: matchThresholdPercent,
      amountWarnPercent,
      amountErrorPercent,
    }),
    [matchThresholdPercent, amountWarnPercent, amountErrorPercent],
  );

  const persistToDisk = useCallback(
    async (partial: {
      autoCompare?: boolean;
      settings?: CompareSettings;
      bookmarks?: string[];
      navIndex?: number;
      compareResult?: CompareResult | null;
      cachedPagesA?: PageText[] | null;
      cachedPagesB?: PageText[] | null;
      compareCacheSettings?: CompareSettings | null;
    }) => {
      if (!pdfAStoreRef.current && !pdfBStoreRef.current) return;
      const compared = partial.autoCompare ?? compare !== null;
      const settings = partial.settings ?? compareSettings;
      const cache = pagesCacheRef.current;
      const savedCompare =
        partial.compareResult !== undefined
          ? partial.compareResult
          : compared
            ? compare
            : null;
      const savedPagesA =
        partial.cachedPagesA !== undefined
          ? partial.cachedPagesA
          : compared
            ? (cache?.pagesA ?? null)
            : null;
      const savedPagesB =
        partial.cachedPagesB !== undefined
          ? partial.cachedPagesB
          : compared
            ? (cache?.pagesB ?? null)
            : null;
      try {
        await savePersistedSession(sessionId, {
          version: 1,
          pdfA: pdfAStoreRef.current
            ? {
                fileName: pdfAStoreRef.current.fileName,
                data: cloneArrayBuffer(pdfAStoreRef.current.data),
              }
            : null,
          pdfB: pdfBStoreRef.current
            ? {
                fileName: pdfBStoreRef.current.fileName,
                data: cloneArrayBuffer(pdfBStoreRef.current.data),
              }
            : null,
          settings,
          autoCompare: compared,
          bookmarks: partial.bookmarks ?? bookmarkKeys,
          navIndex: compared
            ? (partial.navIndex ?? navIndex)
            : undefined,
          cachedPagesA: savedPagesA ?? undefined,
          cachedPagesB: savedPagesB ?? undefined,
          compareResult: savedCompare ?? undefined,
          compareCacheSettings:
            partial.compareCacheSettings !== undefined
              ? (partial.compareCacheSettings ?? undefined)
              : savedCompare && savedPagesA && savedPagesB
                ? settings
                : undefined,
        });
      } catch (e) {
        console.warn("セッション保存に失敗", e);
      }
    },
    [compareSettings, bookmarkKeys, sessionId, compare, navIndex],
  );

  const flushSession = useCallback(async () => {
    await persistToDisk({});
  }, [persistToDisk]);

  const goBackToList = useCallback(() => {
    void flushSession().finally(() => onBack());
  }, [flushSession, onBack]);

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

  const currentBookmarkKey = useMemo(() => {
    if (!hasPreview) return null;
    if (compare && currentRow) {
      return pageBookmarkKey(currentRow.pageA, currentRow.pageB);
    }
    return previewBookmarkKey(navIndex);
  }, [hasPreview, compare, currentRow, navIndex]);

  const isCurrentBookmarked = Boolean(
    currentBookmarkKey && bookmarkSet.has(currentBookmarkKey),
  );

  const currentAmounts = useMemo(() => {
    if (!compare || !currentRow) return null;
    return normalizeAmountPairs(currentRow);
  }, [compare, currentRow]);

  const visibleRows = useMemo(() => {
    if (!compare) return [];
    let rows = compare.rows;
    if (bookmarkFilterOnly) {
      rows = rows.filter((row) =>
        bookmarkSet.has(pageBookmarkKey(row.pageA, row.pageB)),
      );
    }
    if (nameSearchNorm) {
      rows = rows.filter((row) =>
        rowMatchesNameSearch(row, nameSearchNorm, importFileNames),
      );
    }
    return rows;
  }, [compare, bookmarkFilterOnly, bookmarkSet, nameSearchNorm, importFileNames]);

  useEffect(() => {
    if (!compare || visibleRows.length === 0) return;
    const visible = new Set(visibleRows.map((r) => r.id));
    if (!visible.has(navIndex)) {
      setNavIndex(visibleRows[0]!.id);
    }
  }, [compare, visibleRows, navIndex]);

  useEffect(() => {
    if (!compare) return;
    const el = activePageItemRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [navIndex, compare, visibleRows.length, bookmarkFilterOnly, nameSearchNorm]);

  const toggleBookmark = useCallback(
    (key: string) => {
      setBookmarkKeys((prev) => {
        const next = toggleBookmarkKey(prev, key);
        void persistToDisk({ bookmarks: next });
        return next;
      });
    },
    [persistToDisk],
  );

  const toggleCurrentBookmark = useCallback(() => {
    if (!currentBookmarkKey) return;
    toggleBookmark(currentBookmarkKey);
  }, [currentBookmarkKey, toggleBookmark]);

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
      const dataForStore = cloneArrayBuffer(buffer);
      const doc = await loadPdfFromArrayBuffer(buffer);
      if (side === "A") {
        pdfAStoreRef.current = {
          fileName: file.name,
          data: dataForStore,
        };
        setDocA(doc);
        setNameA(`${file.name}（${doc.numPages} ページ）`);
      } else {
        pdfBStoreRef.current = {
          fileName: file.name,
          data: dataForStore,
        };
        setDocB(doc);
        setNameB(`${file.name}（${doc.numPages} ページ）`);
      }
      setCompare(null);
      pagesCacheRef.current = null;
      setNavIndex(1);
      setBookmarkKeys([]);
      setBookmarkFilterOnly(false);
      setNameSearchQuery("");
      await persistToDisk({
        autoCompare: false,
        bookmarks: [],
        navIndex: undefined,
        compareResult: null,
        cachedPagesA: null,
        cachedPagesB: null,
        compareCacheSettings: null,
      });
    } catch (e) {
      setError(
        `PDF の読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setLoading(false);
    }
  }, [persistToDisk]);

  const onFileChange = useCallback(
    (side: "A" | "B") => async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) await loadFile(file, side);
      e.target.value = "";
    },
    [loadFile],
  );

  const applyCompare = useCallback(
    (
      pagesA: PageText[],
      pagesB: PageText[],
      raw: Partial<CompareSettings>,
      options?: { navIndex?: number },
    ) => {
      const s = normalizeCompareSettings(raw);
      setMatchThresholdPercent(s.matchPercent);
      setThresholdInput(String(s.matchPercent));
      setAmountWarnPercent(s.amountWarnPercent);
      setAmountWarnInput(String(s.amountWarnPercent));
      setAmountErrorPercent(s.amountErrorPercent);
      setAmountErrorInput(String(s.amountErrorPercent));
      const result = compareDocuments(
        pagesA,
        pagesB,
        s.matchPercent / 100,
        s.amountWarnPercent,
        s.amountErrorPercent,
      );
      setCompare(normalizeCompareResult(result));
      const idx = options?.navIndex
        ? Math.min(Math.max(1, options.navIndex), result.rows.length)
        : 1;
      setNavIndex(idx);
      pagesCacheRef.current = { pagesA, pagesB };
      void persistToDisk({
        settings: s,
        autoCompare: true,
        navIndex: idx,
        compareResult: result,
        cachedPagesA: pagesA,
        cachedPagesB: pagesB,
        compareCacheSettings: s,
      });
    },
    [persistToDisk],
  );

  const commitCompareSettings = useCallback(() => {
    const parsedMatch = Number.parseInt(thresholdInput, 10);
    const parsedWarn = Number.parseInt(amountWarnInput, 10);
    const parsedError = Number.parseInt(amountErrorInput, 10);

    if (Number.isNaN(parsedMatch)) {
      setThresholdInput(String(matchThresholdPercent));
    }
    if (Number.isNaN(parsedWarn)) {
      setAmountWarnInput(String(amountWarnPercent));
    }
    if (Number.isNaN(parsedError)) {
      setAmountErrorInput(String(amountErrorPercent));
    }
    if (
      Number.isNaN(parsedMatch) ||
      Number.isNaN(parsedWarn) ||
      Number.isNaN(parsedError)
    ) {
      return;
    }

    const cache = pagesCacheRef.current;
    if (cache) {
      applyCompare(cache.pagesA, cache.pagesB, {
        matchPercent: parsedMatch,
        amountWarnPercent: parsedWarn,
        amountErrorPercent: parsedError,
      });
    } else {
      const s = normalizeCompareSettings({
        matchPercent: parsedMatch,
        amountWarnPercent: parsedWarn,
        amountErrorPercent: parsedError,
      });
      setMatchThresholdPercent(s.matchPercent);
      setThresholdInput(String(s.matchPercent));
      setAmountWarnPercent(s.amountWarnPercent);
      setAmountWarnInput(String(s.amountWarnPercent));
      setAmountErrorPercent(s.amountErrorPercent);
      setAmountErrorInput(String(s.amountErrorPercent));
      void persistToDisk({ settings: s, autoCompare: Boolean(compare) });
    }
  }, [
    thresholdInput,
    amountWarnInput,
    amountErrorInput,
    matchThresholdPercent,
    amountWarnPercent,
    amountErrorPercent,
    amountErrorPercent,
    applyCompare,
    compare,
    persistToDisk,
  ]);

  useEffect(() => {
    if (loadStartedRef.current === sessionId) return;
    loadStartedRef.current = sessionId;

    pdfAStoreRef.current = null;
    pdfBStoreRef.current = null;
    pagesCacheRef.current = null;
    setDocA(null);
    setDocB(null);
    setNameA("");
    setNameB("");
    setCompare(null);
    setNavIndex(1);
    setBookmarkKeys([]);
    setBookmarkFilterOnly(false);
    setNameSearchQuery(initialNameSearch ?? "");
    setError(null);

    void (async () => {
      const session = await loadPersistedSession(sessionId);
      if (!session) return;

      const targetNav =
        initialNavIndex ?? session.navIndex ?? undefined;

      setLoading(true);
      try {
        let loadedA: PDFDocumentProxy | null = null;
        let loadedB: PDFDocumentProxy | null = null;

        if (session.pdfA) {
          const dataForStore = cloneArrayBuffer(session.pdfA.data);
          pdfAStoreRef.current = {
            fileName: session.pdfA.fileName,
            data: dataForStore,
          };
          loadedA = await loadPdfFromArrayBuffer(cloneArrayBuffer(dataForStore));
          setDocA(loadedA);
          setNameA(
            `${session.pdfA.fileName}（${loadedA.numPages} ページ）`,
          );
        }
        if (session.pdfB) {
          const dataForStore = cloneArrayBuffer(session.pdfB.data);
          pdfBStoreRef.current = {
            fileName: session.pdfB.fileName,
            data: dataForStore,
          };
          loadedB = await loadPdfFromArrayBuffer(cloneArrayBuffer(dataForStore));
          setDocB(loadedB);
          setNameB(
            `${session.pdfB.fileName}（${loadedB.numPages} ページ）`,
          );
        }

        const s = normalizeCompareSettings(session.settings);
        setMatchThresholdPercent(s.matchPercent);
        setThresholdInput(String(s.matchPercent));
        setAmountWarnPercent(s.amountWarnPercent);
        setAmountWarnInput(String(s.amountWarnPercent));
        setAmountErrorPercent(s.amountErrorPercent);
        setAmountErrorInput(String(s.amountErrorPercent));
        setBookmarkKeys(session.bookmarks ?? []);

        const cacheSettings = session.compareCacheSettings;
        const canUseSavedCompare =
          session.compareResult &&
          session.cachedPagesA &&
          session.cachedPagesB &&
          cacheSettings &&
          compareSettingsEqual(s, cacheSettings);

        if (canUseSavedCompare) {
          pagesCacheRef.current = {
            pagesA: session.cachedPagesA!,
            pagesB: session.cachedPagesB!,
          };
          setCompare(normalizeCompareResult(session.compareResult!));
          const idx = targetNav
            ? Math.min(
                Math.max(1, targetNav),
                session.compareResult!.rows.length,
              )
            : 1;
          setNavIndex(idx);
        } else if (
          loadedA &&
          loadedB &&
          session.autoCompare &&
          session.cachedPagesA &&
          session.cachedPagesB
        ) {
          pagesCacheRef.current = {
            pagesA: session.cachedPagesA,
            pagesB: session.cachedPagesB,
          };
          applyCompare(
            session.cachedPagesA,
            session.cachedPagesB,
            s,
            { navIndex: targetNav },
          );
        } else if (loadedA && loadedB && session.autoCompare) {
          const [pagesA, pagesB] = await Promise.all([
            extractAllPages(loadedA),
            extractAllPages(loadedB),
          ]);
          pagesCacheRef.current = { pagesA, pagesB };
          applyCompare(pagesA, pagesB, s, {
            navIndex: targetNav,
          });
        } else if (targetNav) {
          setNavIndex(targetNav);
        }
      } catch (e) {
        setError(
          `保存データの復元に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
        );
        await deletePersistedSession(sessionId);
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId, applyCompare, initialNameSearch, initialNavIndex]);

  useEffect(() => {
    if (!compare) return;
    const t = window.setTimeout(() => {
      void persistToDisk({ navIndex });
    }, 400);
    return () => window.clearTimeout(t);
  }, [compare, navIndex, persistToDisk]);

  const deleteThisSession = useCallback(async () => {
    if (
      !window.confirm(
        "この比較を一覧から削除します。PDF データも端末から消えます。",
      )
    ) {
      return;
    }
    await deletePersistedSession(sessionId);
    onBack();
  }, [sessionId, onBack]);

  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };

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
      applyCompare(pagesA, pagesB, compareSettings);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [docA, docB, compareSettings, applyCompare]);

  return (
    <div className="app">
      <header className="toolbar">
        <h1>PDF Diff</h1>
        <div className="toolbar-actions">
          <button type="button" onClick={goBackToList} title="保存済み一覧へ">
            ← 一覧
          </button>
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
            <>
              <label
                className="toolbar-threshold"
                title="宛先が両方あるときは名前一致率≧この値でペア。片方だけ宛先があるページはペアにせず削除/追加。宛先が両方ないときだけ全文一致率"
              >
                <span>一致率</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                  onBlur={commitCompareSettings}
                  onKeyDown={blurOnEnter}
                />
                <span>%</span>
              </label>
              <label
                className="toolbar-threshold toolbar-threshold-amount"
                title="金額の相対ずれがこの値以上で A 左枠を黄色"
              >
                <span>金額黄</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={amountWarnInput}
                  onChange={(e) => setAmountWarnInput(e.target.value)}
                  onBlur={commitCompareSettings}
                  onKeyDown={blurOnEnter}
                />
                <span>%</span>
              </label>
              <label
                className="toolbar-threshold toolbar-threshold-amount"
                title="金額の相対ずれがこの値以上で A 左枠を赤色（黄より大きい値に）"
              >
                <span>金額赤</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={amountErrorInput}
                  onChange={(e) => setAmountErrorInput(e.target.value)}
                  onBlur={commitCompareSettings}
                  onKeyDown={blurOnEnter}
                />
                <span>%</span>
              </label>
            </>
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
                className={
                  isCurrentBookmarked ? "bookmark-btn bookmarked" : "bookmark-btn"
                }
                onClick={toggleCurrentBookmark}
                title={
                  isCurrentBookmarked
                    ? "しおりを外す"
                    : "このページにしおりを付ける"
                }
                aria-label={
                  isCurrentBookmarked ? "しおりを外す" : "しおりを付ける"
                }
              >
                {isCurrentBookmarked ? "★" : "☆"}
              </button>
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
          {hasPreview && (
            <button
              type="button"
              onClick={() => void deleteThisSession()}
              disabled={loading}
              title="この比較を一覧から削除"
            >
              削除
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
          {compare.pageCountB} 枚 → 表示{" "}
          {nameSearchNorm || bookmarkFilterOnly
            ? `${visibleRows.length} / ${compare.rows.length}`
            : compare.rows.length}{" "}
          組（一致率{" "}
          {matchThresholdPercent}%: 名前（両方宛先あり）/ 全文（両方なし） / 金額ずれ 黄
          {amountWarnPercent}%↑ 赤{amountErrorPercent}%↑）
        </div>
      )}

      <div className="main">
        <aside className="sidebar">
          <div className="sidebar-head">
            <h2>ページ</h2>
            {compare && bookmarkKeys.length > 0 && (
              <button
                type="button"
                className={
                  bookmarkFilterOnly
                    ? "sidebar-filter active"
                    : "sidebar-filter"
                }
                onClick={() => setBookmarkFilterOnly((v) => !v)}
                title="しおり付きページだけ表示"
              >
                {bookmarkFilterOnly ? "すべて" : `しおり ${bookmarkKeys.length}`}
              </button>
            )}
          </div>
          {compare && (
            <label className="sidebar-search">
              <span className="sidebar-search-label">名前検索</span>
              <input
                type="search"
                value={nameSearchQuery}
                onChange={(e) => setNameSearchQuery(e.target.value)}
                placeholder="宛先・PDFファイル名（部分一致・大小/半全角無視）"
                aria-label="宛先名でページを検索"
              />
              {nameSearchQuery && (
                <button
                  type="button"
                  className="sidebar-search-clear"
                  onClick={() => setNameSearchQuery("")}
                  title="検索をクリア"
                  aria-label="検索をクリア"
                >
                  ×
                </button>
              )}
            </label>
          )}
          {compare ? (
            visibleRows.length > 0 ? (
            <ul className="page-list">
              {visibleRows.map((row) => {
                const rowKey = pageBookmarkKey(row.pageA, row.pageB);
                const marked = bookmarkSet.has(rowKey);
                return (
                <li
                  key={row.id}
                  ref={navIndex === row.id ? activePageItemRef : undefined}
                >
                  <div className="page-list-item">
                    <button
                      type="button"
                      className={
                        marked ? "page-bookmark-btn bookmarked" : "page-bookmark-btn"
                      }
                      onClick={() => toggleBookmark(rowKey)}
                      title={marked ? "しおりを外す" : "しおりを付ける"}
                      aria-label={marked ? "しおりを外す" : "しおりを付ける"}
                    >
                      {marked ? "★" : "☆"}
                    </button>
                    <button
                    type="button"
                    className={[
                      "page-list-main",
                      navIndex === row.id ? "active" : "",
                      row.amountAlert !== "none" ? `amount-edge-${row.amountAlert}` : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
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
                      {row.nameMatchPercent != null && (
                        <span className="page-list-name-match">
                          名前一致 {row.nameMatchPercent}%
                        </span>
                      )}
                    </div>
                    {(() => {
                      const amt = normalizeAmountPairs(row);
                      if (amt.amountPairs.length === 0) return null;
                      return (
                        <div className="page-list-amounts">
                          {amt.amountPairs.map((p, i) => (
                            <div
                              key={i}
                              className={
                                p.alert !== "none"
                                  ? `amount-pair amount-pair-${p.alert}`
                                  : "amount-pair"
                              }
                            >
                              <span>
                                A:{" "}
                                {p.amountA != null ? formatYen(p.amountA) : "—"}
                              </span>
                              <span>
                                B:{" "}
                                {p.amountB != null ? formatYen(p.amountB) : "—"}
                              </span>
                            </div>
                          ))}
                          {amt.amountAlert !== "none" && (
                            <span
                              className={`amount-tag amount-tag-${amt.amountAlert}`}
                            >
                              金額ずれ
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </button>
                  </div>
                </li>
              );
              })}
            </ul>
            ) : (
              <p className="hint">
                {nameSearchNorm && bookmarkFilterOnly
                  ? "しおり付きかつ検索に一致するページがありません。"
                  : nameSearchNorm
                    ? "検索に一致するページがありません。"
                    : "しおり付きのページがありません。"}
              </p>
            )
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
                    amountLines={
                      compare
                        ? currentAmounts && currentAmounts.amountPairs.length > 0
                          ? formatAmountLinesForSide(
                              currentAmounts.amountPairs,
                              "A",
                            )
                          : ["（未取得）"]
                        : undefined
                    }
                    edgeBorder={compare ? currentRow?.amountAlert : "none"}
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
                    amountLines={
                      compare
                        ? currentAmounts && currentAmounts.amountPairs.length > 0
                          ? formatAmountLinesForSide(
                              currentAmounts.amountPairs,
                              "B",
                            )
                          : ["（未取得）"]
                        : undefined
                    }
                  />
                ) : (
                  <div className="page-missing">B: このページはありません</div>
                )}
              </div>
              {compare && (
                <p className="legend">
                  <span className="swatch delete" /> 削除（A）{" "}
                  <span className="swatch insert" /> 追加（B）{" "}
                  <span className="swatch amount-warn" /> 金額ずれ {amountWarnPercent}%↑（A 枠）{" "}
                  <span className="swatch amount-error" /> 金額ずれ {amountErrorPercent}%↑（A 枠）
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
