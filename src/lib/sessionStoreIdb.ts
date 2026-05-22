import type { PersistedSessionV1, SessionMeta } from "./sessionStoreTypes";
import { createSessionId, metaFromSession } from "./sessionStoreTypes";

const DB_NAME = "pdf-diff-session";
const DB_VERSION = 1;
const STORE_NAME = "session";
const INDEX_KEY = "__index__";
const LEGACY_KEY = "current";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB を開けません"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function loadIndex(db: IDBDatabase): Promise<SessionMeta[]> {
  const raw = await idbGet<SessionMeta[]>(db, INDEX_KEY);
  return raw ?? [];
}

async function saveIndex(db: IDBDatabase, index: SessionMeta[]): Promise<void> {
  await idbPut(db, INDEX_KEY, index);
}

let legacyMigrated = false;

async function migrateLegacyIfNeeded(db: IDBDatabase): Promise<void> {
  if (legacyMigrated) return;
  const legacy = await idbGet<
    Omit<PersistedSessionV1, "id"> & { id?: string }
  >(db, LEGACY_KEY);
  if (!legacy || (!legacy.pdfA && !legacy.pdfB)) {
    legacyMigrated = true;
    return;
  }
  const id = legacy.id ?? createSessionId();
  const savedAt = legacy.savedAt ?? Date.now();
  const session: PersistedSessionV1 = {
    version: 1,
    id,
    savedAt,
    pdfA: legacy.pdfA,
    pdfB: legacy.pdfB,
    settings: legacy.settings,
    autoCompare: legacy.autoCompare ?? false,
    bookmarks: legacy.bookmarks,
  };
  await idbPut(db, id, session);
  await idbDelete(db, LEGACY_KEY);
  const index = await loadIndex(db);
  if (!index.some((m) => m.id === id)) {
    index.unshift(metaFromSession(id, session));
    await saveIndex(db, index);
  }
  legacyMigrated = true;
}

export async function idbListSessionMeta(): Promise<SessionMeta[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const db = await openDb();
    try {
      await migrateLegacyIfNeeded(db);
      const index = await loadIndex(db);
      return [...index].sort((a, b) => b.savedAt - a.savedAt);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export async function idbLoadPersistedSession(
  id: string,
): Promise<PersistedSessionV1 | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDb();
    try {
      await migrateLegacyIfNeeded(db);
      const raw = await idbGet<PersistedSessionV1>(db, id);
      if (!raw || raw.version !== 1) return null;
      if (!raw.pdfA && !raw.pdfB) return null;
      return { ...raw, id };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function idbSavePersistedSession(
  id: string,
  session: Omit<PersistedSessionV1, "id" | "savedAt"> & {
    savedAt?: number;
  },
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const payload: PersistedSessionV1 = {
    ...session,
    version: 1,
    id,
    savedAt: session.savedAt ?? Date.now(),
  };
  const db = await openDb();
  try {
    await migrateLegacyIfNeeded(db);
    await idbPut(db, id, payload);
    const index = await loadIndex(db);
    const meta = metaFromSession(id, payload);
    const at = index.findIndex((m) => m.id === id);
    if (at >= 0) index[at] = meta;
    else index.unshift(meta);
    index.sort((a, b) => b.savedAt - a.savedAt);
    await saveIndex(db, index);
  } finally {
    db.close();
  }
}

export async function idbDeletePersistedSession(id: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  try {
    await idbDelete(db, id);
    const index = await loadIndex(db);
    await saveIndex(
      db,
      index.filter((m) => m.id !== id),
    );
  } finally {
    db.close();
  }
}

/** IndexedDB → ファイル移行用に全セッションを読み出す */
export async function idbExportAllSessions(): Promise<PersistedSessionV1[]> {
  if (typeof indexedDB === "undefined") return [];
  const metas = await idbListSessionMeta();
  const sessions: PersistedSessionV1[] = [];
  for (const meta of metas) {
    const s = await idbLoadPersistedSession(meta.id);
    if (s) sessions.push(s);
  }
  return sessions;
}
