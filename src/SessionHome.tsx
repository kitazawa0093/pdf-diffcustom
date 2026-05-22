import { useCallback, useEffect, useState } from "react";
import {
  createSessionId,
  deletePersistedSession,
  formatSavedAt,
  getStorageLocationHint,
  listSessionMeta,
  type SessionMeta,
} from "./lib/sessionStore";
import {
  searchSessionsByCompany,
  type CompanySearchSessionHit,
} from "./lib/companySearch";
import { normalizeForSearch } from "./lib/searchNormalize";

export interface OpenWorkspaceOptions {
  /** 比較画面で事前に絞り込む検索文字列 */
  nameSearch?: string;
  /** 開くページ（比較結果の行 id） */
  navIndex?: number;
}

interface SessionHomeProps {
  onOpen: (sessionId: string, options?: OpenWorkspaceOptions) => void;
  onNew: (sessionId: string) => void;
}

export function SessionHome({ onOpen, onNew }: SessionHomeProps) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyHits, setCompanyHits] = useState<CompanySearchSessionHit[]>(
    [],
  );
  const [companySearching, setCompanySearching] = useState(false);
  const [storageHint, setStorageHint] = useState<string | null>(null);

  const companyQueryNorm = normalizeForSearch(companyQuery.trim());
  const isCompanySearchActive = companyQueryNorm.length > 0;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setSessions(await listSessionMeta());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void getStorageLocationHint().then(setStorageHint);
  }, []);

  useEffect(() => {
    if (!isCompanySearchActive) {
      setCompanyHits([]);
      setCompanySearching(false);
      return;
    }

    setCompanySearching(true);
    const timer = window.setTimeout(() => {
      void searchSessionsByCompany(companyQuery).then((hits) => {
        setCompanyHits(hits);
        setCompanySearching(false);
      });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [companyQuery, isCompanySearchActive]);

  const handleDelete = async (e: React.MouseEvent, meta: SessionMeta) => {
    e.stopPropagation();
    if (
      !window.confirm(
        `「${meta.title}」を削除します。PDF と比較データも data フォルダから消えます。`,
      )
    ) {
      return;
    }
    await deletePersistedSession(meta.id);
    await reload();
    if (isCompanySearchActive) {
      setCompanyHits(await searchSessionsByCompany(companyQuery));
    }
  };

  const openSession = (
    sessionId: string,
    options?: OpenWorkspaceOptions,
  ) => {
    onOpen(sessionId, options);
  };

  return (
    <div className="home">
      <header className="home-header">
        <h1>PDF Diff</h1>
        <button
          type="button"
          className="primary"
          onClick={() => onNew(createSessionId())}
        >
          新規比較
        </button>
      </header>

      <main className="home-main">
        <h2 className="home-heading">名前検索</h2>
        <p className="home-hint">
          保存済みの比較から、PDF 名・宛先名で一致したページを表示します。
          {storageHint && (
            <>
              <br />
              保存先: {storageHint}
            </>
          )}
        </p>

        <label className="home-search home-search-primary">
          <span className="home-search-label">名前</span>
          <input
            type="search"
            value={companyQuery}
            onChange={(e) => setCompanyQuery(e.target.value)}
            placeholder="例: 山田 / 株式会社○○（部分一致・大小/半全角無視）"
            aria-label="名前で比較結果を検索"
          />
          {companyQuery && (
            <button
              type="button"
              className="home-search-clear"
              onClick={() => setCompanyQuery("")}
              title="検索をクリア"
              aria-label="検索をクリア"
            >
              ×
            </button>
          )}
        </label>

        {isCompanySearchActive && (
          <section className="company-results" aria-live="polite">
            {companySearching ? (
              <p className="home-status">比較結果を検索中…</p>
            ) : companyHits.length === 0 ? (
              <p className="home-status">
                「{companyQuery.trim()}」に一致する比較はありません。
              </p>
            ) : (
              <>
                <p className="home-search-count">
                  {companyHits.length} 件の比較 /{" "}
                  {companyHits.reduce((n, h) => n + h.rows.length, 0)}{" "}
                  ページが一致
                </p>
                <ul className="company-result-list">
                  {companyHits.map((hit) => (
                    <li key={hit.meta.id} className="company-result-block">
                      <div className="company-result-head">
                        <button
                          type="button"
                          className="company-result-title"
                          onClick={() =>
                            openSession(hit.meta.id, {
                              nameSearch: companyQuery.trim(),
                            })
                          }
                        >
                          {hit.meta.title}
                        </button>
                        {hit.meta.autoCompare && (
                          <span className="session-card-badge">比較済</span>
                        )}
                        <button
                          type="button"
                          className="session-delete"
                          title="削除"
                          onClick={(e) => void handleDelete(e, hit.meta)}
                        >
                          削除
                        </button>
                      </div>
                      <div className="company-result-meta">
                        <span>{formatSavedAt(hit.meta.savedAt)}</span>
                        {hit.meta.fileNameA && (
                          <span>A: {hit.meta.fileNameA}</span>
                        )}
                        {hit.meta.fileNameB && (
                          <span>B: {hit.meta.fileNameB}</span>
                        )}
                      </div>
                      {hit.rows.length > 0 ? (
                        <ul className="company-row-list">
                          {hit.rows.map((row) => (
                            <li key={row.rowId}>
                              <button
                                type="button"
                                className="company-row-hit"
                                onClick={() =>
                                  openSession(hit.meta.id, {
                                    nameSearch: companyQuery.trim(),
                                    navIndex: row.rowId,
                                  })
                                }
                              >
                                <span className="company-row-label">
                                  {row.label}
                                </span>
                                <span className="company-row-anchors">
                                  {row.pageA != null && (
                                    <span>
                                      A: {row.anchorA || "（未取得）"}
                                    </span>
                                  )}
                                  {row.pageB != null && (
                                    <span>
                                      B: {row.anchorB || "（未取得）"}
                                    </span>
                                  )}
                                </span>
                                {row.changeCount > 0 && (
                                  <span className="company-row-diff">
                                    {row.changeCount} 文字の差分
                                  </span>
                                )}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="company-file-only">
                          PDF ファイル名のみ一致（比較未実行またはページに宛先なし）
                          <button
                            type="button"
                            className="company-open-link"
                            onClick={() =>
                              openSession(hit.meta.id, {
                                nameSearch: companyQuery.trim(),
                              })
                            }
                          >
                            比較を開く
                          </button>
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        {!isCompanySearchActive && (
          <>
            <h2 className="home-heading home-heading-secondary">
              保存した比較
            </h2>
            {loading ? (
              <p className="home-status">読み込み中…</p>
            ) : sessions.length === 0 ? (
              <div className="home-empty">
                <p>まだ保存された比較がありません。</p>
                <button
                  type="button"
                  className="primary"
                  onClick={() => onNew(createSessionId())}
                >
                  新規比較を始める
                </button>
              </div>
            ) : (
              <ul className="session-list">
                {sessions.map((meta) => (
                  <li key={meta.id}>
                    <button
                      type="button"
                      className="session-card"
                      onClick={() => openSession(meta.id)}
                    >
                      <div className="session-card-head">
                        <span className="session-card-title">
                          {meta.title}
                        </span>
                        {meta.autoCompare && (
                          <span className="session-card-badge">比較済</span>
                        )}
                      </div>
                      <div className="session-card-meta">
                        <span>{formatSavedAt(meta.savedAt)}</span>
                        {meta.fileNameA && <span>A: {meta.fileNameA}</span>}
                        {meta.fileNameB && <span>B: {meta.fileNameB}</span>}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="session-delete"
                      title="削除"
                      onClick={(e) => void handleDelete(e, meta)}
                    >
                      削除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}
