import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
import type { AgentState } from "../../domain/types.js";
import { type AssetStore, ROOT } from "../core.js";

export interface CreativeFreshnessMetrics {
	novelty_score: number;
	diversity_score: number;
	serendipity_score: number;
	coverage_score: number;
	concreteness_score: number;
	freshness_score: number;
	max_similarity: number;
	recent_run_count: number;
	signals: string[];
	pass: boolean;
}

type RunProfile = {
	run_id: string;
	title: string;
	intro: string;
	topic: string;
	hook_pattern: string;
	cadence_profile: string;
	category: string;
};

function tokenize(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s]/gu, " ")
			.split(/\s+/)
			.filter((token) => token.length >= 2),
	);
}

function jaccard(a: string, b: string): number {
	const left = tokenize(a);
	const right = tokenize(b);
	const union = new Set([...left, ...right]);
	if (union.size === 0) return 0;
	let intersection = 0;
	for (const token of left) {
		if (right.has(token)) intersection++;
	}
	return intersection / union.size;
}

function sampleIntro(script: AgentState["script"]): string {
	if (!script?.lines?.length) return "";
	return script.lines
		.slice(0, 12)
		.map((line) => `${line.speaker}: ${line.text}`)
		.join(" ");
}

function extractCategory(
	directorData: Record<string, unknown> | undefined,
	metadata: AgentState["metadata"],
): string {
	const raw =
		typeof directorData?.angle === "string"
			? directorData.angle
			: metadata?.title || "";
	const text = raw.toLowerCase();
	if (text.includes("ai") || text.includes("半導体") || text.includes("tech"))
		return "tech";
	if (
		text.includes("金利") ||
		text.includes("インフレ") ||
		text.includes("frb") ||
		text.includes("cpi")
	)
		return "macro";
	if (
		text.includes("人類") ||
		text.includes("humanity") ||
		text.includes("観測")
	)
		return "humanity";
	if (text.includes("株") || text.includes("market") || text.includes("決算"))
		return "market";
	return "other";
}

function getRecentRunProfiles(store: AssetStore, bucket: string): RunProfile[] {
	const runsDir = path.join(ROOT, "runs", bucket);
	if (!fs.existsSync(runsDir)) return [];

	return fs
		.readdirSync(runsDir)
		.map((run_id) => path.join(runsDir, run_id))
		.filter((runDir) => fs.statSync(runDir).isDirectory())
		.map((runDir) => {
			const statePath = path.join(runDir, "state.json");
			const contentPath = path.join(runDir, "content", "output.yaml");
			const genPath = path.join(runDir, "generation_dynamics.json");
			const state = fs.existsSync(statePath)
				? (fs.readJsonSync(statePath) as AgentState)
				: undefined;
			const content = fs.existsSync(contentPath)
				? (yaml.load(fs.readFileSync(contentPath, "utf8")) as
						| {
								script?: AgentState["script"];
								metadata?: AgentState["metadata"];
						  }
						| undefined)
				: undefined;
			const dynamics = fs.existsSync(genPath)
				? (fs.readJsonSync(genPath) as Record<string, unknown>)
				: undefined;
			const title =
				state?.metadata?.title ||
				content?.metadata?.title ||
				state?.script?.title ||
				content?.script?.title ||
				"";
			const intro =
				sampleIntro(state?.script || content?.script) ||
				String(
					(state?.director_data as Record<string, unknown> | undefined)
						?.title_hook || "",
				);
			const topic =
				typeof state?.director_data?.search_query === "string"
					? state.director_data.search_query
					: title;
			return {
				run_id: path.basename(runDir),
				title,
				intro,
				topic,
				hook_pattern:
					typeof dynamics?.strategy_genome === "object" &&
					dynamics.strategy_genome &&
					"hook_pattern" in dynamics.strategy_genome &&
					typeof (dynamics.strategy_genome as { hook_pattern?: unknown })
						.hook_pattern === "string"
						? String(
								(dynamics.strategy_genome as { hook_pattern?: string })
									.hook_pattern,
							)
						: "unknown",
				cadence_profile:
					typeof dynamics?.strategy_genome === "object" &&
					dynamics.strategy_genome &&
					"cadence_profile" in dynamics.strategy_genome &&
					typeof (
						dynamics.strategy_genome as {
							cadence_profile?: unknown;
						}
					).cadence_profile === "string"
						? String(
								(
									dynamics.strategy_genome as {
										cadence_profile?: string;
									}
								).cadence_profile,
							)
						: "unknown",
				category: extractCategory(
					state?.director_data as Record<string, unknown> | undefined,
					state?.metadata || content?.metadata,
				),
			};
		})
		.filter((profile) => profile.title || profile.intro || profile.topic)
		.sort((a, b) => a.run_id.localeCompare(b.run_id))
		.slice(-12);
}

