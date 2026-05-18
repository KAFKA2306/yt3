import { z } from "zod";
import type { AgentState, Script, ScriptLine } from "../../../domain/types.js";
import { AgentLogger as Logger } from "../../logger.js";

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

export type DiscomfortLinterResult = z.infer<typeof DiscomfortLinterResultSchema>;

/**
 * ScriptIntegrityLinter: Detects "discomfort" (repeats, clashing voice, unverified facts)
 */
export class ScriptIntegrityLinter {
	private brandWords = ["humanity", "不器用", "愛おしい", "祝祭", "観測"];
	private forbiddenTerms = ["一石を投じる", "パラダイムシフト", "激変する世界", "未知の領域"];

	/**
	 * Run all 8 layers of discomfort audit
	 */
	async audit(state: AgentState): Promise<DiscomfortLinterResult> {
		const script = state.script;
		const metadata = state.metadata;
		if (!script || !metadata) {
			return { passed: false, score: 0, checks: [{ layer: "System", status: "FAIL", message: "Script or Metadata missing" }] };
		}

		const checks: DiscomfortLinterResult["checks"] = [];
		let totalScore = 100;

		// 1. Fact Check (Heuristic placeholder for numbers/proper nouns)
		const factCheck = this.checkFactDiscomfort(script);
		checks.push(factCheck);
		if (factCheck.status === "FAIL") totalScore -= 20;

		// 2. Duplication Check
		const dupCheck = this.checkDuplicationDiscomfort(script);
		checks.push(dupCheck);
		if (dupCheck.status === "FAIL") totalScore -= 30;

		// 3. Structure Check (Intro-Body-Conclusion repetition)
		const structCheck = this.checkStructureDiscomfort(script);
		checks.push(structCheck);
		if (structCheck.status === "FAIL") totalScore -= 20;

		// 4. Wording Check (Consistency of "humanity", etc.)
		const wordingCheck = this.checkWordingDiscomfort(script);
		checks.push(wordingCheck);
		if (wordingCheck.status === "WARN") totalScore -= 10;

		// 5. Character Voice Check (Vocabulary clash)
		const voiceCheck = this.checkCharacterVoiceDiscomfort(script, state.bucket || "");
		checks.push(voiceCheck);
		if (voiceCheck.status === "WARN") totalScore -= 10;

		// 6. Ethics/Finance Risk Check
		const riskCheck = this.checkRiskDiscomfort(script);
		checks.push(riskCheck);
		if (riskCheck.status === "WARN") totalScore -= 10;

		// 7. Theme Consistency Check
		const themeCheck = this.checkThemeConsistency(script, metadata.title);
		checks.push(themeCheck);
		if (themeCheck.status === "WARN") totalScore -= 10;

		// 8. Completion State Check (Duration 0 check)
		const completionCheck = this.checkCompletionState(script);
		checks.push(completionCheck);
		if (completionCheck.status === "FAIL") totalScore -= 10;

		return {
			passed: totalScore >= 70 && !checks.some(c => c.status === "FAIL"),
			score: Math.max(0, totalScore),
			checks,
		};
	}

	private checkFactDiscomfort(script: Script): DiscomfortLinterResult["checks"][0] {
		const allText = script.lines.map(l => l.text).join(" ");
		const numbers = allText.match(/\d+(?:\.\d+)?%?/g) || [];
		const properNouns = allText.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || []; // Simple regex for English nouns

		const details: string[] = [];
		if (numbers.length > 10) details.push(`High density of numbers: ${numbers.slice(0, 5).join(", ")}...`);
		
		// Flag specific "suspicious" claims if they lack source refs
		const unverified = numbers.filter(n => n === "85%" || n === "50%" || n === "500%");
		if (unverified.length > 0) {
			return {
				layer: "Fact",
				status: "FAIL",
				message: `Unverified/High-impact numbers detected: ${[...new Set(unverified)].join(", ")}`,
				details,
			};
		}

		return { layer: "Fact", status: "OK", message: "Facts seem reasonable" };
	}

