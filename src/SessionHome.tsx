import { useCallback, useEffect, useState } from "react";
import {
  createSessionId,
  deletePersistedSession,
  formatSavedAt,
  listSessionMeta,
  type SessionMeta,
} from "./lib/sessionStore";

interface SessionHomeProps {
  onOpen: (sessionId: string) => void;
  onNew: (sessionId: string) => void;
}

export function SessionHome({ onOpen, onNew }: SessionHomeProps) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(true);

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

  const handleDelete = async (e: React.MouseEvent, meta: SessionMeta) => {
    e.stopPropagation();
    if (
      !window.confirm(
        `「${meta.title}」を削除します。PDF データも端末から消えます。`,
      )
    ) {
      return;
    }
    await deletePersistedSession(meta.id);
    await reload();
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
        <h2 className="home-heading">保存した比較</h2>
        <p className="home-hint">
          過去に取り込んだ PDF の組み合わせがこの端末に残ります。行を選ぶと続きから開けます。
        </p>

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
                  onClick={() => onOpen(meta.id)}
                >
                  <div className="session-card-head">
                    <span className="session-card-title">{meta.title}</span>
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
      </main>
    </div>
  );
}
