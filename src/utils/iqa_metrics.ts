import sharp from "sharp";

export const IQA_THRESHOLDS = {
  SHARPNESS_MIN: 100,
  CONTRAST_GOAL: 7.0,
  CONTRAST_MIN: 5.0,
  MOBILE_EDGE_MIN: 25,
  COGNITIVE_MIN: 0.6,
};

export type BackgroundRisk = "low" | "medium" | "high";

export interface TextLayoutAnalysis {
  isTextClipped: boolean;
  clipBoundaryRatio: number;
  isTextOverlappingCharacter: boolean;
  overlapRatio: number;
  xHeightScore: number;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const v = Number.parseInt(hex.replace("#", ""), 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

export function getLuminance(r: number, g: number, b: number): number {
  const mapped = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const rs = mapped[0] ?? 0;
  const gs = mapped[1] ?? 0;
  const bs = mapped[2] ?? 0;
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export async function calculateSharpness(imagePath: string): Promise<number> {
  const { data, info } = await sharp(imagePath)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const px = new Float64Array(data);
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const pxI = px[i] ?? 0;
      const pxUp = px[(y - 1) * width + x] ?? 0;
      const pxDown = px[(y + 1) * width + x] ?? 0;
      const pxLeft = px[y * width + (x - 1)] ?? 0;
      const pxRight = px[y * width + (x + 1)] ?? 0;
      const lap = pxI * 4 - pxUp - pxDown - pxLeft - pxRight;
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

export async function calculateMobileEdgeStrength(imagePath: string): Promise<number> {
  const { data, info } = await sharp(imagePath)
    .resize(150)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const px = new Float64Array(data);
  let sum = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const gx = (px[y * width + (x + 1)] ?? 0) - (px[y * width + (x - 1)] ?? 0);
      const gy = (px[(y + 1) * width + x] ?? 0) - (px[(y - 1) * width + x] ?? 0);
      sum += Math.sqrt(gx * gx + gy * gy);
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

export function calculateContrastRatio(hex1: string, hex2: string): number {
  const { r: r1, g: g1, b: b1 } = hexToRgb(hex1);
  const { r: r2, g: g2, b: b2 } = hexToRgb(hex2);
  const l1 = getLuminance(r1, g1, b1);
  const l2 = getLuminance(r2, g2, b2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * x-height (小文字の高さ) 領域のピクセル密度を解析し、フォントの可読性を評価する。
 * ハイコントラストかつエッジが鋭いほど高スコアになる。
 */
export async function calculateXHeightScore(imagePath: string): Promise<number> {
  const { data, info } = await sharp(imagePath).grayscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  const sampleY = Math.round(height / 2);
  const sampleH = Math.round(height * 0.1);
  let edges = 0;
  let count = 0;

  for (let y = sampleY - sampleH; y < sampleY + sampleH; y++) {
    for (let x = 80; x < width - 80; x++) {
      const i = y * width + x;
      const val = data[i] ?? 0;
      const next = data[i + 1] ?? 0;
      if (Math.abs(val - next) > 50) {
        edges++;
      }
      count++;
    }
  }

  const density = count > 0 ? edges / count : 0;
  return Math.min(density * 10, 1.0);
}

export async function analyzeTextLayout(
  imagePath: string,
  charGuardBandPx = 850,
): Promise<TextLayoutAnalysis> {
  const xHeightScore = await calculateXHeightScore(imagePath);
  const { data, info } = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  // ... rest of the function remains similar but returns xHeightScore
  const ch = channels || 3;

  const CORNER = 40;
  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  let n = 0;
  for (const { x0, y0 } of [
    { x0: 0, y0: 0 },
    { x0: width - CORNER, y0: 0 },
    { x0: 0, y0: height - CORNER },
  ]) {
    for (let y = y0; y < Math.min(y0 + CORNER, height); y++) {
      for (let x = x0; x < Math.min(x0 + CORNER, width); x++) {
        const i = (y * width + x) * ch;
        bgR += data[i] ?? 0;
        bgG += data[i + 1] ?? 0;
        bgB += data[i + 2] ?? 0;
        n++;
      }
    }
  }
  const AB = [bgR / n, bgG / n, bgB / n];
  const isFg = (r: number, g: number, b: number): boolean => {
    const dr = r - (AB[0] ?? 0);
    const dg = g - (AB[1] ?? 0);
    const db = b - (AB[2] ?? 0);
    return Math.sqrt(dr * dr + dg * dg + db * db) > 30;
  };

  const clipL = Math.max(0, charGuardBandPx - 20);
  let clipFg = 0;
  let clipTotal = 0;
  let bodyFg = 0;
  let bodyTotal = 0;
  let charFg = 0;
  let charTotal = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * ch;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const fg = isFg(r, g, b);
      if (x >= clipL && x < charGuardBandPx) {
        clipTotal++;
        if (fg) clipFg++;
      } else if (x >= 80 && x < clipL) {
        bodyTotal++;
        if (fg) bodyFg++;
      } else if (x >= charGuardBandPx) {
        charTotal++;
        if (fg) charFg++;
      }
    }
  }

  const clipRatio = clipTotal > 0 ? clipFg / clipTotal : 0;
  const bodyDensity = bodyTotal > 0 ? bodyFg / bodyTotal : 0;
  const charDensity = charTotal > 0 ? charFg / charTotal : 0;

  return {
    isTextClipped: clipRatio > bodyDensity * 1.5 + 0.15,
    clipBoundaryRatio: clipRatio,
    isTextOverlappingCharacter: charDensity > bodyDensity + 0.2,
    overlapRatio: charDensity,
    xHeightScore,
  };
}
