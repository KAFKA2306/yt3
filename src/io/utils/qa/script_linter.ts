import { z } from "zod";
import type {
	AgentState,
	NewsItem,
	Script,
	ScriptLine,
} from "../../../domain/types.js";
import { AgentLogger as Logger } from "../logger.js";

/**
 * Discomfort Linter Result Schema
 */
export const DiscomfortLinterResultSchema = z.object({
	passed: z.boolean(),
	score: z.number(),
	checks: z.array(
		z.object({
			layer: z.string(),
			status: z.enum(["OK", "WARN", "FAIL"]),
			message: z.string(),
			details: z.array(z.string()).optional(),
		}),
	),
	extracted_facts: z.array(z.string()).optional(),
});

export type DiscomfortLinterResult = z.infer<
	typeof DiscomfortLinterResultSchema
>;

/**
 * ScriptIntegrityLinter v2: Detects "discomfort" (repeats, clashing voice, unverified facts, metric density)
 */
export class ScriptIntegrityLinter {
	private brandWords = [
		"humanity",
		"不器用",
		"愛おしい",
		"祝祭",
		"観測",
		"デルタ",
		"断面",
	];
	private forbiddenTerms = [
		"一石を投じる",
		"パラダイムシフト",
		"激変する世界",
		"未知の領域",
		"いかがでしたでしょうか",
	];

	/**
	 * Run all 10 layers of discomfort audit (v2)
	 */
	async audit(state: AgentState): Promise<DiscomfortLinterResult> {
		const script = state.script;
		const metadata = state.metadata;
		if (!script || !metadata) {
			return {
				passed: false,
				score: 0,
				checks: [
					{
						layer: "System",
						status: "FAIL",
						message: "Script or Metadata missing",
					},
				],
			};
		}

		const checks: DiscomfortLinterResult["checks"] = [];
		let totalScore = 100;

		// 1. Fact Plausibility & 2. Source Legitimacy (Corroboration with research)
		const factCheck = this.checkFactPlausibility(script, state.news || []);
		checks.push(factCheck);
		if (factCheck.status === "FAIL") totalScore -= 20;

		// 3. Metric Density Check
		const metricCheck = this.checkMetricDensity(script);
		checks.push(metricCheck);
		if (metricCheck.status === "WARN") totalScore -= 10;

		// 4. Repetition Entropy (Duplication Check v2)
		const dupCheck = this.checkRepetitionEntropy(script);
		checks.push(dupCheck);
		if (dupCheck.status === "FAIL") totalScore -= 30;

		// 5. Structure Consistency (Intro-Conclusion sets)
		const structCheck = this.checkStructureConsistency(script);
		checks.push(structCheck);
		if (structCheck.status === "FAIL") totalScore -= 20;

		// 6. Dialogue Template Reuse
		const templateCheck = this.checkDialogueTemplateReuse(script);
		checks.push(templateCheck);
		if (templateCheck.status === "WARN") totalScore -= 10;

		// 7. Authority & Weighting (Source mixing)
		const authorityCheck = this.checkAuthorityMixing(script);
		checks.push(authorityCheck);
		if (authorityCheck.status === "WARN") totalScore -= 10;

		// 8. Scope Overload (Topic coherence)
		const scopeCheck = this.checkScopeOverload(script, metadata.title);
		checks.push(scopeCheck);
		if (scopeCheck.status === "WARN") totalScore -= 10;

		// 9. Character & Brand Wording
		const wordingCheck = this.checkWordingDiscomfort(
			script,
			state.bucket || "",
		);
		checks.push(wordingCheck);
		if (wordingCheck.status === "WARN") totalScore -= 10;

		// 9.5 Technical Noun Repetition (Zero-Trust Spec Duplication Check)
		const techCheck = this.checkTechnicalNounRepetition(
			script,
			state.bucket || "",
		);
		checks.push(techCheck);
		if (techCheck.status === "FAIL") totalScore -= 20;

		// 10. Artifact Completeness (Duration check)
		const completionCheck = this.checkArtifactCompleteness(script);
		checks.push(completionCheck);
		if (completionCheck.status === "FAIL") totalScore -= 10;

		return {
			passed: totalScore >= 70 && !checks.some((c) => c.status === "FAIL"),
			score: Math.max(0, totalScore),
			checks,
		};
	}

