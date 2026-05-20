import type { PDFDocumentProxy } from "pdfjs-dist";
import { pdfjs, pdfDocumentInit } from "./pdfSetup";

export async function loadPdfFromArrayBuffer(
  buffer: ArrayBuffer,
): Promise<PDFDocumentProxy> {
  // pdf.js は Uint8Array を要求（ArrayBuffer のままだと失敗することがある）
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({
    data,
    ...pdfDocumentInit,
  });
  return loadingTask.promise;
}

export async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}
