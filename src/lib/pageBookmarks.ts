/** 比較行のしおりキー（再比較後も A/B ページ番号で同じ行に復元） */
export function pageBookmarkKey(
  pageA: number | null,
  pageB: number | null,
): string {
  return `a${pageA ?? "-"}:b${pageB ?? "-"}`;
}

/** プレビュー時（比較前）のしおりキー */
export function previewBookmarkKey(navIndex: number): string {
  return `preview:${navIndex}`;
}

export function bookmarkKeyForNav(
  compare: boolean,
  navIndex: number,
  pageA: number | null | undefined,
  pageB: number | null | undefined,
): string {
  if (compare) return pageBookmarkKey(pageA ?? null, pageB ?? null);
  return previewBookmarkKey(navIndex);
}

export function toggleBookmarkKey(
  keys: string[],
  key: string,
): string[] {
  const set = new Set(keys);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return [...set];
}
