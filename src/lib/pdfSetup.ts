import * as pdfjs from "pdfjs-dist";

/** Vite / ブラウザ用 worker（postinstall で public に cmaps も配置） */
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

/** 日本語請求書向け: オフラインで cMap / 標準フォントを public から読む */
export const pdfDocumentInit = {
  cMapUrl: `${import.meta.env.BASE_URL}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${import.meta.env.BASE_URL}standard_fonts/`,
  useSystemFonts: true,
};

export { pdfjs };
