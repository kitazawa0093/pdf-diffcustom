import type { AlignedPageRow } from "./types";
import { searchTextIncludes, sessionMetaMatchesSearch } from "./searchNormalize";
import {
  listSessionMeta,
  loadPersistedSession,
  type SessionMeta,
} from "./sessionStore";

export interface CompanySearchRowHit {
  rowId: number;
  label: string;
  anchorA: string;
  anchorB: string;
  pageA: number | null;
  pageB: number | null;
  changeCount: number;
}

export interface CompanySearchSessionHit {
  meta: SessionMeta;
  /** 比較結果のページ行（ファイル名のみ一致のときは空） */
  rows: CompanySearchRowHit[];
  matchedByFileName: boolean;
}

function rowMatchesCompany(
  row: AlignedPageRow,
  query: string,
  fileNameA: string | null,
  fileNameB: string | null,
): boolean {
  return searchTextIncludes(
    [
      fileNameA ?? "",
      fileNameB ?? "",
      row.label,
      row.anchorA,
      row.anchorB,
    ].join("\n"),
    query,
  );
}

function rowToHit(row: AlignedPageRow): CompanySearchRowHit {
  return {
    rowId: row.id,
    label: row.label,
    anchorA: row.anchorA,
    anchorB: row.anchorB,
    pageA: row.pageA,
    pageB: row.pageB,
    changeCount: row.diff.changeCount,
  };
}

/** 全保存案件から会社名（ファイル名・宛先）で比較結果を検索 */
export async function searchSessionsByCompany(
  query: string,
): Promise<CompanySearchSessionHit[]> {
  const q = query.trim();
  if (!q) return [];

  const metas = await listSessionMeta();
  const hits: CompanySearchSessionHit[] = [];

  await Promise.all(
    metas.map(async (meta) => {
      const fileHit = sessionMetaMatchesSearch(meta, q);
      const session = await loadPersistedSession(meta.id);
      const rows: CompanySearchRowHit[] = [];

      if (session?.compareResult) {
        for (const row of session.compareResult.rows) {
          if (rowMatchesCompany(row, q, meta.fileNameA, meta.fileNameB)) {
            rows.push(rowToHit(row));
          }
        }
      }

      if (rows.length > 0) {
        hits.push({
          meta,
          rows,
          matchedByFileName: false,
        });
        return;
      }

      if (fileHit) {
        hits.push({
          meta,
          rows: [],
          matchedByFileName: true,
        });
      }
    }),
  );

  hits.sort((a, b) => b.meta.savedAt - a.meta.savedAt);
  return hits;
}