function countConcreteSignals(text: string): number {
	const numbers = text.match(/\d+(?:\.\d+)?/g)?.length || 0;
	const japaneseUnits = text.match(/[兆億万%]/g)?.length || 0;
	const concreteWords =
		text.match(
			/(円|ドル|社|件|回|人|日|年|秒|分|時間|駅|国|市場|企業|株|金利|決算|ニュース|動画|字幕|音声)/g,
		)?.length || 0;
	return numbers + japaneseUnits + concreteWords;
}

export function evaluateCreativeFreshness(
	store: AssetStore,
	state: AgentState,
): CreativeFreshnessMetrics {
	const bucket = state.bucket || store.domainId;
	if (!bucket) {
		throw new Error("Creative freshness requires an explicit bucket");
	}
	const currentTitle = state.metadata?.title || state.script?.title || "";
	const currentIntro = sampleIntro(state.script);
	const currentTopic =
		typeof state.director_data?.search_query === "string"
			? state.director_data.search_query
			: currentTitle;
	const currentText = `${currentTitle}\n${currentIntro}\n${currentTopic}`;
	const recent = getRecentRunProfiles(store, bucket).filter(
		(profile) => profile.run_id !== path.basename(store.runDir),
	);

	const similarities = recent.map((profile) => {
		const titleSim = jaccard(currentTitle, profile.title);
		const introSim = jaccard(currentIntro, profile.intro);
		const topicSim = jaccard(currentTopic, profile.topic);
		return titleSim * 0.45 + introSim * 0.35 + topicSim * 0.2;
	});
	const maxSimilarity = similarities.length > 0 ? Math.max(...similarities) : 0;
	const noveltyScore = Math.max(0, 100 * (1 - maxSimilarity));

	const hookPatterns = new Set(
		recent
			.map((profile) => profile.hook_pattern)
			.filter((v) => v !== "unknown"),
	);
	const cadenceProfiles = new Set(
		recent
			.map((profile) => profile.cadence_profile)
			.filter((v) => v !== "unknown"),
	);
	const categories = new Set(recent.map((profile) => profile.category));
	const diversityBasis = Math.max(recent.length, 1);
	const diversityScore = Math.min(
		100,
		((hookPatterns.size + cadenceProfiles.size + categories.size) /
			(3 * diversityBasis)) *
			100,
	);

	const questionCount = (currentIntro.match(/[?？]/g) || []).length;
	const hookWords =
		/(なぜ|どうして|しかし|でも|意外|実は|ただし|ところが|unexpected|surprise|why)/i;
	const hookSignal = hookWords.test(currentIntro) ? 1 : 0;
	const concreteSignal = countConcreteSignals(currentText);
	const introLength = currentIntro.length;
	const concisionScore =
		introLength === 0
			? 0
			: Math.max(0, 100 - Math.max(0, introLength - 420) / 6);
	const concretenessScore = Math.min(
		100,
		concreteSignal * 12 +
			questionCount * 8 +
			hookSignal * 20 +
			concisionScore * 0.2,
	);

	const coverageScore = Math.min(
		100,
		new Set([bucket, ...categories]).size * 18 + (recent.length > 0 ? 10 : 40),
	);

	const serendipityScore = Math.min(
		100,
		noveltyScore * 0.45 + concretenessScore * 0.35 + coverageScore * 0.2,
	);

	const freshnessScore = Math.min(
		100,
		noveltyScore * 0.35 +
			diversityScore * 0.25 +
			serendipityScore * 0.25 +
			coverageScore * 0.15,
	);

	const signals: string[] = [];
	if (maxSimilarity >= 0.45) signals.push("recent_similarity_high");
	if (diversityScore < 45) signals.push("topic_or_pattern_diversity_low");
	if (concretenessScore < 40) signals.push("opening_is_too_abstract");
	if (coverageScore < 45) signals.push("coverage_is_narrow");
	if (serendipityScore < 55) signals.push("unexpectedness_or_usefulness_low");

	const pass =
		freshnessScore >= 68 &&
		noveltyScore >= 60 &&
		diversityScore >= 45 &&
		serendipityScore >= 55 &&
		coverageScore >= 45;

	return {
		novelty_score: Number(noveltyScore.toFixed(2)),
		diversity_score: Number(diversityScore.toFixed(2)),
		serendipity_score: Number(serendipityScore.toFixed(2)),
		coverage_score: Number(coverageScore.toFixed(2)),
		concreteness_score: Number(concretenessScore.toFixed(2)),
		freshness_score: Number(freshnessScore.toFixed(2)),
		max_similarity: Number(maxSimilarity.toFixed(3)),
		recent_run_count: recent.length,
		signals,
		pass,
	};
}