	private checkDuplicationDiscomfort(script: Script): DiscomfortLinterResult["checks"][0] {
		const lines = script.lines.map(l => l.text.trim());
		const duplicates: string[] = [];
		const seen = new Set<string>();

		for (const line of lines) {
			if (line.length < 10) continue;
			// Simple exact match first
			if (seen.has(line)) {
				duplicates.push(line);
			}
			seen.add(line);
		}

		// Fuzzy repetition (checking for same keywords in multiple segments)
		const topics = ["NFT", "DeFi", "ロシア", "バッテリー", "新薬", "夕焼け"];
		const topicCounts: Record<string, number> = {};
		for (const topic of topics) {
			topicCounts[topic] = lines.filter(l => l.includes(topic)).length;
		}

		const overused = Object.entries(topicCounts).filter(([_, count]) => count > 3).map(([topic]) => topic);

		if (duplicates.length > 0 || overused.length > 0) {
			return {
				layer: "Duplication",
				status: "FAIL",
				message: "Repeated content or topics detected",
				details: [...duplicates.map(d => `Exact repeat: ${d.slice(0, 30)}...`), ...overused.map(t => `Topic overuse: ${t}`)],
			};
		}

		return { layer: "Duplication", status: "OK", message: "No significant repetition" };
	}

	private checkStructureDiscomfort(script: Script): DiscomfortLinterResult["checks"][0] {
		const intros = script.lines.filter(l => l.text.includes("お疲れ様") || l.text.includes("聞いてください") || l.text.includes("最近、AIが")).length;
		const closings = script.lines.filter(l => l.text.includes("夕焼け") || l.text.includes("また明日") || l.text.includes("いいですね")).length;

		if (intros > 2 || closings > 2) {
			return {
				layer: "Structure",
				status: "FAIL",
				message: "Multiple Intro/Conclusion sets detected. Script seems like a concatenation of candidates.",
				details: [`Intros: ${intros}`, `Closings: ${closings}`],
			};
		}

		return { layer: "Structure", status: "OK", message: "Structure is consistent" };
	}

	private checkWordingDiscomfort(script: Script): DiscomfortLinterResult["checks"][0] {
		const allText = script.lines.map(l => l.text).join(" ");
		const variants = ["humanity", "人類", "人間"];
		const found = variants.filter(v => allText.includes(v));

		if (found.length > 2) {
			return {
				layer: "Wording",
				status: "WARN",
				message: "Inconsistent brand terminology",
				details: [`Found variants: ${found.join(", ")}`],
			};
		}

		return { layer: "Wording", status: "OK", message: "Terminology is consistent" };
	}

	private checkCharacterVoiceDiscomfort(script: Script, bucket: string): DiscomfortLinterResult["checks"][0] {
		if (bucket !== "humanity_observatory") return { layer: "Character", status: "OK", message: "Not applicable" };

		const hardTerms = ["治験成功率", "固体電解質材料", "金融市場", "中央銀行", "DEFI", "NFT"];
		const lines = script.lines.map(l => l.text);
		const clashingLines = lines.filter(l => hardTerms.some(t => l.toUpperCase().includes(t.toUpperCase())));

		if (clashingLines.length > 5) {
			return {
				layer: "Character",
				status: "WARN",
				message: "Technical vocabulary clashing with character voice",
				details: clashingLines.slice(0, 3),
			};
		}

		return { layer: "Character", status: "OK", message: "Character voice matches content" };
	}

	private checkRiskDiscomfort(script: Script): DiscomfortLinterResult["checks"][0] {
		const allText = script.lines.map(l => l.text).join(" ");
		const riskyPhrases = ["リスクを承知で", "全ツッパ", "一攫千金", "物語に熱中"];
		
		if (riskyPhrases.some(p => allText.includes(p)) && (allText.includes("愛おしい") || allText.includes("それでいい"))) {
			return {
				layer: "Risk",
				status: "WARN",
				message: "Potential glorification of financial/speculative risk",
				details: ["Risk-taking behavior combined with positive affirmation."],
			};
		}

		return { layer: "Risk", status: "OK", message: "Risk handling is acceptable" };
	}

	private checkThemeConsistency(script: Script, title: string): DiscomfortLinterResult["checks"][0] {
		const allText = script.lines.map(l => l.text).join(" ");
		const titleKeywords = title.split(/[・、。\s]+/).filter(k => k.length > 1);
		
		// If "推し" is in title but not in body
		if (title.includes("推し") && !allText.includes("推し")) {
			return {
				layer: "Theme",
				status: "WARN",
				message: "Title mentions 'Oshi' but body focuses on finance/NFTs.",
				details: [`Title: ${title}`],
			};
		}

		return { layer: "Theme", status: "OK", message: "Theme is consistent" };
	}

	private checkCompletionState(script: Script): DiscomfortLinterResult["checks"][0] {
		const allZero = script.lines.every(l => l.duration === 0);
		if (allZero && script.lines.length > 0) {
			return {
				layer: "Completion",
				status: "FAIL",
				message: "All durations are 0. Script appears unconfirmed or uninitialized.",
			};
		}
		return { layer: "Completion", status: "OK", message: "Durations are set" };
	}
}
