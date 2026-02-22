/**
 * IQA Batch Check - 全サムネイル破壊的品質審査
 * Visual Automation Workflow v2 - Programmatic IQA
 *
 * Usage:
 *   npx tsx scripts/iqa_batch_check.ts [--run-id <id>]
 *   npx tsx scripts/iqa_batch_check.ts --palette-audit
 */

import sharp from 'sharp';
import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';
import { IqaValidator, IQA_THRESHOLDS, BackgroundRisk } from '../src/utils/iqa_validator.js';

const iqaValidator = new IqaValidator();

// ============================================================
// 型定義
// ============================================================
interface IqaMetrics {
    sharpness: number;
    contrastRatio: number;
    isResolutionCorrect: boolean;
    cognitiveRecognitionScore: number;
    mobileEdgeStrength: number;
    colorSpace: string | undefined;
    backgroundRisk: BackgroundRisk;
}

interface IqaResult {
    imagePath: string;
    runId: string;
    passed: boolean;
    score: number;
    metrics: IqaMetrics;
    failReasons: string[];
    textClipped?: boolean;
    textOverlap?: boolean;
    clipBoundaryRatio?: number;
    overlapRatio?: number;
}

interface AuditLog {
    audit_timestamp: string;
    total_images: number;
    passed: number;
    failed: number;
    pass_rate: string;
    results: IqaResult[];
    design_token_check: DesignTokenCheck;
}

interface DesignTokenCheck {
    base_color: string;
    accent_color: string;
    contrast_ratio: number;
    contrast_passes_wcag_aaa: boolean;
    contrast_passes_wcag_aa: boolean;
    recommendation: string;
}

// ============================================================
// 閾値定義
// ============================================================
const THRESHOLDS = {
    SHARPNESS_MIN: IQA_THRESHOLDS.SHARPNESS_MIN,
    CONTRAST_GOAL: IQA_THRESHOLDS.CONTRAST_GOAL,
    CONTRAST_MIN: IQA_THRESHOLDS.CONTRAST_MIN,
    COGNITIVE_MIN: IQA_THRESHOLDS.COGNITIVE_MIN,
    MOBILE_EDGE_MIN: IQA_THRESHOLDS.MOBILE_EDGE_MIN,
    TARGET_WIDTH: 1280,
    TARGET_HEIGHT: 720,
};

// デザイントークン (config/default.yaml より)
const DESIGN_TOKENS = {
    primary: '#103766',
    accent: '#288CFA',
    text: '#FFFFFF',
};

// ============================================================
// ユーティリティ関数
// ============================================================
function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const clean = hex.replace('#', '');
    const bigint = parseInt(clean, 16);
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

