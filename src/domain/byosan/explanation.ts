import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { ROOT } from "../../io/core.js";
import { codexLlmLogPath, runCodexExec } from "./codex_llm.js";
import type { ByosanAngleCandidate } from "./news_angle.js";

export type ExplainConfig = {
	schema: string;
	verify_schema: string;
	verify_prompt: string;
	sandbox: string;
	workdir_prefix: string;
	max_chars_per_sentence: number;
	banned_conclusion_phrases: string[];
	prompt: string;
};

export const ExplanationArticlesSchema = z.array(
	z.object({
		title: z.string().min(1),
		url: z.string().url(),
		issuer: z.string().min(1),
		published: z.string().min(1),
		body: z.string().min(1),
	}),
);

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

const VerdictsSchema = z.object({
	verdicts: z.array(
		z.object({
			index: z.number().int().min(0),
			matches: z.boolean(),
			reason: z.string(),
		}),
	),
});

export type ExplanationEvidence = { candidate: string; articles: string };

export type ExplanationCandidate = Pick<
	ByosanAngleCandidate,
	"topic" | "angle" | "hiddenMechanism" | "numbers"
> & { sources: { url: string }[] };

export function buildExplanationEvidence(
	candidate: ExplanationCandidate,
	articles: z.infer<typeof ExplanationArticlesSchema>,
): ExplanationEvidence {
	const matched = articles.filter((article) =>
		candidate.sources.some((source) => source.url === article.url),
	);
	if (matched.length === 0) {
		throw new Error(
			`BYOSAN_EXPLAIN_EVIDENCE_MISSING: no registered article matches candidate sources ${candidate.sources.map((source) => source.url).join(" ")}`,
		);
	}
	return {
		candidate: [
			`題材: ${candidate.topic}`,
			`角度: ${candidate.angle}`,
			`隠れた仕組み: ${candidate.hiddenMechanism}`,
			...candidate.numbers.map((number) => `数字: ${number}`),
		].join("\n"),
		articles: matched
			.map(
				(article) =>
					`## ${article.title}\n- 媒体: ${article.issuer}\n- 公開: ${article.published}\n- URL: ${article.url}\n\n${article.body}`,
			)
			.join("\n\n"),
	};
}

const normalizeText = (text: string): string => text.replace(/\s+/g, "");

export function auditVerdicts(
	figures: Explanation["figures"],
	verdicts: z.infer<typeof VerdictsSchema>["verdicts"],
): string[] {
	const verdictIndexes = verdicts
		.map((verdict) => verdict.index)
		.sort((a, b) => a - b);
	const expectedIndexes = figures.map((_, index) => index);
	if (verdictIndexes.join(",") !== expectedIndexes.join(",")) {
		return [
			`verdict_index_mismatch: expected ${expectedIndexes.join(",")} got ${verdictIndexes.join(",")}`,
		];
	}
	return figures.flatMap((figure, index) =>
		verdicts
			.filter((verdict) => verdict.index === index)
			.flatMap((verdict) => {
				const reason = normalizeText(verdict.reason);
				const grounded =
					reason.includes(normalizeText(figure.value)) &&
					[figure.metric, figure.population].some((term) =>
						reason.includes(normalizeText(term)),
					);
				const issues = verdict.matches
					? []
					: [`figure_meaning_mismatch: ${index} ${verdict.reason}`];
				if (!grounded) {
					issues.push(`figure_verdict_ungrounded: ${index}`);
				}
				return issues;
			}),
	);
}

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
	call: { stage: string; schema: string; logPath: string },
	input: string,
	out: string,
	parse: (value: unknown) => T,
): T {
	const text = runCodexExec(cfg, input, {
		stage: call.stage,
		attempt: 1,
		logPath: call.logPath,
		outputSchemaPath: path.join(ROOT, call.schema),
	});
	fs.outputFileSync(out, text);
	return parse(JSON.parse(text));
}

export function runCodexExplanation(
	cfg: ExplainConfig,
	evidence: ExplanationEvidence,
	runDir: string,
): Explanation {
	const logPath = codexLlmLogPath(runDir);
	const explanation = codexJson(
		cfg,
		{ stage: "explanation", schema: cfg.schema, logPath },
		`${cfg.prompt}\n\n[CANDIDATE]\n${evidence.candidate}\n\n[EVIDENCE]\n${evidence.articles}`,
		path.join(runDir, "source", "explanation.raw.json"),
		(value) => ExplanationSchema.parse(value),
	);
	const issues = auditExplanation(
		explanation,
		evidence.articles,
		cfg.max_chars_per_sentence,
		cfg.banned_conclusion_phrases,
	);
	const { verdicts } = codexJson(
		cfg,
		{ stage: "explanation_verdict", schema: cfg.verify_schema, logPath },
		`${cfg.verify_prompt}\n\n[EVIDENCE]\n${evidence.articles}\n\n[FIGURES]\n${JSON.stringify(explanation.figures, null, 2)}`,
		path.join(runDir, "source", "explanation.verdicts.json"),
		(value) => VerdictsSchema.parse(value),
	);
	issues.push(...auditVerdicts(explanation.figures, verdicts));
	if (issues.length > 0) {
		throw new Error(`CODEX_EXPLAIN_REJECTED ${issues.join(" | ")}`);
	}
	return explanation;
}
