let measureCtx: CanvasRenderingContext2D | null = null;

function getCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const canvas = document.createElement("canvas");
    measureCtx = canvas.getContext("2d")!;
  }
  return measureCtx;
}

export function measureTextWidth(
  text: string,
  fontSize: number,
  fontFamily: string,
): number {
  if (!text) return 0;
  const ctx = getCtx();
  ctx.font = `${fontSize}px ${fontFamily}`;
  return ctx.measureText(text).width;
}

/** 合計が totalWidth になるよう、文字ごとの幅を配分する */
export function charWidthsForString(
  text: string,
  totalWidth: number,
  fontSize: number,
  fontFamily: string,
): number[] {
  const chars = [...text];
  if (chars.length === 0) return [];

  const ctx = getCtx();
  ctx.font = `${fontSize}px ${fontFamily}`;

  const raw = chars.map((ch) => {
    if (ch === " " || ch === "\u3000") return fontSize * 0.28;
    return ctx.measureText(ch).width;
  });

  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    const even = totalWidth / chars.length;
    return chars.map(() => even);
  }

  const scale = totalWidth / sum;
  return raw.map((w) => w * scale);
}
