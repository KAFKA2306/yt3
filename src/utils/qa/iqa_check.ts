/**
 * IQA バッチ審査スクリプト
 *
 * 使用方法:
 *   npx tsx scripts/iqa_batch_check.ts [--run-id <id>]
 *   npx tsx scripts/iqa_batch_check.ts --palette-audit
 */

import path from "node:path";
import fs from "fs-extra";
import { glob } from "glob";
import { loadConfig } from "../../core.js";
import {
	type BackgroundRisk,
	IQA_THRESHOLDS,
	IqaValidator,
} from "../../utils/iqa_validator.js";

const cfg = loadConfig();
const thumbCfg = cfg.steps.thumbnail;
const validator = new IqaValidator();

const COLORS = {
	reset: "\x1b[0m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
};

interface BatchResult {
	imagePath: string;
	runId: string;
	passed: boolean;
	score: number;
	sharpness: number;
	contrastRatio: number;
	mobileEdgeStrength: number;
	isResolutionCorrect: boolean;
	backgroundRisk: BackgroundRisk;
	textClipped?: boolean;
	textOverlap?: boolean;
	failReasons: string[];
}

function extractRunId(imagePath: string): string {
	const parts = imagePath.split(path.sep);
	const i = parts.findIndex((p) => p === "runs");
	const runId = i >= 0 && parts[i + 1] ? parts[i + 1] : "unknown";
	return runId as string;
}

async function auditImage(imagePath: string): Promise<BatchResult> {
	const runId = extractRunId(imagePath);
	const failReasons: string[] = [];
	const palette = thumbCfg.palettes[0];
	if (!palette) throw new Error("No palette found");
	const textHex = palette.title_color;
	const bgHex = palette.background_color;
	const guardBand = thumbCfg.right_guard_band_px ?? 850;

	if (!fs.existsSync(imagePath) || fs.statSync(imagePath).size === 0) {
		return {
			imagePath,
			runId,
			passed: false,
			score: 0,
			sharpness: 0,
			contrastRatio: 0,
			mobileEdgeStrength: 0,
			isResolutionCorrect: false,
			backgroundRisk: "low",
			failReasons: ["FILE_NOT_FOUND_OR_EMPTY"],
		};
	}

	const result = await validator.validate(
		imagePath,
		textHex,
		bgHex,
		undefined,
		guardBand,
	);
	const m = result.metrics;

	if (!m.isResolutionCorrect) failReasons.push("RESOLUTION_MISMATCH");
	if (m.sharpness < IQA_THRESHOLDS.SHARPNESS_MIN)
		failReasons.push(`SHARPNESS_LOW: ${m.sharpness.toFixed(2)}`);
	if (m.contrastRatio < IQA_THRESHOLDS.CONTRAST_MIN)
		failReasons.push(`CONTRAST_LOW: ${m.contrastRatio.toFixed(2)}`);
	if ((m.mobileEdgeStrength ?? 0) < IQA_THRESHOLDS.MOBILE_EDGE_MIN)
		failReasons.push(`MOBILE_EDGE_WEAK: ${m.mobileEdgeStrength?.toFixed(2)}`);
	if (result.textLayout?.isTextClipped)
		failReasons.push(
			`TEXT_CLIPPED: ${(result.textLayout.clipBoundaryRatio * 100).toFixed(1)}%`,
		);
	if (result.textLayout?.isTextOverlappingCharacter)
		failReasons.push(
			`TEXT_OVERLAPS_CHARACTER: ${(result.textLayout.overlapRatio * 100).toFixed(1)}%`,
		);

	const edgeStrength = m.mobileEdgeStrength ?? 0;
	const score =
		(m.isResolutionCorrect ? 0.1 : 0) +
		Math.min(m.sharpness / 200, 1) * 0.3 +
		Math.min(m.contrastRatio / 21, 1) * 0.3 +
		m.cognitiveRecognitionScore * 0.2 +
		Math.min(edgeStrength / 60, 1) * 0.1;

	return {
		imagePath,
		runId,
		passed: failReasons.length === 0,
		score,
		sharpness: m.sharpness,
		contrastRatio: m.contrastRatio,
		mobileEdgeStrength: edgeStrength,
		isResolutionCorrect: m.isResolutionCorrect,
		backgroundRisk: result.backgroundRisk ?? "low",
		textClipped: result.textLayout?.isTextClipped,
		textOverlap: result.textLayout?.isTextOverlappingCharacter,
		failReasons,
	};
}

