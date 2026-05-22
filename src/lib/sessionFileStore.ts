import { exists, mkdir, readDir, readFile, readTextFile, remove, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { executableDir, join } from "@tauri-apps/api/path";
import { idbExportAllSessions } from "./sessionStoreIdb";
import type { PersistedSessionV1, SessionMeta, StoredPdf } from "./sessionStoreTypes";
import { metaFromSession } from "./sessionStoreTypes";

const DATA_DIR = "data";
const SESSIONS_DIR = "sessions";
const INDEX_FILE = "index.json";
const MIGRATION_MARKER = ".migrated-from-idb";
const SESSION_JSON = "session.json";
const PDF_A_FILE = "pdf-a.bin";
const PDF_B_FILE = "pdf-b.bin";

/** ディスク上の session.json（PDF 本体は別ファイル） */
type PersistedSessionJson = Omit<
  PersistedSessionV1,
  "pdfA" | "pdfB"
> & {
  pdfA: { fileName: string } | null;
  pdfB: { fileName: string } | null;
};

let dataRootCache: string | null = null;
let initPromise: Promise<void> | null = null;

export async function getDataRootPath(): Promise<string> {
  if (!dataRootCache) {
    const exe = await executableDir();
    dataRootCache = await join(exe, DATA_DIR);
  }
  return dataRootCache;
}

async function getSessionsRoot(): Promise<string> {
  return join(await getDataRootPath(), SESSIONS_DIR);
}

async function sessionDir(id: string): Promise<string> {
  return join(await getSessionsRoot(), id);
}

async function indexPath(): Promise<string> {
  return join(await getDataRootPath(), INDEX_FILE);
}

async function migrationMarkerPath(): Promise<string> {
  return join(await getDataRootPath(), MIGRATION_MARKER);
}

async function ensureDataDirs(): Promise<void> {
  const root = await getDataRootPath();
  const sessions = await getSessionsRoot();
  if (!(await exists(root))) {
    await mkdir(root, { recursive: true });
  }
  if (!(await exists(sessions))) {
    await mkdir(sessions, { recursive: true });
  }
}

function uint8ToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = bytes.slice();
  return copy.buffer;
}

function sessionToJson(session: PersistedSessionV1): PersistedSessionJson {
  const { pdfA, pdfB, ...rest } = session;
  return {
    ...rest,
    pdfA: pdfA ? { fileName: pdfA.fileName } : null,
    pdfB: pdfB ? { fileName: pdfB.fileName } : null,
  };
}

async function readPdfFile(
  dir: string,
  fileName: string,
  meta: { fileName: string } | null,
): Promise<StoredPdf | null> {
  if (!meta) return null;
  const path = await join(dir, fileName);
  if (!(await exists(path))) return null;
  const bytes = await readFile(path);
  return { fileName: meta.fileName, data: uint8ToArrayBuffer(bytes) };
}

async function writePdfFile(
  dir: string,
  fileName: string,
  pdf: StoredPdf | null,
): Promise<void> {
  const path = await join(dir, fileName);
  if (pdf) {
    await writeFile(path, new Uint8Array(pdf.data), { create: true });
  } else if (await exists(path)) {
    await remove(path);
  }
}

async function readIndex(): Promise<SessionMeta[]> {
  const path = await indexPath();
  if (!(await exists(path))) return [];
  try {
    const text = await readTextFile(path);
    const parsed = JSON.parse(text) as SessionMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeIndex(index: SessionMeta[]): Promise<void> {
  await ensureDataDirs();
  const sorted = [...index].sort((a, b) => b.savedAt - a.savedAt);
  await writeTextFile(await indexPath(), JSON.stringify(sorted));
}

async function rebuildIndexFromSessions(): Promise<SessionMeta[]> {
  const root = await getSessionsRoot();
  if (!(await exists(root))) return [];
  const entries = await readDir(root);
  const index: SessionMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const session = await fileLoadPersistedSession(entry.name);
    if (session) index.push(metaFromSession(session.id, session));
  }
  index.sort((a, b) => b.savedAt - a.savedAt);
  await writeIndex(index);
  return index;
}

async function migrateFromIndexedDbOnce(): Promise<void> {
  const marker = await migrationMarkerPath();
  if (await exists(marker)) return;

  const sessions = await idbExportAllSessions();
  for (const session of sessions) {
    await fileSavePersistedSession(session.id, session, session.savedAt);
  }

  await writeTextFile(marker, new Date().toISOString());
}

export async function ensureFileStoreReady(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await ensureDataDirs();
      await migrateFromIndexedDbOnce();
      const index = await readIndex();
      if (index.length === 0) {
        await rebuildIndexFromSessions();
      }
    })();
  }
  await initPromise;
}

export async function fileListSessionMeta(): Promise<SessionMeta[]> {
  await ensureFileStoreReady();
  let index = await readIndex();
  if (index.length === 0) {
    index = await rebuildIndexFromSessions();
  }
  return [...index].sort((a, b) => b.savedAt - a.savedAt);
}

export async function fileLoadPersistedSession(
  id: string,
): Promise<PersistedSessionV1 | null> {
  await ensureFileStoreReady();
  const dir = await sessionDir(id);
  const jsonPath = await join(dir, SESSION_JSON);
  if (!(await exists(jsonPath))) return null;

  try {
    const raw = JSON.parse(
      await readTextFile(jsonPath),
    ) as PersistedSessionJson;
    if (raw.version !== 1) return null;

    const pdfA = await readPdfFile(dir, PDF_A_FILE, raw.pdfA);
    const pdfB = await readPdfFile(dir, PDF_B_FILE, raw.pdfB);
    if (!pdfA && !pdfB) return null;

    return {
      ...raw,
      id,
      pdfA,
      pdfB,
    };
  } catch {
    return null;
  }
}

export async function fileSavePersistedSession(
  id: string,
  session: Omit<PersistedSessionV1, "id" | "savedAt"> & {
    savedAt?: number;
  },
  savedAtOverride?: number,
): Promise<void> {
  await ensureFileStoreReady();
  const payload: PersistedSessionV1 = {
    ...session,
    version: 1,
    id,
    savedAt: savedAtOverride ?? session.savedAt ?? Date.now(),
  };

  const dir = await sessionDir(id);
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }

  await writePdfFile(dir, PDF_A_FILE, payload.pdfA);
  await writePdfFile(dir, PDF_B_FILE, payload.pdfB);
  await writeTextFile(
    await join(dir, SESSION_JSON),
    JSON.stringify(sessionToJson(payload)),
  );

  const index = await readIndex();
  const meta = metaFromSession(id, payload);
  const at = index.findIndex((m) => m.id === id);
  if (at >= 0) index[at] = meta;
  else index.unshift(meta);
  await writeIndex(index);
}

export async function fileDeletePersistedSession(id: string): Promise<void> {
  await ensureFileStoreReady();
  const dir = await sessionDir(id);
  if (await exists(dir)) {
    await remove(dir, { recursive: true });
  }
  const index = await readIndex();
  await writeIndex(index.filter((m) => m.id !== id));
}
