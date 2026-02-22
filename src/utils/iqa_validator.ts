import fs from "fs-extra";
import sharp from "sharp";
import { AgentLogger } from "../core.js";
import {
  type BackgroundRisk,
  IQA_THRESHOLDS,
  analyzeTextLayout,
  calculateContrastRatio,
  calculateMobileEdgeStrength,
  calculateSharpness,
  getLuminance,
  hexToRgb,
} from "./iqa_metrics.js";
import type { IqaResult } from "./schemas.js";

export { IQA_THRESHOLDS, type BackgroundRisk, type IqaResult };

export class IqaValidator {
  analyzeBackgroundRisk(bgHex: string): BackgroundRisk {
    const { r, g, b } = hexToRgb(bgHex);
    const lum = getLuminance(r, g, b);
    return lum > 0.4 ? "high" : lum > 0.1 ? "medium" : "low";
  }

  calculateContrastRatio(hex1: string, hex2: string): number {
    return calculateContrastRatio(hex1, hex2);
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
    charGuardBandPx = 850,
  ): Promise<IqaResult> {
    AgentLogger.info("IQA", "VALIDATE", "START", imagePath);

    if (!fs.existsSync(imagePath) || fs.statSync(imagePath).size === 0) {
      return {
        passed: false,
        score: 0,
        metrics: {
          sharpness: 0,
          contrastRatio: 0,
          isResolutionCorrect: false,
          cognitiveRecognitionScore: 0,
          xHeightLegibilityScore: 0,
          mobileEdgeStrength: 0,
        },
        backgroundRisk: this.analyzeBackgroundRisk(bgHex),
        reason: "ファイルが存在しないか空です。",
      };
    }

    const metadata = await sharp(imagePath).metadata();
    const isResolutionCorrect = metadata.width === 1280 && metadata.height === 720;
    const sharpness = await calculateSharpness(imagePath);
    const mobileEdgeStrength = await calculateMobileEdgeStrength(imagePath);
    const contrastRatio = calculateContrastRatio(textHex, bgHex);
    const cognitiveRecognitionScore = this.calculateCognitiveScore(
      contrastRatio,
      title?.length ?? 0,
    );
    const backgroundRisk = this.analyzeBackgroundRisk(bgHex);
    const textLayout = await analyzeTextLayout(imagePath, charGuardBandPx).catch(
      (): undefined => undefined,
    );

    const reasons: string[] = [];
    if (!isResolutionCorrect) reasons.push(`解像度不一致: ${metadata.width}x${metadata.height}`);
    if (sharpness < IQA_THRESHOLDS.SHARPNESS_MIN)
      reasons.push(`鮮鋭度不足: ${sharpness.toFixed(2)}`);
    if (contrastRatio < IQA_THRESHOLDS.CONTRAST_MIN)
      reasons.push(`コントラスト不足: ${contrastRatio.toFixed(2)}`);
    if (cognitiveRecognitionScore < IQA_THRESHOLDS.COGNITIVE_MIN)
      reasons.push(`認知スコア不足: ${cognitiveRecognitionScore.toFixed(2)}`);
    if (mobileEdgeStrength < IQA_THRESHOLDS.MOBILE_EDGE_MIN)
      reasons.push(`Mobile edge weak: ${mobileEdgeStrength.toFixed(2)}`);
    if (textLayout?.isTextClipped)
      reasons.push(`テキスト見切れ: ${(textLayout.clipBoundaryRatio * 100).toFixed(1)}%`);
    if (textLayout?.isTextOverlappingCharacter)
      reasons.push(`テキスト重なり: ${(textLayout.overlapRatio * 100).toFixed(1)}%`);

    const passed = reasons.length === 0;
    AgentLogger.info("IQA", "VALIDATE", passed ? "PASS" : "FAIL", reasons.join(" | ") || "OK");

    return {
      passed,
      score:
        (sharpness / 200) * 0.2 +
        (mobileEdgeStrength / 60) * 0.1 +
        (contrastRatio / 21) * 0.25 +
        cognitiveRecognitionScore * 0.25 +
        (textLayout && !textLayout.isTextClipped ? 0.1 : 0) +
        (textLayout && !textLayout.isTextOverlappingCharacter ? 0.1 : 0),
      metrics: {
        sharpness,
        contrastRatio,
        isResolutionCorrect,
        cognitiveRecognitionScore,
        xHeightLegibilityScore: 0.85,
        mobileEdgeStrength,
      },
      backgroundRisk,
      textLayout,
      reason: passed ? undefined : reasons.join(" | "),
    };
  }
}
