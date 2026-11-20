import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import {
	BENCHMARK_VERSION,
	type BenchmarkProduct,
	CHANNEL_JUDGE_RUBRICS,
	CompareJudgeVerdictSchema,
	extractBlindArtifactText,
	SingleJudgeVerdictSchema,
} from "../domain/benchmark/evaluators.js";
import { AGY_JUDGE_MODEL, invokeAgyStructured } from "../io/agy.js";
import { ROOT } from "../io/core.js";

const BUCKET_BY_PRODUCT: Record<BenchmarkProduct, string> = {
	byosan: "byosan_money",
	yawa: "yawa_archive",
	humanity: "humanity_observatory",
};

function resolveRunDir(product: BenchmarkProduct, runName: string): string {
	const cleaned = runName.replace(`${BUCKET_BY_PRODUCT[product]}/`, "");
	const dir = path.join(ROOT, "runs", BUCKET_BY_PRODUCT[product], cleaned);
	if (!fs.existsSync(dir)) {
		throw new Error(`Run directory not found: ${dir}`);
	}
	return dir;
}

function formatRubrics(product: BenchmarkProduct): string {
	return CHANNEL_JUDGE_RUBRICS[product]
		.map((r) => `- ${r.id}: ${r.question}`)
		.join("\n");
}

function runSingleJudge(
	product: BenchmarkProduct,
	runName: string,
	judgeModel: string,
) {
	const runDir = resolveRunDir(product, runName);
	const artifactText = extractBlindArtifactText(product, runDir);
	const prompt = [
		`あなたは制作チームから独立した品質評価ジャッジです（対象チャンネル種別: ${product}）。`,
		"候補の由来・モデル名・制作者の自己採点は与えられません。提示されたテキストだけから厳格に判定してください。",
		"各評価項目について、必ず根拠（rationale）を先に書いてから二値（pass: true/false）を判定してください。文章の長さや丁寧さだけで合格にしないでください。",
		"なお、音声・歌唱・映像の実視聴は含まれていないため、テキストから観察できる範囲のみを判定してください。",
		"",
		"## 評価基準（二値ルーブリック）",
		formatRubrics(product),
		"",
		"## 評価対象（ブラインド候補）",
		artifactText,
	].join("\n");

	const { value, receipt } = invokeAgyStructured({
		name: `benchmark-judge-single-${product}`,
		prompt,
		schema: SingleJudgeVerdictSchema,
		model: judgeModel,
	});

	const allPassed = value.criteria.every((c) => c.pass);
	return {
		benchmark_version: BENCHMARK_VERSION,
		mode: "single",
		product,
		run_id: `${BUCKET_BY_PRODUCT[product]}/${path.basename(runDir)}`,
		judge_model: receipt.model,
		conversation_id: receipt.conversation_id ?? null,
		calibration_status: "UNCALIBRATED",
		perceptual_media_status: "UNVERIFIED",
		all_criteria_passed: allPassed,
		verdict: value,
	};
}

function runCompareJudge(
	product: BenchmarkProduct,
	baselineRun: string,
	candidateRun: string,
	judgeModel: string,
) {
	const baselineDir = resolveRunDir(product, baselineRun);
	const candidateDir = resolveRunDir(product, candidateRun);
	const baselineText = extractBlindArtifactText(product, baselineDir);
	const candidateText = extractBlindArtifactText(product, candidateDir);

	// Deterministic blind coin flip based on hash of run names so neither side is always "A"
	const digest = crypto
		.createHash("sha256")
		.update(`${product}:${baselineRun}:${candidateRun}`)
		.digest();
	const flip = (digest[0] ?? 0) % 2 === 1;
	const slotA = flip
		? { label: "candidate" as const, text: candidateText }
		: { label: "baseline" as const, text: baselineText };
	const slotB = flip
		? { label: "baseline" as const, text: baselineText }
		: { label: "candidate" as const, text: candidateText };

	const prompt = [
		`あなたは制作チームから独立したブラインド比較ジャッジです（対象チャンネル種別: ${product}）。`,
		"候補Aと候補Bのどちらが旧版か新版かは隠されています。各項目について必ず根拠（rationale）を先に記述してから、優れている方（A / B / TIE）を判定してください。",
		"文章の単なる長さではなく、視聴者にとっての具体性・新規性・方針適合性で判定してください。",
		"",
		"## 比較基準",
		formatRubrics(product),
		"",
		"## 候補 A",
		slotA.text,
		"",
		"## 候補 B",
		slotB.text,
	].join("\n");

	const { value, receipt } = invokeAgyStructured({
		name: `benchmark-judge-compare-${product}`,
		prompt,
		schema: CompareJudgeVerdictSchema,
		model: judgeModel,
	});

	const decode = (pick: "A" | "B" | "TIE") => {
		if (pick === "TIE") return "TIE";
		return pick === "A" ? slotA.label : slotB.label;
	};

	return {
		benchmark_version: BENCHMARK_VERSION,
		mode: "compare",
		product,
		baseline_run_id: `${BUCKET_BY_PRODUCT[product]}/${path.basename(baselineDir)}`,
		candidate_run_id: `${BUCKET_BY_PRODUCT[product]}/${path.basename(candidateDir)}`,
		blind_mapping: { A: slotA.label, B: slotB.label },
		judge_model: receipt.model,
		conversation_id: receipt.conversation_id ?? null,
		calibration_status: "UNCALIBRATED",
		perceptual_media_status: "UNVERIFIED",
		decoded_overall_winner: decode(value.overall_preferred),
		decoded_criteria: value.criteria_comparison.map((c) => ({
			criterion_id: c.criterion_id,
			winner: decode(c.preferred),
			rationale: c.rationale,
		})),
		overall_rationale: value.overall_rationale,
	};
}

function main() {
	const args = process.argv.slice(2);
	let judgeModel = AGY_JUDGE_MODEL;
	const positional: string[] = [];
	for (const arg of args) {
		if (arg.startsWith("--model=")) {
			judgeModel = arg.slice("--model=".length);
		} else {
			positional.push(arg);
		}
	}

	const [mode, productRaw, firstRun, secondRun] = positional;
	const product = productRaw as BenchmarkProduct | undefined;
	if (
		!mode ||
		!product ||
		!["byosan", "yawa", "humanity"].includes(product) ||
		!firstRun ||
		(mode === "compare" && !secondRun) ||
		!["single", "compare"].includes(mode)
	) {
		console.error(
			"usage:\n  benchmark_judge.ts single <byosan|yawa|humanity> <run-name> [--model=gemini-4-argon-high]\n  benchmark_judge.ts compare <byosan|yawa|humanity> <baseline-run> <candidate-run> [--model=gemini-4-argon-high]",
		);
		process.exit(2);
	}

	const report =
		mode === "single"
			? runSingleJudge(product, firstRun, judgeModel)
			: runCompareJudge(product, firstRun, secondRun ?? "", judgeModel);
	console.log(JSON.stringify(report, null, 2));
}

main();