function printResult(r: BatchResult, index: number, total: number): void {
	const status = r.passed
		? `${COLORS.green}${COLORS.bold}✅ PASS${COLORS.reset}`
		: `${COLORS.red}${COLORS.bold}❌ FAIL${COLORS.reset}`;
	const shortPath = r.imagePath.replace(`${process.cwd()}/`, "");
	const riskColor =
		r.backgroundRisk === "low"
			? COLORS.green
			: r.backgroundRisk === "medium"
				? COLORS.yellow
				: COLORS.red;
	const textStatus =
		r.textClipped === undefined
			? ""
			: (r.textClipped
					? `${COLORS.red}✗CLIP${COLORS.reset}`
					: `${COLORS.green}✓txt${COLORS.reset}`) +
				(r.textOverlap
					? ` ${COLORS.red}✗OVR${COLORS.reset}`
					: ` ${COLORS.green}✓pos${COLORS.reset}`);

	console.log(
		`\n[${index + 1}/${total}] ${status}  ${COLORS.cyan}${shortPath}${COLORS.reset}`,
	);
	console.log(
		`  ${COLORS.dim}Score:${COLORS.reset} ${(r.score * 100).toFixed(1)}%  ` +
			`Sharp: ${r.sharpness.toFixed(1)}  Contrast: ${r.contrastRatio.toFixed(2)}:1  ` +
			`Mobile: ${r.mobileEdgeStrength.toFixed(1)}  ` +
			`${riskColor}bg:${r.backgroundRisk}${COLORS.reset}  ${textStatus}  ` +
			`${r.isResolutionCorrect ? "✓ 1280×720" : "✗ Wrong Res"}`,
	);
	for (const reason of r.failReasons) {
		console.log(`  ${COLORS.yellow}⚠ ${reason}${COLORS.reset}`);
	}
}

function printSummary(results: BatchResult[]): void {
	const passed = results.filter((r) => r.passed).length;
	const failed = results.length - passed;

	console.log(`\n${"═".repeat(70)}`);
	console.log(`${COLORS.bold}IQA 品質審査レポート${COLORS.reset}`);
	console.log("═".repeat(70));
	console.log(
		`  総数: ${results.length}  合格: ${COLORS.green}${passed}${COLORS.reset}  不合格: ${COLORS.red}${failed}${COLORS.reset}  合格率: ${((passed / results.length) * 100).toFixed(1)}%`,
	);

	if (failed > 0) {
		console.log(`\n${COLORS.red}${COLORS.bold}不合格一覧:${COLORS.reset}`);
		for (const r of results.filter((r) => !r.passed)) {
			console.log(`  ✗ ${r.imagePath.replace(`${process.cwd()}/`, "")}`);
			for (const f of r.failReasons) {
				console.log(`     └─ ${f}`);
			}
		}
	}

	const top5 = [...results].sort((a, b) => b.score - a.score).slice(0, 5);
	console.log(`\n${COLORS.bold}スコア上位 5:${COLORS.reset}`);
	top5.forEach((r, i) =>
		console.log(
			`  ${i + 1}. ${(r.score * 100).toFixed(1)}%  ${r.runId}  (sharp: ${r.sharpness.toFixed(0)}, mobile: ${r.mobileEdgeStrength.toFixed(1)})`,
		),
	);
}

