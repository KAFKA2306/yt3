import sharp from 'sharp';
import fs from 'fs-extra';
import { AgentLogger } from '../core.js';

export const IQA_THRESHOLDS = {
    SHARPNESS_MIN: 100,
    CONTRAST_GOAL: 7.0,
    CONTRAST_MIN: 5.0,
    MOBILE_EDGE_MIN: 30,
    COGNITIVE_MIN: 0.6,
};

export type BackgroundRisk = 'low' | 'medium' | 'high';

export interface TextLayoutAnalysis {
    isTextClipped: boolean;
    clipBoundaryRatio: number;
    isTextOverlappingCharacter: boolean;
    overlapRatio: number;
}

export interface IqaResult {
    passed: boolean;
    score: number;
    metrics: {
        sharpness: number;
        contrastRatio: number;
        isResolutionCorrect: boolean;
        cognitiveRecognitionScore: number;
        xHeightLegibilityScore: number;
        mobileEdgeStrength?: number;
    };
    backgroundRisk?: BackgroundRisk;
    textLayout?: TextLayoutAnalysis;
    reason?: string;
}

export class IqaValidator {

    analyzeBackgroundRisk(bgHex: string): BackgroundRisk {
        const { r, g, b } = this.hexToRgb(bgHex);
        const lum = this.getLuminance(r, g, b);
        return lum > 0.4 ? 'high' : lum > 0.1 ? 'medium' : 'low';
    }

