/**
 * 検索用の文字列正規化（大文字小文字・半角全角を揃える）
 * NFKC: 全角英数→半角、半角カナ→全角カナ など
 */
export function normalizeForSearch(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/** 正規化後の部分一致 */
export function searchTextIncludes(haystack: string, query: string): boolean {
  const q = normalizeForSearch(query.trim());
  if (!q) return true;
  return normalizeForSearch(haystack).includes(q);
}

/** 保存一覧の案件（PDF ファイル名・タイトル） */
export function sessionMetaMatchesSearch(
  meta: {
    title: string;
    fileNameA: string | null;
    fileNameB: string | null;
  },
  query: string,
): boolean {
  return searchTextIncludes(
    [meta.title, meta.fileNameA ?? "", meta.fileNameB ?? ""].join("\n"),
    query,
  );
}
