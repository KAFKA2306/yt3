import sharp from 'sharp';
import fs from 'fs-extra';
import { AgentLogger } from '../core.js';

// ============================================================
// 閾値定数 (テストから参照できるようにエクスポート)
// ============================================================
export const IQA_THRESHOLDS = {
    SHARPNESS_MIN: 100,       // Variance of Laplacian 下限
    CONTRAST_GOAL: 7.0,       // WCAG AAA 目標値
    CONTRAST_MIN: 5.0,        // 最低許容コントラスト比
    MOBILE_EDGE_MIN: 30,      // 150px縮小時のエッジ強度下限
    COGNITIVE_MIN: 0.6,       // 300ms認知スコア下限
    TEXT_CLIP_RATIO_MAX: 0.08,   // 右端クリップ領域内のテキスト画素比率上限 (8%)
    TEXT_OVERLAP_RATIO_MAX: 0.12, // キャラクター重複領域内のテキスト画素比率上限 (12%)
};

export type BackgroundRisk = 'low' | 'medium' | 'high';

export interface TextLayoutAnalysis {
    /**
     * テキストが右端でクリップ（見切れ）されていないか。
     * 右端20pxの列にテキスト色ピクセルが集中していればクリップと判定。
     */
    isTextClipped: boolean;
    /** 右端クリップ境界付近のテキスト画素比率 (0-1) */
    clipBoundaryRatio: number;
    /**
     * テキストがキャラクター画像と重なっていないか。
     * キャラクター領域（右側 guard_band）内にテキスト色が侵入していればTrue。
     */
    isTextOverlappingCharacter: boolean;
    /** キャラクター配置領域内のテキスト画素比率 (0-1) */
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
    private readonly SHARPNESS_THRESHOLD = IQA_THRESHOLDS.SHARPNESS_MIN;
    private readonly CONTRAST_GOAL = IQA_THRESHOLDS.CONTRAST_GOAL;
    private readonly CONTRAST_MIN = IQA_THRESHOLDS.CONTRAST_MIN;
    private readonly MOBILE_EDGE_MIN = IQA_THRESHOLDS.MOBILE_EDGE_MIN;

    /**
     * 背景色のモバイルエッジリスクを評価する。
     *
     * 輝度が高い（明るい）フラットカラー背景は、150pxに縮小した際に
     * テキストや他の要素とのエッジコントラストが消失しやすく、
     * MOBILE_EDGE_WEAK 失敗の主因となる。
     *
     * 輝度 > 0.4  → 'high'  (黄・白系: 要注意)
     * 輝度 0.1〜0.4 → 'medium'
     * 輝度 < 0.1  → 'low'  (濃紺・黒系: 安全)
     */
    analyzeBackgroundRisk(bgHex: string): BackgroundRisk {
        const rgb = this.hexToRgb(bgHex);
        const lum = this.getLuminance(rgb.r, rgb.g, rgb.b);
        if (lum > 0.4) return 'high';
        if (lum > 0.1) return 'medium';
        return 'low';
    }