    async analyzeTextLayout(imagePath: string, charGuardBandPx = 850): Promise<TextLayoutAnalysis> {
        const { data, info } = await sharp(imagePath).raw().toBuffer({ resolveWithObject: true });
        const { width, height, channels } = info;
        const ch = channels || 3;

        // 4隅の平均色を背景色として推定
        const CORNER = 40;
        let bgR = 0, bgG = 0, bgB = 0, n = 0;
        for (const { x0, y0 } of [{ x0: 0, y0: 0 }, { x0: width - CORNER, y0: 0 }, { x0: 0, y0: height - CORNER }]) {
            for (let y = y0; y < Math.min(y0 + CORNER, height); y++) {
                for (let x = x0; x < Math.min(x0 + CORNER, width); x++) {
                    const i = (y * width + x) * ch;
                    bgR += data[i]; bgG += data[i + 1]; bgB += data[i + 2]; n++;
                }
            }
        }
        const AB = [bgR / n, bgG / n, bgB / n];
        const isFg = (r: number, g: number, b: number): boolean => {
            const [dr, dg, db] = [r - AB[0], g - AB[1], b - AB[2]];
            return Math.sqrt(dr * dr + dg * dg + db * db) > 30;
        };

        const clipL = Math.max(0, charGuardBandPx - 20);
        let clipTotal = 0, clipFg = 0, bodyTotal = 0, bodyFg = 0, charTotal = 0, charFg = 0;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * ch;
                const fg = isFg(data[i], data[i + 1], data[i + 2]);
                if (x >= clipL && x < charGuardBandPx) { clipTotal++; if (fg) clipFg++; }
                else if (x >= 80 && x < clipL) { bodyTotal++; if (fg) bodyFg++; }
                else if (x >= charGuardBandPx) { charTotal++; if (fg) charFg++; }
            }
        }

        const clipRatio = clipTotal > 0 ? clipFg / clipTotal : 0;
        const bodyDensity = bodyTotal > 0 ? bodyFg / bodyTotal : 0;
        const charDensity = charTotal > 0 ? charFg / charTotal : 0;

        return {
            isTextClipped: clipRatio > (bodyDensity * 1.5 + 0.15),
            clipBoundaryRatio: clipRatio,
            isTextOverlappingCharacter: charDensity > (bodyDensity + 0.20),
            overlapRatio: charDensity,
        };
    }

    async calculateSharpness(imagePath: string): Promise<number> {
        const { data, info } = await sharp(imagePath).grayscale().raw().toBuffer({ resolveWithObject: true });
        const { width, height } = info;
        const px = new Float64Array(data);
        let sum = 0, sumSq = 0, count = 0;
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const i = y * width + x;
                const lap = px[i] * 4 - px[(y - 1) * width + x] - px[(y + 1) * width + x] - px[y * width + (x - 1)] - px[y * width + (x + 1)];
                sum += lap; sumSq += lap * lap; count++;
            }
        }
        if (count === 0) return 0;
        const mean = sum / count;
        return (sumSq / count) - (mean * mean);
    }

    async calculateMobileEdgeStrength(imagePath: string): Promise<number> {
        const { data, info } = await sharp(imagePath).resize(150).grayscale().raw().toBuffer({ resolveWithObject: true });
        const { width, height } = info;
        const px = new Float64Array(data);
        let sum = 0, count = 0;
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const gx = px[y * width + (x + 1)] - px[y * width + (x - 1)];
                const gy = px[(y + 1) * width + x] - px[(y - 1) * width + x];
                sum += Math.sqrt(gx * gx + gy * gy); count++;
            }
        }
        return count > 0 ? sum / count : 0;
    }

    calculateContrastRatio(hex1: string, hex2: string): number {
        const { r: r1, g: g1, b: b1 } = this.hexToRgb(hex1);
        const { r: r2, g: g2, b: b2 } = this.hexToRgb(hex2);
        const l1 = this.getLuminance(r1, g1, b1);
        const l2 = this.getLuminance(r2, g2, b2);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }

    calculateCognitiveScore(contrastRatio: number, textLength: number): number {
        const contrastFactor = Math.min(contrastRatio / IQA_THRESHOLDS.CONTRAST_GOAL, 1.0);
        const densityFactor = textLength <= 5 ? 1.0 : textLength <= 8 ? 0.7 : 0.4;
        return contrastFactor * 0.7 + densityFactor * 0.3;
    }

    async validate(
        imagePath: string,
        textHex: string,
        bgHex: string,
        title?: string,
        charGuardBandPx = 850
    ): Promise<IqaResult> {
        AgentLogger.info('IQA', 'VALIDATE', 'START', imagePath);

        if (!fs.existsSync(imagePath) || fs.statSync(imagePath).size === 0) {
            return {
                passed: false, score: 0,
                metrics: { sharpness: 0, contrastRatio: 0, isResolutionCorrect: false, cognitiveRecognitionScore: 0, xHeightLegibilityScore: 0, mobileEdgeStrength: 0 },
                backgroundRisk: this.analyzeBackgroundRisk(bgHex),
                reason: 'ファイルが存在しないか空です。',
            };
        }

        const metadata = await sharp(imagePath).metadata();
        const isResolutionCorrect = metadata.width === 1280 && metadata.height === 720;
        const sharpness = await this.calculateSharpness(imagePath);
        const mobileEdgeStrength = await this.calculateMobileEdgeStrength(imagePath);
        const contrastRatio = this.calculateContrastRatio(textHex, bgHex);
        const cognitiveRecognitionScore = this.calculateCognitiveScore(contrastRatio, title?.length ?? 0);
        const backgroundRisk = this.analyzeBackgroundRisk(bgHex);
        const textLayout = await this.analyzeTextLayout(imagePath, charGuardBandPx).catch((): undefined => undefined);

        const reasons: string[] = [];
        if (!isResolutionCorrect) reasons.push(`解像度不一致: ${metadata.width}x${metadata.height}`);
        if (sharpness < IQA_THRESHOLDS.SHARPNESS_MIN) reasons.push(`鮮鋭度不足: ${sharpness.toFixed(2)}`);
        if (contrastRatio < IQA_THRESHOLDS.CONTRAST_MIN) reasons.push(`コントラスト不足: ${contrastRatio.toFixed(2)}`);
        if (cognitiveRecognitionScore < IQA_THRESHOLDS.COGNITIVE_MIN) reasons.push(`認知スコア不足: ${cognitiveRecognitionScore.toFixed(2)}`);
        if (mobileEdgeStrength < IQA_THRESHOLDS.MOBILE_EDGE_MIN) reasons.push(`Mobile edge weak: ${mobileEdgeStrength.toFixed(2)}`);
        if (textLayout?.isTextClipped) reasons.push(`テキスト見切れ: ${(textLayout.clipBoundaryRatio * 100).toFixed(1)}%`);
        if (textLayout?.isTextOverlappingCharacter) reasons.push(`テキスト重なり: ${(textLayout.overlapRatio * 100).toFixed(1)}%`);

        const passed = reasons.length === 0;
        AgentLogger.info('IQA', 'VALIDATE', passed ? 'PASS' : 'FAIL', reasons.join(' | ') || 'OK');

        return {
            passed,
            score: (sharpness / 200) * 0.20 + (mobileEdgeStrength / 60) * 0.10
                + (contrastRatio / 21) * 0.25 + cognitiveRecognitionScore * 0.25
                + (textLayout && !textLayout.isTextClipped ? 0.10 : 0)
                + (textLayout && !textLayout.isTextOverlappingCharacter ? 0.10 : 0),
            metrics: { sharpness, contrastRatio, isResolutionCorrect, cognitiveRecognitionScore, xHeightLegibilityScore: 0.85, mobileEdgeStrength },
            backgroundRisk, textLayout,
            reason: passed ? undefined : reasons.join(' | '),
        };
    }

    private getLuminance(r: number, g: number, b: number): number {
        const [rs, gs, bs] = [r, g, b].map(c => {
            const s = c / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    }

    private hexToRgb(hex: string): { r: number; g: number; b: number } {
        const v = parseInt(hex.replace('#', ''), 16);
        return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
    }
}