function auditPalettes(): void {
	const palettes = thumbCfg.palettes;
	const ratingOf = (contrast: number, risk: BackgroundRisk) =>
		contrast >= IQA_THRESHOLDS.CONTRAST_GOAL && risk === "low"
			? "✅ BEST"
			: contrast >= 4.5 && risk !== "high"
				? "⚠ OK"
				: "❌ RISKY";

	console.log(
		`\n${COLORS.bold}${COLORS.cyan}パレット監査レポート${COLORS.reset}`,
	);
	console.log("═".repeat(76));
	console.log(
		"  #  背景色       テキスト色    コントラスト  WCAG  リスク    MOBILE予測         評価",
	);
	console.log("─".repeat(76));

	const entries = palettes
		.map((p, i) => {
			const contrast = validator.calculateContrastRatio(
				p.title_color,
				p.background_color,
			);
			const risk = validator.analyzeBackgroundRisk(p.background_color);
			const mobilePred =
				risk === "low"
					? "≥ 35 (安全)"
					: risk === "medium"
						? "~25-35 (限界)"
						: "< 25 (危険)";
			const rating = ratingOf(contrast, risk);
			return { i, p, contrast, risk, mobilePred, rating };
		})
		.sort((a, b) => {
			const order = { "✅ BEST": 0, "⚠ OK": 1, "❌ RISKY": 2 };
			return (
				(order[a.rating as keyof typeof order] ?? 3) -
				(order[b.rating as keyof typeof order] ?? 3)
			);
		});

	for (const { i, p, contrast, risk, mobilePred, rating } of entries) {
		const riskColor =
			risk === "low"
				? COLORS.green
				: risk === "medium"
					? COLORS.yellow
					: COLORS.red;
		const wcag =
			contrast >= 7.0
				? `${COLORS.green}AAA✓${COLORS.reset}`
				: contrast >= 4.5
					? `${COLORS.yellow}AA✓${COLORS.reset}`
					: `${COLORS.red}FAIL${COLORS.reset}`;
		console.log(
			`  ${String(i + 1).padEnd(2)} ${p.background_color.padEnd(13)}${p.title_color.padEnd(13)}` +
				`${(`${contrast.toFixed(2)}:1`).padEnd(13)} ${wcag.padEnd(15)} ` +
				`${riskColor}${risk.padEnd(9)}${COLORS.reset}${mobilePred.padEnd(19)} ${rating}`,
		);
	}

	console.log("─".repeat(76));
	console.log(
		`  推奨: ${entries.filter((e) => e.rating === "✅ BEST").length} パレット  要注意: ${entries.filter((e) => e.rating === "❌ RISKY").length} パレット`,
	);
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (args.includes("--palette-audit")) {
		auditPalettes();
		return;
	}

	const runIdFilter = args.includes("--run-id")
		? args[args.indexOf("--run-id") + 1]
		: null;
	const pattern = runIdFilter
		? `runs/${runIdFilter}/**/thumbnail.png`
		: "runs/**/thumbnail.png";
	const imagePaths = (await glob(pattern, { cwd: process.cwd() })).map((p) =>
		path.join(process.cwd(), p),
	);

	console.log(
		`${COLORS.bold}${COLORS.cyan}IQA バッチ審査  — 対象: ${imagePaths.length} 枚${COLORS.reset}\n${"─".repeat(70)}`,
	);

	const results: BatchResult[] = [];
	for (let i = 0; i < imagePaths.length; i++) {
		const p = imagePaths[i];
		if (!p) continue;
		const result = await auditImage(p);
		results.push(result);
		printResult(result, i, imagePaths.length);
	}

	printSummary(results);

	const aceDir = cfg.workflow.paths.ace_dir || "data/ace";
	const logPath = path.join(process.cwd(), aceDir, "audit.json");
	await fs.ensureDir(path.dirname(logPath));
	await fs.writeJson(
		logPath,
		{
			audit_timestamp: new Date().toISOString(),
			total_images: results.length,
			passed: results.filter((r) => r.passed).length,
			failed: results.filter((r) => !r.passed).length,
			results: results.map((r) => ({
				...r,
				imagePath: r.imagePath.replace(`${process.cwd()}/`, ""),
			})),
		},
		{ spaces: 2 },
	);

	console.log(`\n${COLORS.cyan}📊 監査ログ: ${logPath}${COLORS.reset}`);

	if (results.some((r) => !r.passed)) {
		console.log(
			`\n${COLORS.red}${COLORS.bold}⛔ 不合格あり。生成パイプラインの見直しが必要です。${COLORS.reset}`,
		);
		process.exit(1);
	}
	console.log(
		`\n${COLORS.green}${COLORS.bold}🏆 全サムネイル合格！${COLORS.reset}`,
	);
}

main().catch((err) => {
	console.error("致命的エラー:", err);
	process.exit(1);
});