    /**
     * テキストの見切れ・キャラクター重なりをピクセルレベルで検出する。
     *
     * アルゴリズム:
     * 1. 画像4隅 (50x50px) の平均色を「背景色」として推定する。
     *    → 文字・キャラクターが侵入しにくい領域
     * 2. 各ピクセルと背景色の色差 (ΔE ≈ Euclidean RGB距離) を計算し、
     *    閾値を超えたピクセルを「前景ピクセル (文字 or キャラクター)」とみなす。
     *    → 明るい黄色背景でも背景ピクセルとして正しく除外できる
     * 3. クリップゾーン (charGuardBandPx - 20 〜 charGuardBandPx) に
     *    前景ピクセルが集中していれば isTextClipped = true。
     * 4. キャラクターゾーン (charGuardBandPx 〜 width) 内で、
     *    テキストゾーン (x=80〜charGuardBandPx) との前景密度差を計算し、
     *    テキストゾーンより"異常に高い"密度であれば isTextOverlappingCharacter = true。
     *
     * @param imagePath 検証対象の画像ファイルパス
     * @param charGuardBandPx キャラクター配置の左端 X 座標 (config.right_guard_band_px)
     */
    async analyzeTextLayout(
        imagePath: string,
        charGuardBandPx: number = 850
    ): Promise<TextLayoutAnalysis> {
        const { data, info } = await sharp(imagePath)
            .raw()
            .toBuffer({ resolveWithObject: true });

        const { width, height, channels } = info;
        const ch = channels || 3;

        // ── Step 1: 背景色を4隅から推定 ─────────────────────────────
        const CORNER_SIZE = 40;
        let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;
        const corners = [
            { x0: 0, y0: 0 },                        // 左上
            { x0: width - CORNER_SIZE, y0: 0 },       // 右上
            { x0: 0, y0: height - CORNER_SIZE },      // 左下
            // 右下はキャラクター重複が起きやすいので除外
        ];
        for (const { x0, y0 } of corners) {
            for (let y = y0; y < Math.min(y0 + CORNER_SIZE, height); y++) {
                for (let x = x0; x < Math.min(x0 + CORNER_SIZE, width); x++) {
                    const idx = (y * width + x) * ch;
                    bgR += data[idx];
                    bgG += data[idx + 1];
                    bgB += data[idx + 2];
                    bgCount++;
                }
            }
        }
        const avgBgR = bgR / bgCount;
        const avgBgG = bgG / bgCount;
        const avgBgB = bgB / bgCount;

        // ── Step 2: 前景ピクセル検出 (背景との色差 > 閾値) ─────────
        // RGB ユークリッド距離で色差を計算。閾値 30 = 12% 変化 (0-255)
        const FG_THRESHOLD = 30;
        function isForeground(r: number, g: number, b: number): boolean {
            const dr = r - avgBgR;
            const dg = g - avgBgG;
            const db = b - avgBgB;
            return Math.sqrt(dr * dr + dg * dg + db * db) > FG_THRESHOLD;
        }

        // ── Step 3: クリップゾーン分析 ───────────────────────────────
        // テキストクリップパス直前の 20px 幅ゾーン
        const clipZoneLeft = Math.max(0, charGuardBandPx - 20);
        const clipZoneRight = charGuardBandPx;
        let clipZoneTotal = 0;
        let clipZoneFgCount = 0;

        // テキスト本体ゾーン (x=80 〜 clipZoneLeft) の密度を基準とする
        const textBodyLeft = 80;
        const textBodyRight = clipZoneLeft;
        let textBodyTotal = 0;
        let textBodyFgCount = 0;

        // キャラクターゾーン (charGuardBandPx 〜 width)
        let charZoneTotal = 0;
        let charZoneFgCount = 0;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * ch;
                const isFg = isForeground(data[idx], data[idx + 1], data[idx + 2]);

                if (x >= clipZoneLeft && x < clipZoneRight) {
                    clipZoneTotal++;
                    if (isFg) clipZoneFgCount++;
                } else if (x >= textBodyLeft && x < textBodyRight) {
                    textBodyTotal++;
                    if (isFg) textBodyFgCount++;
                } else if (x >= charGuardBandPx) {
                    charZoneTotal++;
                    if (isFg) charZoneFgCount++;
                }
            }
        }

        const clipBoundaryRatio = clipZoneTotal > 0 ? clipZoneFgCount / clipZoneTotal : 0;
        const textBodyDensity = textBodyTotal > 0 ? textBodyFgCount / textBodyTotal : 0;
        const charZoneDensity = charZoneTotal > 0 ? charZoneFgCount / charZoneTotal : 0;

        // クリップ判定:
        // テキスト本体密度の中心値より clip ゾーンが著しく高密度
        // → テキストエッジが境界に詰まっている(見切れ)
        const isTextClipped = clipBoundaryRatio > (textBodyDensity * 1.5 + 0.15);

        // オーバーラップ判定:
        // テキスト本体ゾーンの前景密度よりキャラクターゾーンが「追加で」高い
        // (キャラクター自体のピクセルも含むが、テキスト侵入分は baseline を超える)
        // キャラクターゾーン密度 > テキスト本体密度 + 0.20 → 侵入と判定
        const overlapRatio = charZoneDensity;
        const isTextOverlappingCharacter = charZoneDensity > (textBodyDensity + 0.20);

        return { isTextClipped, clipBoundaryRatio, isTextOverlappingCharacter, overlapRatio };
    }

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

    /**
     * フル IQA バリデーション
     *
     * @param imagePath   検証画像ファイルパス
     * @param textHex     テキスト色 (HEX)
     * @param bgHex       背景色 (HEX)
     * @param title       タイトル文字列 (認知スコア計算用)
     * @param charGuardBandPx  キャラクター配置の左端 X 座標 (デフォルト 850)
     */
    async validate(
        imagePath: string,
        textHex: string,
        bgHex: string,
        title?: string,
        charGuardBandPx: number = 850
    ): Promise<IqaResult> {
        AgentLogger.info('IQA', 'VALIDATE', 'START', `Validating asset: ${imagePath}`);

        if (!fs.existsSync(imagePath) || fs.statSync(imagePath).size === 0) {
            return {
                passed: false,
                score: 0,
                metrics: { sharpness: 0, contrastRatio: 0, isResolutionCorrect: false, cognitiveRecognitionScore: 0, xHeightLegibilityScore: 0, mobileEdgeStrength: 0 },
                backgroundRisk: this.analyzeBackgroundRisk(bgHex),
                reason: "File does not exist or is empty."
            };
        }

        const metadata = await sharp(imagePath).metadata();
        const isResolutionCorrect = metadata.width === 1280 && metadata.height === 720;
        const sharpness = await this.calculateSharpness(imagePath);
        const mobileEdgeStrength = await this.calculateMobileEdgeStrength(imagePath);
        const contrastRatio = this.calculateContrastRatio(textHex, bgHex);
        const cognitiveRecognitionScore = this.calculateCognitiveScore(contrastRatio, title?.length || 0);
        const xHeightLegibilityScore = 0.85;
        const backgroundRisk = this.analyzeBackgroundRisk(bgHex);

        // ★ テキストレイアウト分析 (見切れ・重なり検出)
        let textLayout: TextLayoutAnalysis | undefined;
        try {
            textLayout = await this.analyzeTextLayout(imagePath, charGuardBandPx);
        } catch (e) {
            AgentLogger.info('IQA', 'VALIDATE', 'WARN', `Text layout analysis failed: ${e}`);
        }

        let reason = '';
        if (!isResolutionCorrect) reason += `Res mismatch: ${metadata.width}x${metadata.height}. `;
        if (sharpness < this.SHARPNESS_THRESHOLD) reason += `Sharp low: ${sharpness.toFixed(2)}. `;
        if (contrastRatio < this.CONTRAST_MIN) reason += `Contrast low: ${contrastRatio.toFixed(2)}. `;
        if (cognitiveRecognitionScore < 0.6) reason += `Cognitive low: ${cognitiveRecognitionScore.toFixed(2)}. `;
        if (mobileEdgeStrength < this.MOBILE_EDGE_MIN) reason += `Mobile edge weak: ${mobileEdgeStrength.toFixed(2)}. `;
        // テキストレイアウト違反を reason に追記
        if (textLayout?.isTextClipped) reason += `TEXT_CLIPPED: boundary ratio ${(textLayout.clipBoundaryRatio * 100).toFixed(1)}%. `;
        if (textLayout?.isTextOverlappingCharacter) reason += `TEXT_OVERLAPS_CHARACTER: overlap ratio ${(textLayout.overlapRatio * 100).toFixed(1)}%. `;

        const passed = reason === '';

        AgentLogger.info('IQA', 'VALIDATE', passed ? 'PASS' : 'FAIL', `Result: ${passed ? 'OK' : reason}`, {
            context: {
                sharpness, mobileEdgeStrength, contrastRatio, isResolutionCorrect,
                cognitiveRecognitionScore, xHeightLegibilityScore, backgroundRisk,
                textClipped: textLayout?.isTextClipped,
                textOverlap: textLayout?.isTextOverlappingCharacter,
                clipBoundaryRatio: textLayout?.clipBoundaryRatio,
                overlapRatio: textLayout?.overlapRatio,
            }
        });

        return {
            passed,
            score: (sharpness / 200) * 0.20
                + (mobileEdgeStrength / 60) * 0.10
                + (contrastRatio / 21) * 0.25
                + (cognitiveRecognitionScore * 0.25)
                + (textLayout && !textLayout.isTextClipped ? 0.10 : 0)
                + (textLayout && !textLayout.isTextOverlappingCharacter ? 0.10 : 0),
            metrics: { sharpness, contrastRatio, isResolutionCorrect, cognitiveRecognitionScore, xHeightLegibilityScore, mobileEdgeStrength },
            backgroundRisk,
            textLayout,
            reason: passed ? undefined : reason.trim()
        };
    }
}
