import * as XLSX from "xlsx";
import { extractPageAnchorText } from "./pageAlign";
import { normalizeForSearch } from "./searchNormalize";
import type { PageText } from "./types";

const EXCEL_EXTENSIONS = [".xlsx", ".xls", ".xlsm", ".xlsb", ".ods"] as const;

/** 実行ファイルと同じフォルダに置く比較リスト（先頭から存在するものを使用） */
export const COMPARE_LIST_FILENAMES = [
  "compare-list.xlsx",
  "比較リスト.xlsx",
  "list.xlsx",
] as const;

export type FilterListMatchMode = "partial" | "exact";

export function isExcelFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return EXCEL_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function isExcelPath(path: string): boolean {
  const lower = path.toLowerCase();
  return EXCEL_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** テキストを 1 行 = 1 名前として分解（改行・カンマ・タブ・セミコロン区切り） */
export function parseFilterListText(text: string): string[] {
  const stripped = text.replace(/^\uFEFF/, "");
  return stripped
    .split(/[\r\n,;\t]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Excel の 1 枚目シート・A 列のセルを 1 行 = 1 名前として読み取る。
 */
export function parseFilterListFromBuffer(buffer: ArrayBuffer): string[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) return [];

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });

  const items: string[] = [];
  for (const row of rows) {
    if (!row) continue;
    const cell = row[0];
    if (cell == null) continue;
    const value =
      typeof cell === "string"
        ? cell
        : typeof cell === "number" || typeof cell === "boolean"
          ? String(cell)
          : "";
    const trimmed = value.trim();
    if (trimmed) items.push(trimmed);
  }
  return items;
}

export async function parseFilterListFromExcel(file: File): Promise<string[]> {
  return parseFilterListFromBuffer(await file.arrayBuffer());
}

/** 同じ意味の項目（正規化後一致）をまとめる */
export function dedupeFilterList(items: string[]): string[] {
  const seen = new Map<string, string>();
  for (const raw of items) {
    const key = normalizeForSearch(raw);
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, raw);
  }
  return [...seen.values()];
}

function anchorMatchesItem(
  anchorNorm: string,
  itemNorm: string,
  mode: FilterListMatchMode,
): boolean {
  if (!itemNorm) return false;
  if (mode === "exact") return anchorNorm === itemNorm;
  return anchorNorm.includes(itemNorm);
}

/** 宛先（御中/様）の前にあるテキストとマッチするか */
export function pageMatchesFilterList(
  page: PageText,
  items: string[],
  mode: FilterListMatchMode = "partial",
): boolean {
  if (items.length === 0) return true;
  const anchor = normalizeForSearch(extractPageAnchorText(page.chars));
  if (!anchor) return false;
  return items.some((item) =>
    anchorMatchesItem(anchor, normalizeForSearch(item), mode),
  );
}

/** リストでページを絞り込む（リストが空なら全件） */
export function filterPagesByList<T extends PageText>(
  pages: T[],
  items: string[],
  mode: FilterListMatchMode = "partial",
): T[] {
  if (items.length === 0) return pages;
  return pages.filter((p) => pageMatchesFilterList(p, items, mode));
}

export function filterListMatchModeLabel(mode: FilterListMatchMode): string {
  return mode === "exact" ? "完全一致" : "部分一致";
}
