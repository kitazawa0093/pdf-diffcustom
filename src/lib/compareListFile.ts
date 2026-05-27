import { invoke, isTauri } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { exists, readFile } from "@tauri-apps/plugin-fs";
import {
  COMPARE_LIST_FILENAMES,
  dedupeFilterList,
  isExcelPath,
  parseFilterListFromBuffer,
  parseFilterListText,
} from "./filterList";

export async function getInstallDirPath(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string>("get_install_dir");
  } catch {
    return null;
  }
}

/** 設置フォルダ内の比較リスト Excel パス（見つからなければ null） */
export async function findCompareListExcelPath(): Promise<string | null> {
  const installDir = await getInstallDirPath();
  if (!installDir) return null;
  for (const name of COMPARE_LIST_FILENAMES) {
    const path = await join(installDir, name);
    if (await exists(path)) return path;
  }
  return null;
}

function bufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export async function loadCompareListFromPath(
  path: string,
): Promise<string[]> {
  const bytes = await readFile(path);
  if (isExcelPath(path)) {
    return parseFilterListFromBuffer(bufferFromBytes(bytes));
  }
  return parseFilterListText(new TextDecoder().decode(bytes));
}

/** 実行ファイルと同じフォルダから比較リストを読み込む */
export async function loadCompareListFromInstallDir(): Promise<{
  items: string[];
  fileName: string;
  path: string;
} | null> {
  const path = await findCompareListExcelPath();
  if (!path) return null;
  const raw = await loadCompareListFromPath(path);
  const items = dedupeFilterList(raw);
  const fileName = path.split(/[/\\]/).pop() ?? path;
  return { items, fileName, path };
}

export function compareListHintPath(installDir: string | null): string {
  if (!installDir) return COMPARE_LIST_FILENAMES[0];
  return `${installDir}/${COMPARE_LIST_FILENAMES[0]}`;
}