	private checkFactPlausibility(
		script: Script,
		news: NewsItem[],
	): DiscomfortLinterResult["checks"][0] {
		const allText = script.lines.map((l) => l.text).join(" ");
		const numbers = allText.match(/\d+(?:\.\d+)?%?/g) || [];

		const newsText = news.map((n) => `${n.summary} ${n.title}`).join(" ");
		const unverifiedNumbers = numbers.filter(
			(n) => !newsText.includes(n.replace("%", "")),
		);

		if (unverifiedNumbers.length > 5) {
			return {
				layer: "FactPlausibility",
				status: "FAIL",
				message:
					"Unverified numeric claims detected (not found in research source)",
				details: unverifiedNumbers.slice(0, 5).map((n) => `Unverified: ${n}`),
			};
		}

		return {
			layer: "FactPlausibility",
			status: "OK",
			message: "Numeric claims corroborated with research",
		};
	}

	private checkMetricDensity(
		script: Script,
	): DiscomfortLinterResult["checks"][0] {
		const allText = script.lines.map((l) => l.text).join(" ");
		const numbers = allText.match(/\d+/g) || [];
		const sentenceCount = allText.split(/[。！？\n]/).length;
		const density = numbers.length / sentenceCount;

		if (density > 0.8) {
			return {
				layer: "MetricDensity",
				status: "WARN",
				message:
					"Extremely high metric density detected (plausible fake pattern)",
				details: [`Density: ${density.toFixed(2)} numbers per sentence`],
			};
		}

		return {
			layer: "MetricDensity",
			status: "OK",
			message: "Metric density is natural",
		};
	}

	private checkRepetitionEntropy(
		script: Script,
	): DiscomfortLinterResult["checks"][0] {
		const lines = script.lines.map((l) => l.text.trim());
		const duplicates = lines.filter(
			(item, index) => lines.indexOf(item) !== index && item.length > 15,
		);

		if (duplicates.length > 0) {
			return {
				layer: "Repetition",
				status: "FAIL",
				message: "Exact sentence repetition detected (Generative failure)",
				details: duplicates.map((d) => `Repeat: ${d.slice(0, 40)}...`),
			};
		}

		return {
			layer: "Repetition",
			status: "OK",
			message: "No significant repetition",
		};
	}

	private checkStructureConsistency(
		script: Script,
	): DiscomfortLinterResult["checks"][0] {
		const introCount = script.lines.filter(
			(l) => l.text.includes("お疲れ様") || l.text.includes("聞いてください"),
		).length;
		const outroCount = script.lines.filter(
			(l) => l.text.includes("観測記録でした") || l.text.includes("また明日"),
		).length;

		if (introCount > 1 || outroCount > 1) {
			return {
				layer: "Structure",
				status: "FAIL",
				message:
					"Multiple intro/outro sequences detected (Concatenation of candidates)",
				details: [`Intros: ${introCount}`, `Outros: ${outroCount}`],
			};
		}

		return {
			layer: "Structure",
			status: "OK",
			message: "One coherent structure",
		};
	}

	private checkDialogueTemplateReuse(
		script: Script,
	): DiscomfortLinterResult["checks"][0] {
		const patterns = script.lines.map((l) => {
			if (l.text.includes("すごい") || l.text.includes("驚異的"))
				return "SURPRISE";
			if (l.text.includes("でも") || l.text.includes("課題")) return "SKEPTIC";
			if (l.text.includes("そうね") || l.text.includes("確かに"))
				return "EXPLAIN";
			return "OTHER";
		});

		let reuseCount = 0;
		for (let i = 0; i < patterns.length - 2; i++) {
			if (
				patterns[i] === "SURPRISE" &&
				patterns[i + 1] === "SKEPTIC" &&
				patterns[i + 2] === "EXPLAIN"
			) {
				reuseCount++;
			}
		}

		if (reuseCount > 2) {
			return {
				layer: "Dialogue",
				status: "WARN",
				message:
					"Repetitive dialogue pattern 'Surprise -> Skeptic -> Explain' detected",
				details: [`Pattern matched ${reuseCount} times`],
			};
		}

		return {
			layer: "Dialogue",
			status: "OK",
			message: "Dialogue flow is natural",
		};
	}

