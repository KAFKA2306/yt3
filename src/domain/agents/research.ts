import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import {
	type AssetStore,
	BaseAgent,
	AgentLogger as Logger,
	ROOT,
	RunStage,
	fetchRecentThemes,
	getCurrentDateString,
	loadMemoryContext,
	parseLlmJson,
} from "../../io/core.js";
import {
	ByosanAngleCandidateSchema,
	type ByosanAngleDecision,
	loadRecentByosanTitles,
	selectByosanAngle,
} from "../byosan/news_angle.js";
import {
	type NewsItem,
	NewsItemSchema,
} from "../types.js";

export interface ResearchResult {
	director_data: {
		angle: string;
		title_hook: string;
		search_query: string;
		key_questions: string[];
	};
	news: NewsItem[];
	memory_context: string;
	angle_decision?: ByosanAngleDecision;
}

export class TrendScout extends BaseAgent {
	constructor(store: AssetStore) {
		super(store, RunStage.RESEARCH, {
			temperature: store.cfg.steps.research?.temperature || 0.5,
		});
	}

	async run(
		bucket: string,
		limit?: number,
		missionFile?: string,
	): Promise<ResearchResult> {
		const cached = this.store.load<ResearchResult>(this.name, "output");
		if (cached) return cached;
		const researchCfg = this.config.steps.research;
		if (!researchCfg) throw new Error("Research config missing");
		this.logInput({
			bucket,
			limit: limit || researchCfg.default_limit || 3,
		});
		const recent = loadMemoryContext(this.store);
		const promptCfg = this.loadPrompt<{
			consolidated_research: { system: string; user_template: string };
		}>(this.name);
		const currentDate = getCurrentDateString();
		const recentThemes = fetchRecentThemes(this.store, 7);
		let userPrompt = promptCfg.consolidated_research.user_template
			.replace(
				"{regions}",
				researchCfg.regions.map((region) => region.lang).join(", "),
			)
			.replace("{recent_topics}", recent)
			.replace("{recent_themes}", recentThemes)
			.replace("{current_date}", currentDate);
		userPrompt += this.buildSourceRegistryPrompt(bucket);
		if (bucket === "byosan_money") userPrompt += this.buildSharpAnglePrompt();

		if (missionFile) {
			const sourcePath = path.isAbsolute(missionFile)
				? missionFile
				: path.join(ROOT, missionFile);
			if (!fs.existsSync(sourcePath)) {
				throw new Error(`MISSION_FILE does not exist: ${sourcePath}`);
			}
			const missionEvidence = fs.readFileSync(sourcePath, "utf8");
			userPrompt += `\n\n[MISSION EVIDENCE]\n${missionEvidence}\n(Use this supplied evidence as the primary source for the requested run. Preserve the requested JSON schema and do not add unrelated claims.)`;
			Logger.info(
				this.name,
				"RESEARCH",
				"MISSION",
				`Using explicit mission evidence: ${sourcePath}`,
			);
		}

		const research = await this.runLlm<{
			selected_topics: Array<{
				category: string;
				selected_topic: string;
				reason: string;
				angle: string;
				search_query: string;
				results: Array<{
					angle: string;
					title_hook: string;
					key_questions: string[];
					news: NewsItem[];
					byosan_angle?: z.infer<typeof ByosanAngleCandidateSchema>;
				}>;
			}>;
		}>(
			promptCfg.consolidated_research.system
				.replace(
					"{regions}",
					researchCfg.regions.map((region) => region.lang).join(", "),
				)
				.replace("{current_date}", currentDate),
			userPrompt,
			(text) =>
				parseLlmJson(
					text,
					z.object({
						selected_topics: z.array(
							z.object({
								category: z.string(),
								selected_topic: z.string(),
								reason: z.string(),
								angle: z.string(),
								search_query: z.string(),
								results: z.array(
									z.object({
										angle: z.string(),
										title_hook: z.string(),
										key_questions: z.array(z.string()),
										news: z.array(NewsItemSchema),
										byosan_angle: ByosanAngleCandidateSchema.optional(),
									}),
								),
							}),
						),
					}),
				),
			{ extra: { tools: [{ googleSearchRetrieval: {} }] } },
		);

		const allTopics = research.selected_topics || [];
		const candidateLocations = allTopics.flatMap((topic) =>
			(topic.results || [])
				.map((result) => ({
					topic,
					result,
					candidate: result.byosan_angle,
				}))
				.filter(
					(entry): entry is typeof entry & {
						candidate: z.infer<typeof ByosanAngleCandidateSchema>;
					} => Boolean(entry.candidate),
				),
		);
		let angleDecision: ByosanAngleDecision | undefined;
		let selectedTopic = allTopics[0];
		let selectedResult = selectedTopic?.results?.[0];

		if (bucket === "byosan_money") {
			const recentTitles = loadRecentByosanTitles(
				ROOT,
				new Date(`${currentDate}T23:59:59Z`),
			);
			angleDecision = selectByosanAngle(
				candidateLocations.map((entry) => entry.candidate),
				recentTitles,
			);
			fs.outputJsonSync(
				path.join(this.store.runDir, "research", "angle_decision.json"),
				angleDecision,
				{ spaces: 2 },
			);
			if (
				angleDecision.decision !== "PASS" ||
				angleDecision.selectedIndex === null
			) {
				throw new Error(
					`BYOSAN_ANGLE_STOP: ${angleDecision.reason}. See research/angle_decision.json`,
				);
			}
			const selectedLocation = candidateLocations[angleDecision.selectedIndex];
			if (!selectedLocation) {
				throw new Error(
					"BYOSAN_ANGLE_STOP: selected candidate index is invalid",
				);
			}
			selectedTopic = selectedLocation.topic;
			selectedResult = selectedLocation.result;
		}

		const result: ResearchResult = {
			director_data: {
				angle: selectedResult?.angle || selectedTopic?.angle || "",
				title_hook:
					selectedResult?.title_hook || selectedTopic?.selected_topic || "",
				search_query: selectedTopic?.search_query || "",
				key_questions: allTopics
					.flatMap((topic) => topic.results)
					.flatMap((item) => item.key_questions)
					.slice(0, 5),
			},
			news: allTopics
				.flatMap((topic) => topic.results)
				.flatMap((item) => item.news)
				.filter((item) => item?.title),
			memory_context: recent,
			angle_decision: angleDecision,
		};
		this.logOutput(result);
		return result;
	}

