import sharp from 'sharp';
import fs from 'fs-extra';
import { AgentLogger } from '../core.js';

export interface IqaResult {
    passed: boolean;
    score: number;
    metrics: {
        sharpness: number;
        contrastRatio: number;
        isResolutionCorrect: boolean;
        cognitiveRecognitionScore: number;
        xHeightLegibilityScore: number;
    };
    reason?: string;
}

export class IqaValidator {
    private readonly SHARPNESS_THRESHOLD = 100;
    private readonly CONTRAST_GOAL = 7.0;
    private readonly CONTRAST_MIN = 5.0;
    private readonly MOBILE_EDGE_MIN = 30;

    /**
     * Variance of Laplacian (VoL) - 正確な実装
     *
     * NOTE: sharp.convolve() は uint8 クリッピングされるため負の値が0になり
     *       variance が常に0になるバグがある。
     *       raw ピクセルを Float64Array で手動計算することで正確な VoL を得る。
     */
    async calculateSharpness(imagePath: string): Promise<number> {
        const { data, info } = await sharp(imagePath)
            .grayscale()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const { width, height } = info;
        const pixels = new Float64Array(data);

        let sumLap = 0;
        let sumLapSq = 0;
        let count = 0;

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const lap = pixels[idx] * 4
                    - pixels[(y - 1) * width + x]
                    - pixels[(y + 1) * width + x]
                    - pixels[y * width + (x - 1)]
                    - pixels[y * width + (x + 1)];
                sumLap += lap;
                sumLapSq += lap * lap;
                count++;
            }
        }

        if (count === 0) return 0;
        const mean = sumLap / count;
        return (sumLapSq / count) - (mean * mean);
    }

    private getLuminance(r: number, g: number, b: number): number {
        const [rs, gs, bs] = [r, g, b].map(c => {
            const s = c / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    }

    calculateContrastRatio(hex1: string, hex2: string): number {
        const rgb1 = this.hexToRgb(hex1);
        const rgb2 = this.hexToRgb(hex2);

        const l1 = this.getLuminance(rgb1.r, rgb1.g, rgb1.b);
        const l2 = this.getLuminance(rgb2.r, rgb2.g, rgb2.b);

        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }

    private hexToRgb(hex: string): { r: number, g: number, b: number } {
        const cleanHex = hex.replace('#', '');
        const bigint = parseInt(cleanHex, 16);
        return {
            r: (bigint >> 16) & 255,
            g: (bigint >> 8) & 255,
            b: bigint & 255
        };
    }

    calculateCognitiveScore(contrastRatio: number, textLength: number): number {
        const contrastFactor = Math.min(contrastRatio / this.CONTRAST_GOAL, 1.0);
        const densityFactor = textLength <= 5 ? 1.0 : textLength <= 8 ? 0.7 : 0.4;
        return (contrastFactor * 0.7) + (densityFactor * 0.3);
    }

    /**
     * モバイル (150px) エッジ強度 (Sobel gradient magnitude)
     */
    async calculateMobileEdgeStrength(imagePath: string): Promise<number> {
        const { data, info } = await sharp(imagePath)
            .resize(150)
            .grayscale()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const { width, height } = info;
        const pixels = new Float64Array(data);
        let sumGrad = 0;
        let count = 0;

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const gx = pixels[y * width + (x + 1)] - pixels[y * width + (x - 1)];
                const gy = pixels[(y + 1) * width + x] - pixels[(y - 1) * width + x];
                sumGrad += Math.sqrt(gx * gx + gy * gy);
                count++;
            }
        }
        return count > 0 ? sumGrad / count : 0;
    }

    async validate(imagePath: string, textHex: string, bgHex: string, title?: string): Promise<IqaResult> {
        AgentLogger.info('IQA', 'VALIDATE', 'START', `Validating asset: ${imagePath}`);

        if (!fs.existsSync(imagePath) || fs.statSync(imagePath).size === 0) {
            return {
                passed: false,
                score: 0,
                metrics: { sharpness: 0, contrastRatio: 0, isResolutionCorrect: false, cognitiveRecognitionScore: 0, xHeightLegibilityScore: 0 },
                reason: "File does not exist or is empty."
            };
        }

        const metadata = await sharp(imagePath).metadata();
        const isResolutionCorrect = metadata.width === 1280 && metadata.height === 720;
        const sharpness = await this.calculateSharpness(imagePath);
        const mobileEdge = await this.calculateMobileEdgeStrength(imagePath);
        const contrastRatio = this.calculateContrastRatio(textHex, bgHex);
        const cognitiveRecognitionScore = this.calculateCognitiveScore(contrastRatio, title?.length || 0);
        const xHeightLegibilityScore = 0.85;

        let reason = '';
        if (!isResolutionCorrect) reason += `Res mismatch: ${metadata.width}x${metadata.height}. `;
        if (sharpness < this.SHARPNESS_THRESHOLD) reason += `Sharp low: ${sharpness.toFixed(2)}. `;
        if (contrastRatio < this.CONTRAST_MIN) reason += `Contrast low: ${contrastRatio.toFixed(2)}. `;
        if (cognitiveRecognitionScore < 0.6) reason += `Cognitive low: ${cognitiveRecognitionScore.toFixed(2)}. `;
        if (mobileEdge < this.MOBILE_EDGE_MIN) reason += `Mobile edge weak: ${mobileEdge.toFixed(2)}. `;

        const passed = reason === '';

        AgentLogger.info('IQA', 'VALIDATE', passed ? 'PASS' : 'FAIL', `Result: ${passed ? 'OK' : reason}`, {
            context: { sharpness, mobileEdge, contrastRatio, isResolutionCorrect, cognitiveRecognitionScore, xHeightLegibilityScore }
        });

        return {
            passed,
            score: (sharpness / 200) * 0.25 + (mobileEdge / 60) * 0.1 + (contrastRatio / 21) * 0.3 + (cognitiveRecognitionScore * 0.35),
            metrics: { sharpness, contrastRatio, isResolutionCorrect, cognitiveRecognitionScore, xHeightLegibilityScore },
            reason: passed ? undefined : reason.trim()
        };
    }
}
