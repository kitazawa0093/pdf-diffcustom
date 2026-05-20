import { Util } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { CharBox, PageText, PdfRect } from "./types";
import { charWidthsForString, measureTextWidth } from "./textMeasure";

/** 抽出時の基準スケール（表示時に掛け合わせる） */
export const EXTRACT_SCALE = 1;

const Y_TOLERANCE = 2;
const DESCENT_RATIO = 0.1;
/** pdf.js TextLayer.#getAscent のフォールバック */
const FONT_ASCENT_RATIO = 0.88;
const ADJACENT_GLYPH_MAX_RATIO = 1.12;

type InternalCharBox = CharBox & { singleSource: boolean };

function sameTextLine(a: CharBox, b: CharBox): boolean {
  return Math.abs(a.rect.y - b.rect.y) <= Y_TOLERANCE;
}

/** pdf.js TextLayer #appendText と同じ shouldScaleText 判定（item.transform ベース） */
function shouldScaleTextItem(str: string, transform: number[]): boolean {
  if (str.length > 1) return true;
  if (str === " ") return false;
  if (transform[0] !== transform[3]) {
    const absScaleX = Math.abs(transform[0]);
    const absScaleY = Math.abs(transform[3]);
    if (
      absScaleX !== absScaleY &&
      Math.max(absScaleX, absScaleY) / Math.min(absScaleX, absScaleY) > 1.5
    ) {
      return true;
    }
  }
  return false;
}

function minCharWidth(char: string, height: number): number {
  if (char === " " || char === "\u3000") return height * 0.18;
  return height * 0.3;
}

function applyMinCharWidths(chars: CharBox[]): void {
  for (const c of chars) {
    const minW = minCharWidth(c.char, c.rect.height);
    if (c.rect.width < minW) c.rect.width = minW;
  }
}

/**
 * 1 文字 = 1 text item の PDF で、推定幅が隣 glyph までの距離より狭い場合だけ幅を合わせる。
 */
function snapSingleGlyphWidths(chars: InternalCharBox[]): void {
  for (let i = 0; i < chars.length - 1; i++) {
    const cur = chars[i]!;
    const next = chars[i + 1]!;
    if (!cur.singleSource || !next.singleSource) continue;
    if (!sameTextLine(cur, next)) continue;

    const gap = next.rect.x - cur.rect.x;
    if (gap <= 0) continue;

    const em = cur.rect.height * FONT_ASCENT_RATIO;
    if (gap > em * ADJACENT_GLYPH_MAX_RATIO) continue;
    if (cur.rect.width < gap * 0.92) {
      cur.rect.width = gap;
    }
  }
}

function itemToCharBoxes(
  str: string,
  x: number,
  y: number,
  height: number,
  charWidths: number[],
  startIndex: number,
  singleSource: boolean,
): InternalCharBox[] {
  const chars = [...str];
  let cursorX = x;
  const boxes: InternalCharBox[] = [];

  for (let i = 0; i < chars.length; i++) {
    const w = charWidths[i] ?? 0;
    boxes.push({
      char: chars[i]!,
      index: startIndex + i,
      singleSource,
      rect: { x: cursorX, y, width: w, height },
    });
    cursorX += w;
  }

  return boxes;
}

type TextStyle = { fontFamily: string };

function extractItemBoxes(
  item: { str: string; transform: number[]; width: number; fontName: string },
  viewportTransform: number[],
  styles: Record<string, TextStyle>,
  startIndex: number,
): { boxes: InternalCharBox[]; nextIndex: number } {
  const tx = Util.transform(viewportTransform, item.transform);
  const fontHeight = Math.hypot(tx[2], tx[3]) || 12;
  const fontAscent = fontHeight * FONT_ASCENT_RATIO;
  const fontDescent = fontHeight * DESCENT_RATIO;

  const fontFamily = styles[item.fontName]?.fontFamily ?? "sans-serif";
  const scaled = shouldScaleTextItem(item.str, item.transform);
  const glyphCount = [...item.str].length;
  const singleSource = glyphCount === 1 && !scaled;

  let charWidths: number[];
  if (scaled) {
    // pdf.js TextLayer: canvasWidth = geom.width, scaleX で measured を引き伸ばす
    charWidths = charWidthsForString(
      item.str,
      item.width,
      fontHeight,
      fontFamily,
    );
  } else {
    charWidths = [...item.str].map((ch) => {
      if (ch === " " || ch === "\u3000") return fontHeight * 0.28;
      const w = measureTextWidth(ch, fontHeight, fontFamily);
      return w > 0 ? w : fontHeight * 0.5;
    });
  }

  const x = tx[4];
  const y = tx[5] - fontAscent;
  const height = fontAscent + fontDescent;

  const boxes = itemToCharBoxes(
    item.str,
    x,
    y,
    height,
    charWidths,
    startIndex,
    singleSource,
  );

  return { boxes, nextIndex: startIndex + glyphCount };
}

function finalizeChars(raw: InternalCharBox[]): CharBox[] {
  const sorted = [...raw].sort((a, b) => {
    const yDiff = a.rect.y - b.rect.y;
    if (Math.abs(yDiff) > Y_TOLERANCE) return yDiff;
    return a.rect.x - b.rect.x;
  });
  snapSingleGlyphWidths(sorted);
  applyMinCharWidths(sorted);
  return sorted.map((c, i) => ({
    char: c.char,
    index: i,
    rect: c.rect,
  }));
}

/**
 * pdf.js TextLayer と同様に viewport 座標（左上原点）で bbox を取る。
 */
export async function extractPageText(
  doc: PDFDocumentProxy,
  pageNumber: number,
): Promise<PageText> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: EXTRACT_SCALE });
  const textContent = await page.getTextContent();

  const raw: InternalCharBox[] = [];
  let index = 0;

  for (const item of textContent.items) {
    if (!("str" in item) || !item.str) continue;
    const result = extractItemBoxes(
      item,
      viewport.transform,
      textContent.styles,
      index,
    );
    raw.push(...result.boxes);
    index = result.nextIndex;
  }

  const chars = finalizeChars(raw);
  const text = chars.map((c) => c.char).join("");

  return { pageNumber, chars, text };
}

export async function extractAllPages(
  doc: PDFDocumentProxy,
): Promise<PageText[]> {
  const pages: PageText[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    pages.push(await extractPageText(doc, i));
  }
  return pages;
}

export function unionRects(rects: PdfRect[]): PdfRect | null {
  if (rects.length === 0) return null;
  const xs = rects.map((r) => r.x);
  const ys = rects.map((r) => r.y);
  const rights = rects.map((r) => r.x + r.width);
  const bottoms = rects.map((r) => r.y + r.height);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const right = Math.max(...rights);
  const bottom = Math.max(...bottoms);
  return { x, y, width: right - x, height: bottom - y };
}
