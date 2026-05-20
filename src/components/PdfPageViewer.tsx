import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { RenderTask } from "pdfjs-dist";
import { scaleRect } from "../lib/diffPages";
import { EXTRACT_SCALE } from "../lib/pdfExtract";
import type { HighlightRect } from "../lib/types";

interface PdfPageViewerProps {
  doc: PDFDocumentProxy | null;
  pageNumber: number;
  scale?: number;
  highlights?: HighlightRect[];
  label: string;
  /** 御中・様 から取った宛先文字列（デバッグ表示） */
  anchorText?: string;
}

const KIND_COLORS: Record<HighlightRect["kind"], string> = {
  equal: "transparent",
  delete: "rgba(239, 68, 68, 0.45)",
  insert: "rgba(34, 197, 94, 0.45)",
};

export function PdfPageViewer({
  doc,
  pageNumber,
  scale = 1.2,
  highlights = [],
  label,
  anchorText,
}: PdfPageViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    if (!doc || !canvasRef.current) {
      setStatus("idle");
      return;
    }

    let cancelled = false;
    let renderTask: RenderTask | null = null;

    setStatus("loading");
    setRenderError(null);

    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        setSize({ width: viewport.width, height: viewport.height });

        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D context を取得できません");

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        renderTask = page.render({ canvasContext: ctx, viewport });
        await renderTask.promise;

        if (!cancelled) setStatus("ok");
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setRenderError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, scale]);

  return (
    <div className="page-viewer">
      <div className="page-label">{label} — p.{pageNumber}</div>
      <div
        className="page-canvas-wrap"
        style={{
          width: size.width || 280,
          height: size.height || 360,
          minHeight: 200,
        }}
      >
        {status === "loading" && <div className="page-status">読み込み中…</div>}
        {status === "error" && (
          <div className="page-status error">描画エラー: {renderError}</div>
        )}
        <canvas ref={canvasRef} style={{ visibility: status === "ok" ? "visible" : "hidden" }} />
        {status === "ok" && size.width > 0 && (
          <svg
            className="page-overlay"
            width={size.width}
            height={size.height}
            viewBox={`0 0 ${size.width} ${size.height}`}
          >
            {highlights.map((h, i) => {
              const r = scaleRect(h.rect, scale, EXTRACT_SCALE);
              return (
                <rect
                  key={i}
                  x={r.x}
                  y={r.y}
                  width={r.width}
                  height={r.height}
                  fill={KIND_COLORS[h.kind]}
                  stroke={h.kind === "delete" ? "#dc2626" : "#16a34a"}
                  strokeWidth={1}
                  rx={1}
                />
              );
            })}
          </svg>
        )}
      </div>
      {anchorText !== undefined && (
        <div className="page-anchor" title="御中・様の直前から取った文字列">
          取込: {anchorText || "（未取得）"}
        </div>
      )}
    </div>
  );
}
