import type { ScriptLine } from "../schemas/script.js";
import {
	forbiddenAbstractWords,
	mundaneClassifications,
	optimizationTerms,
	promptExampleTerms,
	selfInclusionWords,
	tedPhrases,
	thresholds,
} from "./humanity_audit_terms.js";

interface AuditableScriptLine extends ScriptLine {
	sources?: string[];
}

export type AuditStatus = "PASS" | "FAIL" | "WARN" | "UNKNOWN";

export interface HumanityEpisodeAudit {
	episodeId: string;
	sourceTrace: {
		totalLines: number;
		tracedLines: number;
		untracedLines: number;
		traceCoverage: number;
		status: AuditStatus;
	};
	unsupportedGeneralization: {
		count: number;
		examples: string[];
		status: AuditStatus;
	};
	mundaneFragments: {
		total: number;
		food: number;
		appliance: number;
		time: number;
		space: number;
		season: number;
		examples: string[];
		status: AuditStatus;
	};
	humanityEntropy: {
		timeScore: number;
		weatherScore: number;
		spaceScore: number;
		objectScore: number;
		emotionScore: number;
		totalEntropy: number;
		status: AuditStatus;
	};
	behavioralCharacteristics: {
		time: string[];
		season: string[];
		space: string[];
		object: string[];
		emotion: string[];
	};
	antiSlop: {
		abstractWords: number;
		tedPhrases: number;
		optimizationTerms: number;
		status: AuditStatus;
	};
	narratorInclusion: {
		selfInclusionCount: number;
		detachedAnalysisCount: number;
		status: AuditStatus;
	};
	promptCollusion: {
		reusedExampleTerms: string[];
		reuseCount: number;
		status: AuditStatus;
	};
	emotionalLanding: {
		hardConclusion: boolean;
		shameScore: number;
		pressureScore: number;
		status: AuditStatus;
	};
	decision: "PASS" | "FAIL";
}

/**
 * 人類観測所・ゼロトラスト品質監査 v2 エンジン
 * Deterministic quality audit for script compliance without LLM dependency.
 */
