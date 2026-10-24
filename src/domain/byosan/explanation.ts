import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { ROOT } from "../../io/core.js";

export type ExplainConfig = {
	schema: string;
	verify_schema: string;
	verify_prompt: string;
	sandbox: string;
	max_chars_per_sentence: number;
	banned_conclusion_phrases: string[];
	prompt: string;
};

export const ExplanationSchema = z.object({
	conclusion: z.string().min(1),
	principle: z.string().min(1),
	figures: z
		.array(
			z.object({
				metric: z.string().min(1),
				population: z.string().min(1),
				period: z.string().min(1),
				unit: z.string().min(1),
				value: z.string().min(1),
				quote: z.string().min(1),
				kind: z.enum(["actual", "estimate", "forecast"]),
			}),
		)
		.min(2),
	check: z.string().min(1),
});

export type Explanation = z.infer<typeof ExplanationSchema>;

export function auditExplanation(
	explanation: Explanation,
	evidence: string,
	maxChars: number,
	bannedPhrases: string[],
): string[] {
	const issues = explanation.figures
		.filter(
			(figure) =>
				!evidence.includes(figure.quote) ||
				!figure.quote.includes(figure.value),
		)
		.map((figure) => `figure_not_grounded: ${figure.value}`);
	for (const phrase of bannedPhrases) {
		if (explanation.conclusion.includes(phrase)) {
			issues.push(`hedged_conclusion: ${phrase}`);
		}
	}
	for (const key of ["conclusion", "principle", "check"] as const) {
		if (/&(amp|lt|gt);/.test(explanation[key])) {
			issues.push(`html_entity: ${key}`);
		}
		for (const sentence of explanation[key].split(/[。.]/)) {
			if (sentence.length > maxChars) {
				issues.push(`sentence_too_long: ${key} ${sentence.length}`);
			}
		}
	}
	return issues;
}

function codexJson<T>(
	cfg: ExplainConfig,
	schema: string,
	input: string,
	out: string,
): T {
	fs.ensureDirSync(path.dirname(out));
	const result = spawnSync(
		"codex",
		[
			"exec",
			"--sandbox",
			cfg.sandbox,
			"--ephemeral",
			"--skip-git-repo-check",
			"--ignore-user-config",
			"--output-schema",
			path.join(ROOT, schema),
			"-o",
			out,
			"-",
		],
		{ input, encoding: "utf8" },
	);
	if (result.status !== 0) {
		throw new Error(
			`CODEX_EXEC_FAILED status=${result.status} ${result.stderr.slice(-400)}`,
		);
	}
	return fs.readJsonSync(out) as T;
}

export function runCodexExplanation(
	cfg: ExplainConfig,
	evidence: string,
	runDir: string,
): Explanation {
	const explanation = ExplanationSchema.parse(
		codexJson(
			cfg,
			cfg.schema,
			`${cfg.prompt}\n\n[EVIDENCE]\n${evidence}`,
			path.join(runDir, "source", "explanation.raw.json"),
		),
	);
	const issues = auditExplanation(
		explanation,
		evidence,
		cfg.max_chars_per_sentence,
		cfg.banned_conclusion_phrases,
	);
	const { verdicts } = codexJson<{
		verdicts: { index: number; matches: boolean; reason: string }[];
	}>(
		cfg,
		cfg.verify_schema,
		`${cfg.verify_prompt}\n\n[EVIDENCE]\n${evidence}\n\n[FIGURES]\n${JSON.stringify(explanation.figures, null, 2)}`,
		path.join(runDir, "source", "explanation.verdicts.json"),
	);
	for (const [index] of explanation.figures.entries()) {
		const verdict = verdicts.find((v) => v.index === index);
		if (!verdict?.matches) {
			issues.push(
				`figure_meaning_mismatch: ${index} ${verdict?.reason ?? "no verdict"}`,
			);
		}
	}
	if (issues.length > 0) {
		throw new Error(`CODEX_EXPLAIN_REJECTED ${issues.join(" | ")}`);
	}
	return explanation;
}
