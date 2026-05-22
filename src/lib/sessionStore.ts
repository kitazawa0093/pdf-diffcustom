import { isTauri } from "@tauri-apps/api/core";
import {
  fileDeletePersistedSession,
  fileListSessionMeta,
  fileLoadPersistedSession,
  fileSavePersistedSession,
  getDataRootPath,
} from "./sessionFileStore";
import {
  idbDeletePersistedSession,
  idbListSessionMeta,
  idbLoadPersistedSession,
  idbSavePersistedSession,
} from "./sessionStoreIdb";

export type {
  PersistedSessionV1,
  SessionMeta,
  StoredPdf,
} from "./sessionStoreTypes";
export {
  buildSessionTitle,
  cloneArrayBuffer,
  compareSettingsEqual,
  createSessionId,
  formatSavedAt,
} from "./sessionStoreTypes";

function useFileStore(): boolean {
  return isTauri();
}

export async function getStorageLocationHint(): Promise<string | null> {
  if (!useFileStore()) return null;
  try {
    const root = await getDataRootPath();
    return `${root}（アプリと同じフォルダ内）`;
  } catch {
    return "アプリと同じフォルダ内の data";
  }
}

export async function listSessionMeta() {
  if (useFileStore()) return fileListSessionMeta();
  return idbListSessionMeta();
}

export async function loadPersistedSession(id: string) {
  if (useFileStore()) return fileLoadPersistedSession(id);
  return idbLoadPersistedSession(id);
}

export async function savePersistedSession(
  id: string,
  session: Parameters<typeof idbSavePersistedSession>[1],
) {
  if (useFileStore()) return fileSavePersistedSession(id, session);
  return idbSavePersistedSession(id, session);
}

export async function deletePersistedSession(id: string) {
  if (useFileStore()) return fileDeletePersistedSession(id);
  return idbDeletePersistedSession(id);
}