function getLuminance(r: number, g: number, b: number): number {
    const [rs, gs, bs] = [r, g, b].map(c => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function calculateContrastRatio(hex1: string, hex2: string): number {
    const rgb1 = hexToRgb(hex1);
    const rgb2 = hexToRgb(hex2);
    const l1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
    const l2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Variance of Laplacian (VoL) - 修正版
 *
 * sharp.convolve() は uint8 クリッピングされるため、負の値が全て0になる。
 * 代わりに差分フィルタ（水平・垂直derivative）の2乗和の平均を鮮鋭度指標として使用。
 * これはエッジ強度の代理指標であり、ぼけた画像ほど低い値を返す。
 *
 * 実装: Sobel-like gradient magnitude (unsigned, 0-255 friendly)
 *   - Gx = pixel(x+1) - pixel(x-1)  (horizontal difference)
 *   but via convolve with kernel [-1, 0, 1] (clipped to 0 when negative...)
 *
 * 実用的な代替案: sharp の .stats() の stdev を鮮鋭度の代理として使用。
 * ただし直接の鮮鋭度ではなく輝度分布。
 *
 * 最終的な正確な実装: チャンネルごとの隣接ピクセル差の2乗平均（inline計算）
 */
async function calculateSharpness(imagePath: string): Promise<number> {
    // グレースケールで raw ピクセルを取得
    const { data, info } = await sharp(imagePath)
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const { width, height } = info;
    const pixels = new Float64Array(data);

    // Variance of Laplacian を手動計算
    // Laplacian = center - mean(neighbors) → 符号付きで計算
    let sumLap = 0;
    let sumLapSq = 0;
    let count = 0;

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            const center = pixels[idx];
            // 4-connected neighbors
            const lap = center * 4
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
    return (sumLapSq / count) - (mean * mean); // Variance of Laplacian
}

/**
 * モバイル画面 (150px) でのエッジ強度
 * 同様に手動ピクセル計算
 */
async function calculateMobileEdgeStrength(imagePath: string): Promise<number> {
    const { data, info } = await sharp(imagePath)
        .resize(150)
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const { width, height } = info;
    const pixels = new Float64Array(data);

    // Mean absolute gradient (Sobel-like)
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

function calculateCognitiveScore(contrastRatio: number): number {
    // コントラストを主要因子として0-1スコア
    const contrastFactor = Math.min(contrastRatio / THRESHOLDS.CONTRAST_GOAL, 1.0);
    return contrastFactor * 0.7 + 0.3; // ベース0.3
}

// ============================================================
// パレット監査
// ============================================================
interface PaletteAuditEntry {
    index: number;
    background_color: string;
    title_color: string;
    contrastRatio: number;
    passesWcagAaa: boolean;
    passesWcagAa: boolean;
    backgroundRisk: BackgroundRisk;
    mobileEdgePrediction: string;
    overallRating: string;
}

function auditPalettes(): void {
    // config/default.yaml のパレット定義を直接参照
    const PALETTES: Array<{ background_color: string; title_color: string }> = [
        { background_color: '#103766', title_color: '#FFFFFF' },
        { background_color: '#FFE14A', title_color: '#0A0A12' },
        { background_color: '#0B0F19', title_color: '#E5FCF4' },
        { background_color: '#0D1D40', title_color: '#FACC15' },
        { background_color: '#0A0F1F', title_color: '#E31C23' },
    ];

    console.log(`\n${COLORS.bold}${COLORS.cyan}パレット監査レポート${COLORS.reset}`);
    console.log('═'.repeat(80));
    console.log(
        `  ${'#'.padEnd(3)}  ${'Background'.padEnd(12)}  ${'Title'.padEnd(12)}` +
        `  ${'Contrast'.padEnd(10)}  ${'WCAG'.padEnd(8)}  ${'BgRisk'.padEnd(8)}  ${'MobileEdge'.padEnd(12)}  Rating`
    );
    console.log('─'.repeat(80));

    const entries: PaletteAuditEntry[] = PALETTES.map((p, i) => {
        const contrast = calculateContrastRatio(p.title_color, p.background_color);
        const bgRisk = iqaValidator.analyzeBackgroundRisk(p.background_color);
        const mobileEdgePrediction = bgRisk === 'low' ? '≥ 35 (Safe)' : bgRisk === 'medium' ? '~25-35 (Marginal)' : '< 25 (RISKY)';
        const passesAAA = contrast >= 7.0;
        const passesAA = contrast >= 4.5;
        const overallRating = (passesAAA && bgRisk === 'low') ? '✅ BEST'
            : (passesAA && bgRisk !== 'high') ? '⚠ OK'
                : '❌ RISKY';
        return { index: i, ...p, contrastRatio: contrast, passesWcagAaa: passesAAA, passesWcagAa: passesAA, backgroundRisk: bgRisk, mobileEdgePrediction, overallRating };
    });

    entries.sort((a, b) => {
        const ratingOrder = { '✅ BEST': 0, '⚠ OK': 1, '❌ RISKY': 2 };
        return (ratingOrder[a.overallRating as keyof typeof ratingOrder] ?? 3) -
            (ratingOrder[b.overallRating as keyof typeof ratingOrder] ?? 3);
    });

    for (const e of entries) {
        const riskColor = e.backgroundRisk === 'low' ? COLORS.green : e.backgroundRisk === 'medium' ? COLORS.yellow : COLORS.red;
        console.log(
            `  ${String(e.index + 1).padEnd(3)}` +
            `  ${e.background_color.padEnd(12)}` +
            `  ${e.title_color.padEnd(12)}` +
            `  ${(e.contrastRatio.toFixed(2) + ':1').padEnd(10)}` +
            `  ${e.passesWcagAaa ? COLORS.green + 'AAA ✓' + COLORS.reset : e.passesWcagAa ? COLORS.yellow + 'AA  ✓' + COLORS.reset : COLORS.red + 'FAIL' + COLORS.reset}`.padEnd(8 + 10) +
            `  ${riskColor}${e.backgroundRisk.padEnd(8)}${COLORS.reset}` +
            `  ${e.mobileEdgePrediction.padEnd(18)}` +
            `  ${e.overallRating}`
        );
    }

    console.log('─'.repeat(80));
    const bestCount = entries.filter(e => e.overallRating === '✅ BEST').length;
    const riskyCount = entries.filter(e => e.overallRating === '❌ RISKY').length;
    console.log(`\n  推奨: ${bestCount} パレット、要注意: ${riskyCount} パレット`);
    console.log(`\n  ${COLORS.dim}ThumbnailRenderer は selectBestPalette() で自動的に最良パレットを選択します。${COLORS.reset}`);
}

function extractRunId(imagePath: string): string {
    const parts = imagePath.split(path.sep);
    const runsIdx = parts.findIndex(p => p === 'runs');
    return runsIdx >= 0 && parts[runsIdx + 1] ? parts[runsIdx + 1] : 'unknown';
}

// ============================================================
// 単一画像のIQA実行
// ============================================================
async function runIqa(imagePath: string): Promise<IqaResult> {
    const runId = extractRunId(imagePath);
    const failReasons: string[] = [];

    if (!fs.existsSync(imagePath) || fs.statSync(imagePath).size === 0) {
        return {
            imagePath, runId, passed: false, score: 0,
            metrics: { sharpness: 0, contrastRatio: 0, isResolutionCorrect: false, cognitiveRecognitionScore: 0, mobileEdgeStrength: 0, colorSpace: undefined, backgroundRisk: 'low' as BackgroundRisk },
            failReasons: ['FILE_NOT_FOUND_OR_EMPTY']
        };
    }

    // メタデータ確認
    const metadata = await sharp(imagePath).metadata();
    const isResolutionCorrect = metadata.width === THRESHOLDS.TARGET_WIDTH && metadata.height === THRESHOLDS.TARGET_HEIGHT;
    const colorSpace = metadata.space;
    const backgroundRisk: BackgroundRisk = iqaValidator.analyzeBackgroundRisk(DESIGN_TOKENS.primary);

    if (!isResolutionCorrect) {
        failReasons.push(`RESOLUTION_MISMATCH: ${metadata.width}x${metadata.height} (expected ${THRESHOLDS.TARGET_WIDTH}x${THRESHOLDS.TARGET_HEIGHT})`);
    }

    // 鮮鋭度 (手動 VoL)
    let sharpness = 0;
    try {
        sharpness = await calculateSharpness(imagePath);
        if (sharpness < THRESHOLDS.SHARPNESS_MIN) {
            failReasons.push(`SHARPNESS_LOW: ${sharpness.toFixed(2)} (min: ${THRESHOLDS.SHARPNESS_MIN})`);
        }
    } catch (e) {
        failReasons.push(`SHARPNESS_ERROR: ${e}`);
    }

    // コントラスト比
    const contrastRatio = calculateContrastRatio(DESIGN_TOKENS.text, DESIGN_TOKENS.primary);
    if (contrastRatio < THRESHOLDS.CONTRAST_MIN) {
        failReasons.push(`CONTRAST_LOW: ${contrastRatio.toFixed(2)} (min: ${THRESHOLDS.CONTRAST_MIN})`);
    }

    // 認知スコア
    const cognitiveRecognitionScore = calculateCognitiveScore(contrastRatio);
    if (cognitiveRecognitionScore < THRESHOLDS.COGNITIVE_MIN) {
        failReasons.push(`COGNITIVE_LOW: ${cognitiveRecognitionScore.toFixed(2)} (min: ${THRESHOLDS.COGNITIVE_MIN})`);
    }

    // モバイルエッジ強度
    let mobileEdgeStrength = 0;
    try {
        mobileEdgeStrength = await calculateMobileEdgeStrength(imagePath);
        if (mobileEdgeStrength < THRESHOLDS.MOBILE_EDGE_MIN) {
            failReasons.push(`MOBILE_EDGE_WEAK: ${mobileEdgeStrength.toFixed(2)} (min: ${THRESHOLDS.MOBILE_EDGE_MIN})`);
        }
    } catch (e) {
        failReasons.push(`MOBILE_EDGE_ERROR: ${e}`);
    }

    // テキストレイアウト分析 (見切れ・重なり)
    let textClipped: boolean | undefined;
    let textOverlap: boolean | undefined;
    let clipBoundaryRatio: number | undefined;
    let overlapRatio: number | undefined;
    try {
        const layout = await iqaValidator.analyzeTextLayout(imagePath);
        textClipped = layout.isTextClipped;
        textOverlap = layout.isTextOverlappingCharacter;
        clipBoundaryRatio = layout.clipBoundaryRatio;
        overlapRatio = layout.overlapRatio;
        if (layout.isTextClipped) {
            failReasons.push(`TEXT_CLIPPED: boundary ratio ${(layout.clipBoundaryRatio * 100).toFixed(1)}%`);
        }
        if (layout.isTextOverlappingCharacter) {
            failReasons.push(`TEXT_OVERLAPS_CHARACTER: overlap ratio ${(layout.overlapRatio * 100).toFixed(1)}%`);
        }
    } catch (e) {
        failReasons.push(`TEXT_LAYOUT_ERROR: ${e}`);
    }

    const passed = failReasons.length === 0;
    const score =
        (isResolutionCorrect ? 0.1 : 0) +
        Math.min(sharpness / 200, 1) * 0.3 +
        Math.min(contrastRatio / 21, 1) * 0.3 +
        cognitiveRecognitionScore * 0.2 +
        Math.min(mobileEdgeStrength / 60, 1) * 0.1;

    return {
        imagePath, runId, passed, score,
        metrics: { sharpness, contrastRatio, isResolutionCorrect, cognitiveRecognitionScore, mobileEdgeStrength, colorSpace, backgroundRisk },
        failReasons,
        textClipped, textOverlap, clipBoundaryRatio, overlapRatio,
    };
}

// ============================================================
// カラフルなコンソール出力
// ============================================================
const COLORS = {
    reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
    yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', dim: '\x1b[2m',
};

function printResult(r: IqaResult, index: number, total: number): void {
    const status = r.passed
        ? `${COLORS.green}${COLORS.bold}✅ PASS${COLORS.reset}`
        : `${COLORS.red}${COLORS.bold}❌ FAIL${COLORS.reset}`;
    const shortPath = r.imagePath.replace(process.cwd() + '/', '');
    const score = (r.score * 100).toFixed(1);
    const m = r.metrics;

    const riskColor = m.backgroundRisk === 'low' ? COLORS.green : m.backgroundRisk === 'medium' ? COLORS.yellow : COLORS.red;
    const riskLabel = `${riskColor}bg:${m.backgroundRisk}${COLORS.reset}`;
    const textStatus = r.textClipped === undefined ? ''
        : (r.textClipped ? `${COLORS.red}✗CLIP${COLORS.reset}` : `${COLORS.green}✓txt${COLORS.reset}`) +
        (r.textOverlap ? ` ${COLORS.red}✗OVR${COLORS.reset}` : ` ${COLORS.green}✓pos${COLORS.reset}`);
    console.log(`\n[${index + 1}/${total}] ${status}  ${COLORS.cyan}${shortPath}${COLORS.reset}`);
    console.log(
        `  ${COLORS.dim}Score:${COLORS.reset} ${score}%  ` +
        `Sharp: ${m.sharpness.toFixed(1)}  ` +
        `Contrast: ${m.contrastRatio.toFixed(2)}:1  ` +
        `Mobile: ${m.mobileEdgeStrength.toFixed(1)}  ` +
        `${riskLabel}  ` +
        `${textStatus}  ` +
        `${m.isResolutionCorrect ? '✓ 1280×720' : '✗ Wrong Res'}`
    );
    if (!r.passed) {
        r.failReasons.forEach(reason => {
            console.log(`  ${COLORS.yellow}⚠ ${reason}${COLORS.reset}`);
        });
    }
}

function printSummary(results: IqaResult[]): void {
    const passed = results.filter(r => r.passed).length;
    const failed = results.length - passed;
    const passRate = ((passed / results.length) * 100).toFixed(1);

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`${COLORS.bold}IQA 品質審査レポート${COLORS.reset}`);
    console.log('═'.repeat(70));
    console.log(`  総数     : ${results.length} 画像`);
    console.log(`  合格     : ${COLORS.green}${passed}${COLORS.reset}`);
    console.log(`  不合格   : ${COLORS.red}${failed}${COLORS.reset}`);
    console.log(`  合格率   : ${passed === results.length ? COLORS.green : COLORS.yellow}${passRate}%${COLORS.reset}`);

    if (failed > 0) {
        console.log(`\n${COLORS.red}${COLORS.bold}不合格サムネイル一覧:${COLORS.reset}`);
        results.filter(r => !r.passed).forEach(r => {
            const shortPath = r.imagePath.replace(process.cwd() + '/', '');
            console.log(`  ${COLORS.red}✗${COLORS.reset} ${shortPath}`);
            r.failReasons.forEach(f => console.log(`     └─ ${f}`));
        });
    }

    // スコア上位
    const sorted = [...results].sort((a, b) => b.score - a.score);
    console.log(`\n${COLORS.bold}スコア上位 5:${COLORS.reset}`);
    sorted.slice(0, 5).forEach((r, i) => {
        console.log(
            `  ${i + 1}. ${(r.score * 100).toFixed(1)}%  ${r.runId}` +
            `  (sharp: ${r.metrics.sharpness.toFixed(0)}, mobile: ${r.metrics.mobileEdgeStrength.toFixed(1)})`
        );
    });
}

// ============================================================
// デザイントークン検証
// ============================================================
function checkDesignTokens(): DesignTokenCheck {
    const ratio = calculateContrastRatio(DESIGN_TOKENS.text, DESIGN_TOKENS.primary);
    const passesAAA = ratio >= 7.0;
    const passesAA = ratio >= 4.5;
    return {
        base_color: DESIGN_TOKENS.primary,
        accent_color: DESIGN_TOKENS.accent,
        contrast_ratio: parseFloat(ratio.toFixed(2)),
        contrast_passes_wcag_aaa: passesAAA,
        contrast_passes_wcag_aa: passesAA,
        recommendation: passesAAA
            ? 'Design tokens meet WCAG AAA (7:1). ✅'
            : passesAA
                ? 'Design tokens meet WCAG AA but not AAA. Darken background for AAA.'
                : 'CRITICAL: Design tokens do NOT meet WCAG AA minimum. Patch required.',
    };
}

// ============================================================
// メイン
// ============================================================
async function main() {
    const args = process.argv.slice(2);

    // パレット監査モード
    if (args.includes('--palette-audit')) {
        console.log(`${COLORS.bold}${COLORS.cyan}`);
        console.log('╔════════════════════════════════════════════════════════════╗');
        console.log('║         IQA PALETTE AUDIT  - パレット品質評価              ║');
        console.log('╚════════════════════════════════════════════════════════════╝');
        console.log(COLORS.reset);
        auditPalettes();
        return;
    }

    const runIdFilter = args.includes('--run-id') ? args[args.indexOf('--run-id') + 1] : null;

    console.log(`${COLORS.bold}${COLORS.cyan}`);
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║         IQA BATCH CHECK  - 破壊的品質審査システム         ║');
    console.log('║         Visual Automation v2  2026 Financial Protocol      ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(COLORS.reset);

    // デザイントークン
    const tokenCheck = checkDesignTokens();
    console.log(`\n${COLORS.bold}デザイントークン検証:${COLORS.reset}`);
    console.log(`  Base  : ${tokenCheck.base_color}  Accent: ${tokenCheck.accent_color}`);
    console.log(
        `  コントラスト比: ${tokenCheck.contrast_ratio}:1  ` +
        `${tokenCheck.contrast_passes_wcag_aaa ? COLORS.green + '✅ WCAG AAA' : COLORS.yellow + '⚠ not AAA'}${COLORS.reset}`
    );
    console.log(`  ${COLORS.dim}${tokenCheck.recommendation}${COLORS.reset}`);

    const pattern = runIdFilter ? `runs/${runIdFilter}/**/thumbnail.png` : 'runs/**/thumbnail.png';
    console.log(`\n${COLORS.bold}サムネイル検索中...${COLORS.reset} (${pattern})`);
    const imagePaths = await glob(pattern, { cwd: process.cwd() });
    const absPaths = imagePaths.map(p => path.join(process.cwd(), p));

    console.log(`${COLORS.bold}対象: ${absPaths.length} 枚${COLORS.reset}\n${'─'.repeat(70)}`);

    const results: IqaResult[] = [];
    for (let i = 0; i < absPaths.length; i++) {
        const result = await runIqa(absPaths[i]);
        results.push(result);
        printResult(result, i, absPaths.length);
    }

    printSummary(results);

    const passed = results.filter(r => r.passed).length;
    const auditLog: AuditLog = {
        audit_timestamp: new Date().toISOString(),
        total_images: results.length,
        passed,
        failed: results.length - passed,
        pass_rate: `${((passed / results.length) * 100).toFixed(1)}%`,
        design_token_check: tokenCheck,
        results: results.map(r => ({
            ...r,
            imagePath: r.imagePath.replace(process.cwd() + '/', ''),
        })),
    };

    const logDir = path.join(process.cwd(), 'logs');
    await fs.ensureDir(logDir);
    const logPath = path.join(logDir, 'visual_quality_audit.json');
    await fs.writeJson(logPath, auditLog, { spaces: 2 });
    console.log(`\n${COLORS.cyan}📊 監査ログ: ${logPath}${COLORS.reset}`);

    if (results.some(r => !r.passed)) {
        console.log(`\n${COLORS.red}${COLORS.bold}⛔ 不合格あり。生成パイプラインの見直しが必要です。${COLORS.reset}`);
    } else {
        console.log(`\n${COLORS.green}${COLORS.bold}🏆 全サムネイル合格！${COLORS.reset}`);
    }
}

main().catch(err => {
    console.error('FATAL IQA ERROR:', err);
    process.exit(1);
});
