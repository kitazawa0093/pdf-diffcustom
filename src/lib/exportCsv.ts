import type { CompareResult } from "./types";

function escapeCsv(value: string | number | null | undefined): string {
  if (value == null) return '""';
  const s = String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function csvRow(cols: (string | number | null | undefined)[]): string {
  return cols.map(escapeCsv).join(",");
}

const HEADERS = [
  "組番号",
  "Aページ",
  "Bページ",
  "ページ対応",
  "ページ種別",
  "差分種別",
  "旧テキスト",
  "新テキスト",
  "文字数",
] as const;

function pageKindLabel(kind: string): string {
  switch (kind) {
    case "insert":
      return "ページ追加";
    case "delete":
      return "ページ削除";
    case "change":
      return "ページ変更";
    default:
      return "一致";
  }
}

function diffKindLabel(kind: "delete" | "insert"): string {
  return kind === "delete" ? "削除" : "追加";
}

export function buildDiffCsv(
  compare: CompareResult,
  fileA: string,
  fileB: string,
): string {
  const lines: string[] = [
    csvRow(["PDF A", fileA]),
    csvRow(["PDF B", fileB]),
    csvRow([]),
    csvRow([...HEADERS]),
  ];

  for (const row of compare.rows) {
    const pageKind = pageKindLabel(row.kind);

    if (row.diff.changes.length === 0) {
      if (row.kind === "match") continue;
      lines.push(
        csvRow([
          row.id,
          row.pageA ?? "",
          row.pageB ?? "",
          row.label,
          pageKind,
          "—",
          "",
          "",
          0,
        ]),
      );
      continue;
    }

    for (const ch of row.diff.changes) {
      lines.push(
        csvRow([
          row.id,
          row.pageA ?? "",
          row.pageB ?? "",
          row.label,
          pageKind,
          diffKindLabel(ch.kind),
          ch.oldText,
          ch.newText,
          ch.length,
        ]),
      );
    }
  }

  return `\uFEFF${lines.join("\r\n")}`;
}

export function downloadDiffCsv(
  compare: CompareResult,
  fileA: string,
  fileB: string,
): void {
  const csv = buildDiffCsv(compare, fileA, fileB);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  anchor.href = url;
  anchor.download = `pdf-diff_${stamp}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