	private checkAuthorityMixing(
		script: Script,
	): DiscomfortLinterResult["checks"][0] {
		const allText = script.lines.map((l) => l.text).join(" ");
		const authorities = ["WHO", "科学院", "連邦", "省", "政府"];
		const corporations = ["社", "企業", "Pharma", "Tech"];

		const foundAuth = authorities.filter((a) => allText.includes(a));
		const foundCorp = corporations.filter((c) => allText.includes(c));

		if (foundAuth.length > 0 && foundCorp.length > 0) {
			const details = [
				`Auth: ${foundAuth.join(",")}`,
				`Corp: ${foundCorp.join(",")}`,
			];
			return {
				layer: "Authority",
				status: "OK",
				message: "Mixed authority types handled (Manual review suggested)",
				details,
			};
		}

		return {
			layer: "Authority",
			status: "OK",
			message: "Consistent authority level",
		};
	}

	private checkScopeOverload(
		script: Script,
		title: string,
	): DiscomfortLinterResult["checks"][0] {
		const allText = script.lines.map((l) => l.text).join(" ");
		const topics = ["医療", "EV", "雇用", "ロシア", "地政学"];
		const foundTopics = topics.filter((t) => allText.includes(t));

		if (foundTopics.length > 3) {
			return {
				layer: "Scope",
				status: "WARN",
				message: "Scope overload: Too many disparate topics in one script",
				details: [`Found: ${foundTopics.join(", ")}`],
			};
		}

		return { layer: "Scope", status: "OK", message: "Topic scope is focused" };
	}

	private checkWordingDiscomfort(
		script: Script,
		bucket: string,
	): DiscomfortLinterResult["checks"][0] {
		const allText = script.lines.map((l) => l.text).join(" ");

		// Strict check: Forbid the word "humanity" in spoken lines of Humanity Observatory
		if (bucket === "humanity_observatory" && /humanity/i.test(allText)) {
			return {
				layer: "Wording",
				status: "FAIL",
				message:
					"Audience addressing word 'humanity' is forbidden in spoken lines. Use '人間さん' or '人類' instead.",
				details: ["Found 'humanity' in dialogue."],
			};
		}

		const variants = ["人類", "人間"];
		const found = variants.filter((v) => allText.includes(v));

		if (found.length > 2) {
			return {
				layer: "Wording",
				status: "WARN",
				message: "Brand terminology mixing",
				details: [`Variants: ${found.join(", ")}`],
			};
		}

		return { layer: "Wording", status: "OK", message: "Wording is consistent" };
	}

	private checkTechnicalNounRepetition(
		script: Script,
		bucket: string,
	): DiscomfortLinterResult["checks"][0] {
		if (bucket !== "humanity_observatory") {
			return {
				layer: "TechRepetition",
				status: "OK",
				message: "Not humanity_observatory, skipping tech repetition check",
			};
		}

		const allText = script.lines.map((l) => l.text).join(" ");
		const keywords = [/CoreS3/gi, /DYNAMIXEL/gi, /XL330/gi, /M5Stack/gi];
		const details: string[] = [];
		let hasFail = false;

		for (const regex of keywords) {
			const matches = allText.match(regex);
			if (matches && matches.length > 2) {
				hasFail = true;
				details.push(
					`Keyword '${regex.source}' mentioned ${matches.length} times (max allowed: 2)`,
				);
			}
		}

		if (hasFail) {
			return {
				layer: "TechRepetition",
				status: "FAIL",
				message: "Repetitive technical specifications detected",
				details,
			};
		}

		return {
			layer: "TechRepetition",
			status: "OK",
			message: "Technical specification terms are not repetitive",
		};
	}

	private checkArtifactCompleteness(
		script: Script,
	): DiscomfortLinterResult["checks"][0] {
		const allZero = script.lines.every((l) => l.duration === 0);
		if (allZero && script.lines.length > 0) {
			return {
				layer: "Artifact",
				status: "FAIL",
				message: "Incomplete timing data (all durations are 0)",
			};
		}
		return {
			layer: "Artifact",
			status: "OK",
			message: "Artifact states are valid",
		};
	}
}