	private buildSourceRegistryPrompt(bucket: string): string {
		if (bucket !== "byosan_money") return "";
		const registryPath = path.join(
			ROOT,
			"config",
			"sources",
			"byosan_money_power_macro_sources.json",
		);
		if (!fs.existsSync(registryPath)) {
			throw new Error(
				"Byosan source registry is missing; research cannot continue without authoritative source coverage.",
			);
		}
		const registry = fs.readJsonSync(registryPath) as {
			sources?: Array<{
				id?: string;
				name?: string;
				url?: string;
				layer?: string;
				source_class?: string;
				importance?: string;
				priority?: string;
				kafka_use?: string[];
			}>;
			coverage_requirements?: { critical_source_ids?: string[] };
		};
		const sources = registry.sources || [];
		const criticalIds = new Set(
			registry.coverage_requirements?.critical_source_ids || [],
		);
		const selectedSources = sources
			.filter(
				(source) =>
					criticalIds.has(source.id || "") ||
					source.importance === "critical" ||
					source.priority === "high",
			)
			.slice(0, 48);
		if (selectedSources.length < 10) {
			throw new Error(
				"Byosan source registry has insufficient source coverage; research cannot continue.",
			);
		}
		const sourceLines = selectedSources.map((source) =>
			[
				source.id,
				source.layer || "L5_analyst_interpretation",
				source.source_class || "unknown",
				source.name,
				source.url,
				source.kafka_use?.length
					? `kafka_use=${source.kafka_use.join(",")}`
					: undefined,
			]
				.filter(Boolean)
				.join(" | "),
		);
		return [
			"",
			"[BYOSAN POWER MACRO SOURCE REGISTRY]",
			"Use this registry as the approved source universe. Prefer L1-L3 primary sources. If current facts cannot be grounded in this registry or explicit MISSION EVIDENCE, stop with an evidence gap instead of inventing or reusing fallback content.",
			...sourceLines,
		].join("\n");
	}

	private buildSharpAnglePrompt(): string {
		return `

[BYOSAN SHARP-ANGLE STRUCTURED OUTPUT]
Return at least five total results across selected_topics and cover at least three distinct publishers. Every results item MUST include a byosan_angle object with exactly these camelCase fields:
topic, angle, titleHook, whyNow, hiddenMechanism, counterfactual, audiencePayoff, numbers, sources, noveltyFingerprint, visualPlan, risks.
numbers must contain at least two concrete numerical strings. sources must contain at least two objects with id, name, absolute url, optional publishedAt, tier (L1|L2|L3|L4|L5|unknown), and non-empty supports. Use L1 for regulators/filings/central banks, L2 for state policy and official statistics, L3 for company or lab primary releases. counterfactual must be testable by exclusion, subtraction, or a changed denominator. Do not award or select a winner yourself; the deterministic harness will score every candidate and stop if no candidate passes.`;
	}
}