export function auditEpisodeV2(
	episodeId: string,
	lines: ScriptLine[],
): HumanityEpisodeAudit {
	const totalLines = lines.length;
	const fullText = lines.map((l) => l.text).join(" ");

	// 1. Source Trace Audit
	let tracedLines = 0;
	for (const line of lines) {
		const s = (line as AuditableScriptLine).sources;
		if (Array.isArray(s) && s.length > 0) {
			tracedLines++;
		}
	}
	const untracedLines = totalLines - tracedLines;
	const traceCoverage = totalLines > 0 ? tracedLines / totalLines : 0.0;
	const sourceTraceStatus: AuditStatus =
		traceCoverage >= thresholds.traceCoverageMin ? "PASS" : "FAIL";

	// 2. Unsupported Generalization Audit
	const generalizations: string[] = [];
	for (const line of lines) {
		const text = line.text;
		const s = (line as AuditableScriptLine).sources;
		const hasSource = Array.isArray(s) && s.length > 0;

		const isGeneralizing = tedPhrases.some((phrase) => text.includes(phrase));
		if (isGeneralizing && !hasSource) {
			generalizations.push(text);
		}
	}
	const unsupportedGeneralizationStatus: AuditStatus =
		generalizations.length <= thresholds.unsupportedGeneralizationMax
			? "PASS"
			: "FAIL";

	// 3. Mundane Fragment Audit & Entropy Calculation
	const getMatchedTerms = (terms: string[]) => {
		const matched: string[] = [];
		for (const term of terms) {
			if (fullText.includes(term)) matched.push(term);
		}
		return matched;
	};

	const foodMatched = getMatchedTerms(mundaneClassifications.food);
	const applianceMatched = getMatchedTerms(mundaneClassifications.appliance);
	const timeMatched = getMatchedTerms(mundaneClassifications.time);
	const spaceMatched = getMatchedTerms(mundaneClassifications.space);
	const seasonMatched = getMatchedTerms(mundaneClassifications.season);
	const emotionMatched = getMatchedTerms(mundaneClassifications.emotion);
	const objectMatched = getMatchedTerms(mundaneClassifications.object);

	const foundMundane: string[] = [];
	for (const cat of Object.values(mundaneClassifications)) {
		for (const term of cat) {
			if (fullText.includes(term)) foundMundane.push(term);
		}
	}

	const uniqueMundane = Array.from(new Set(foundMundane));
	const totalMundane = uniqueMundane.length;
	const mundaneFragmentsStatus: AuditStatus =
		totalMundane >= thresholds.mundaneFragmentsMin ? "PASS" : "FAIL";

	// Humanity Entropy (Simplified H = log(1 + count))
	const calcScore = (count: number) => (count > 0 ? Math.log2(1 + count) : 0);
	const timeScore = calcScore(timeMatched.length);
	const weatherScore = calcScore(seasonMatched.length);
	const spaceScore = calcScore(spaceMatched.length);
	const objectScore = calcScore(objectMatched.length);
	const emotionScore = calcScore(emotionMatched.length);
	const totalEntropy =
		timeScore + weatherScore + spaceScore + objectScore + emotionScore;

	const humanityEntropyStatus: AuditStatus =
		totalEntropy >= thresholds.entropyMin ? "PASS" : "FAIL";

	// 4. Anti-Slop Style Audit
	let abstractWords = 0;
	for (const term of forbiddenAbstractWords) {
		const matches = fullText.match(new RegExp(term, "g"));
		if (matches) abstractWords += matches.length;
	}

	let tedPhrasesCount = 0;
	for (const term of tedPhrases) {
		const matches = fullText.match(new RegExp(term, "g"));
		if (matches) tedPhrasesCount += matches.length;
	}

	let optimizationTermsCount = 0;
	for (const term of optimizationTerms) {
		const matches = fullText.match(new RegExp(term, "g"));
		if (matches) optimizationTermsCount += matches.length;
	}

	const antiSlopStatus: AuditStatus =
		optimizationTermsCount <= thresholds.optimizationTermsMax &&
		tedPhrasesCount <= thresholds.tedPhrasesMax
			? "PASS"
			: "FAIL";

	// 5. Narrator Inclusion Audit
	let selfInclusionCount = 0;
	for (const term of selfInclusionWords) {
		const matches = fullText.match(new RegExp(term, "g"));
		if (matches) selfInclusionCount += matches.length;
	}

	let detachedAnalysisCount = 0;
	for (const line of lines) {
		const text = line.text;
		const mentionsHuman = text.includes("人類") || text.includes("人間");
		const hasSelfInclusion = selfInclusionWords.some((word) =>
			text.includes(word),
		);
		if (mentionsHuman && !hasSelfInclusion) {
			detachedAnalysisCount++;
		}
	}

	const narratorInclusionStatus: AuditStatus =
		selfInclusionCount >= thresholds.narratorSelfInclusionMin ? "PASS" : "FAIL";

	// 6. Prompt Collusion Audit
	const reusedExampleTerms: string[] = [];
	let reuseCount = 0;
	for (const term of promptExampleTerms) {
		const matches = fullText.match(new RegExp(term, "g"));
		if (matches) {
			reusedExampleTerms.push(term);
			reuseCount += matches.length;
		}
	}

	const promptCollusionStatus: AuditStatus =
		reuseCount <= thresholds.promptExampleReuseMax ? "PASS" : "WARN";

	// 7. Emotional Landing Audit
	const lastLine = lines[lines.length - 1]?.text || "";
	const hardConclusion =
		lastLine.includes("改善") ||
		lastLine.includes("解決") ||
		lastLine.includes("克服") ||
		lastLine.includes("成長") ||
		lastLine.includes("最適化");

	// Calc approximate shame and pressure scores dynamically based on optimization/abstract density near outro
	const outroText = lines
		.slice(-3)
		.map((l) => l.text)
		.join(" ");
	let outroOptimizationCount = 0;
	for (const term of optimizationTerms) {
		const matches = outroText.match(new RegExp(term, "g"));
		if (matches) outroOptimizationCount += matches.length;
	}

	const shameScore = Math.min(0.1 + outroOptimizationCount * 0.15, 1.0);
	const pressureScore = hardConclusion
		? 0.8
		: Math.min(0.05 + outroOptimizationCount * 0.1, 1.0);

	const emotionalLandingStatus: AuditStatus =
		!hardConclusion &&
		shameScore <= thresholds.shameScoreMax &&
		pressureScore <= thresholds.pressureScoreMax
			? "PASS"
			: "FAIL";

	// 8. Final Decision: Must pass ALL strict criteria
	const decision =
		sourceTraceStatus === "PASS" &&
		unsupportedGeneralizationStatus === "PASS" &&
		mundaneFragmentsStatus === "PASS" &&
		humanityEntropyStatus === "PASS" &&
		antiSlopStatus === "PASS" &&
		narratorInclusionStatus === "PASS" &&
		emotionalLandingStatus === "PASS"
			? "PASS"
			: "FAIL";

	return {
		episodeId,
		sourceTrace: {
			totalLines,
			tracedLines,
			untracedLines,
			traceCoverage,
			status: sourceTraceStatus,
		},
		unsupportedGeneralization: {
			count: generalizations.length,
			examples: generalizations,
			status: unsupportedGeneralizationStatus,
		},
		mundaneFragments: {
			total: totalMundane,
			food: foodMatched.length,
			appliance: applianceMatched.length,
			time: timeMatched.length,
			space: spaceMatched.length,
			season: seasonMatched.length,
			examples: uniqueMundane,
			status: mundaneFragmentsStatus,
		},
		humanityEntropy: {
			timeScore,
			weatherScore,
			spaceScore,
			objectScore,
			emotionScore,
			totalEntropy,
			status: humanityEntropyStatus,
		},
		behavioralCharacteristics: {
			time: timeMatched,
			season: seasonMatched,
			space: spaceMatched,
			object: objectMatched,
			emotion: emotionMatched,
		},
		antiSlop: {
			abstractWords,
			tedPhrases: tedPhrasesCount,
			optimizationTerms: optimizationTermsCount,
			status: antiSlopStatus,
		},
		narratorInclusion: {
			selfInclusionCount,
			detachedAnalysisCount,
			status: narratorInclusionStatus,
		},
		promptCollusion: {
			reusedExampleTerms,
			reuseCount,
			status: promptCollusionStatus,
		},
		emotionalLanding: {
			hardConclusion,
			shameScore,
			pressureScore,
			status: emotionalLandingStatus,
		},
		decision,
	};
}
