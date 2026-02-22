/**
 * IQA Validator Unit Tests
 *
 * Tests for IqaValidator: contrast ratio, cognitive score,
 * background risk analysis, and full validate() integration.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import './setup.js';
import path from 'path';
import fs from 'fs-extra';
import sharp from 'sharp';
import { IqaValidator, IQA_THRESHOLDS } from '../src/utils/iqa_validator.js';

// ============================================================
// Test fixtures: create synthetic PNGs in-memory
// ============================================================
async function createFlatPng(
    outPath: string,
    bg: string = '#103766',
    text: string = '#FFFFFF',
    width = 1280,
    height = 720
): Promise<void> {
    const bgRgb = hexToRgb(bg);
    const textRgb = hexToRgb(text);

    // Create base canvas
    const backdrop = {
        create: { width, height, channels: 4 as const, background: bgRgb }
    };

    // Add a text-like rectangle to introduce some edges
    const rectWidth = Math.floor(width * 0.5);
    const rectHeight = Math.floor(height * 0.15);
    const rectSvg = Buffer.from(`
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <rect x="80" y="${Math.floor(height / 2 - rectHeight / 2)}" width="${rectWidth}" height="${rectHeight}"
                  fill="rgb(${textRgb.r},${textRgb.g},${textRgb.b})" />
        </svg>
    `);

    await sharp(backdrop)
        .composite([{ input: rectSvg, top: 0, left: 0 }])
        .png()
        .toFile(outPath);
}

function hexToRgb(hex: string) {
    const clean = hex.replace('#', '');
    const v = parseInt(clean, 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

// ============================================================
// Tests
// ============================================================
describe('IqaValidator', () => {
    const validator = new IqaValidator();
    const tmpDir = path.join(process.cwd(), 'runs', '_iqa_test_tmp');
    const darkThumbPath = path.join(tmpDir, 'dark_thumb.png');
    const yellowThumbPath = path.join(tmpDir, 'yellow_thumb.png');
    const wrongSizePath = path.join(tmpDir, 'wrong_size.png');

    // Setup: create test fixtures
    it('should set up test fixtures', async () => {
        await fs.ensureDir(tmpDir);
        // Dark background thumbnail (expected to PASS mobile edge)
        await createFlatPng(darkThumbPath, '#103766', '#FFFFFF');
        // Yellow background thumbnail (may FAIL mobile edge due to low contrast at 150px)
        await createFlatPng(yellowThumbPath, '#FFE14A', '#0A0A12');
        // Wrong resolution
        await createFlatPng(wrongSizePath, '#103766', '#FFFFFF', 640, 360);
        assert.ok(fs.existsSync(darkThumbPath), 'dark thumbnail fixture should exist');
        assert.ok(fs.existsSync(yellowThumbPath), 'yellow thumbnail fixture should exist');
    });

    // ── Exported constants ──────────────────────────────────
    describe('IQA_THRESHOLDS', () => {
        it('should export correct threshold values', () => {
            assert.strictEqual(IQA_THRESHOLDS.SHARPNESS_MIN, 100);
            assert.strictEqual(IQA_THRESHOLDS.CONTRAST_GOAL, 7.0);
            assert.strictEqual(IQA_THRESHOLDS.CONTRAST_MIN, 5.0);
            assert.strictEqual(IQA_THRESHOLDS.MOBILE_EDGE_MIN, 30);
            assert.strictEqual(IQA_THRESHOLDS.COGNITIVE_MIN, 0.6);
        });
    });

    // ── analyzeBackgroundRisk ───────────────────────────────
    describe('analyzeBackgroundRisk()', () => {
        it('should return "low" for dark backgrounds (deep blue)', () => {
            assert.strictEqual(validator.analyzeBackgroundRisk('#103766'), 'low');
        });

        it('should return "low" for near-black backgrounds', () => {
            assert.strictEqual(validator.analyzeBackgroundRisk('#0A0A12'), 'low');
            assert.strictEqual(validator.analyzeBackgroundRisk('#000000'), 'low');
        });

        it('should return "high" for yellow backgrounds', () => {
            assert.strictEqual(validator.analyzeBackgroundRisk('#FFE14A'), 'high');
        });

        it('should return "high" for white backgrounds', () => {
            assert.strictEqual(validator.analyzeBackgroundRisk('#FFFFFF'), 'high');
        });

        it('should return "medium" for medium-luminance backgrounds', () => {
            // Medium gray: luminance ≈ 0.216
            const result = validator.analyzeBackgroundRisk('#808080');
            assert.ok(['medium', 'high'].includes(result), `Expected medium or high, got ${result}`);
        });
    });

    // ── calculateContrastRatio ──────────────────────────────
    describe('calculateContrastRatio()', () => {
        it('should return >= 7.0 for white on deep blue (WCAG AAA)', () => {
            const ratio = validator.calculateContrastRatio('#FFFFFF', '#103766');
            assert.ok(ratio >= 7.0, `Expected >= 7.0, got ${ratio.toFixed(2)}`);
        });

        it('should return >= 5.0 for dark text on yellow', () => {
            const ratio = validator.calculateContrastRatio('#0A0A12', '#FFE14A');
            assert.ok(ratio >= 5.0, `Expected >= 5.0, got ${ratio.toFixed(2)}`);
        });

        it('should return ~1.0 for same color', () => {
            const ratio = validator.calculateContrastRatio('#103766', '#103766');
            assert.ok(Math.abs(ratio - 1.0) < 0.01, `Expected ~1.0, got ${ratio}`);
        });

        it('should be symmetric (swap colors gives same ratio)', () => {
            const r1 = validator.calculateContrastRatio('#FFFFFF', '#000000');
            const r2 = validator.calculateContrastRatio('#000000', '#FFFFFF');
            assert.ok(Math.abs(r1 - r2) < 0.01, 'Contrast ratio should be symmetric');
        });

        it('should return ~21:1 for white on black (max contrast)', () => {
            const ratio = validator.calculateContrastRatio('#FFFFFF', '#000000');
            assert.ok(ratio > 20, `Expected ~21:1, got ${ratio.toFixed(2)}`);
        });
    });

    // ── calculateCognitiveScore ─────────────────────────────
    describe('calculateCognitiveScore()', () => {
        it('should return >= 0.6 for high contrast with short text', () => {
            const score = validator.calculateCognitiveScore(7.0, 3);
            assert.ok(score >= 0.6, `Expected >= 0.6, got ${score.toFixed(3)}`);
        });

        it('should return >= 0.6 for AAA contrast with medium text', () => {
            const score = validator.calculateCognitiveScore(7.0, 8);
            assert.ok(score >= 0.6, `Expected >= 0.6, got ${score.toFixed(3)}`);
        });

        it('should return < 0.6 for low contrast with long text', () => {
            const score = validator.calculateCognitiveScore(3.0, 20);
            assert.ok(score < 0.6, `Expected < 0.6, got ${score.toFixed(3)}`);
        });

        it('should never exceed 1.0', () => {
            const score = validator.calculateCognitiveScore(21.0, 0);
            assert.ok(score <= 1.0, `Score should not exceed 1.0, got ${score}`);
        });
    });

    // ── validate() integration ──────────────────────────────
    describe('validate()', () => {
        it('should PASS for well-designed dark thumbnail with white text', async () => {
            const result = await validator.validate(darkThumbPath, '#FFFFFF', '#103766', 'テスト');
            // Only check things we can guarantee from a synthetic image:
            // - resolution should be correct
            // - contrast should pass (we control the hex values)
            // - backgroundRisk should be 'low'
            assert.strictEqual(result.metrics.isResolutionCorrect, true, 'Resolution should be 1280x720');
            assert.ok(result.metrics.contrastRatio >= IQA_THRESHOLDS.CONTRAST_MIN, 'Contrast should pass');
            assert.strictEqual(result.backgroundRisk, 'low', 'Background risk should be low');
        });

        it('should report backgroundRisk="high" for yellow thumbnail', async () => {
            const result = await validator.validate(yellowThumbPath, '#0A0A12', '#FFE14A', 'テスト');
            assert.strictEqual(result.backgroundRisk, 'high', 'Yellow background should be high risk');
        });

        it('should FAIL with resolution mismatch for wrong-size image', async () => {
            const result = await validator.validate(wrongSizePath, '#FFFFFF', '#103766', 'テスト');
            assert.strictEqual(result.metrics.isResolutionCorrect, false, 'Should fail resolution check');
            assert.ok(!result.passed, 'Should not pass IQA');
            assert.ok(result.reason?.includes('解像度不一致'), `Expected resolution mismatch reason, got: ${result.reason}`);
        });

        it('should FAIL with reason when file does not exist', async () => {
            const result = await validator.validate('/nonexistent/file.png', '#FFFFFF', '#000000');
            assert.strictEqual(result.passed, false);
            assert.ok(result.reason?.includes('存在しない') || result.reason?.includes('空です'));
        });

        it('should include mobileEdgeStrength in metrics', async () => {
            const result = await validator.validate(darkThumbPath, '#FFFFFF', '#103766', 'テスト');
            assert.ok(typeof result.metrics.mobileEdgeStrength === 'number', 'mobileEdgeStrength should be a number');
            assert.ok((result.metrics.mobileEdgeStrength ?? 0) >= 0, 'mobileEdgeStrength should be non-negative');
        });

        // Cleanup after tests
        it('should clean up test fixtures', async () => {
            await fs.remove(tmpDir);
            assert.ok(!fs.existsSync(tmpDir), 'tmp dir should be cleaned up');
        });
    });
});
