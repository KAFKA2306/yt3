import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import {
	type AssetStore,
	BaseAgent,
	type LlmOptions,
	AgentLogger as Logger,
	ROOT,
	RunStage,
	fetchRecentThemes,
	getCurrentDateString,
	invokeStructuredLlm,
	loadConfig,
} from "../../io/core.js";
import {
	BYOSAN_COUNTERFACTUAL_TEST_MARKERS,
	type ByosanAngleCandidate,
	type ByosanAngleDecision,
	type ByosanAngleGate,
	isCurrentByosanAngleDecision,
	loadRecentByosanTitles,
	selectByosanAngle,
	settleByosanAngleCandidate,
} from "../byosan/news_angle.js";
import { composeResearchMemoryContext } from "../byosan/power_macro_memory.js";
import { type NewsItem, NewsItemSchema } from "../types.js";

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

export const ResearchPayloadSchema = z.object({
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
					byosan_angle: z.unknown().optional(),
				}),
			),
		}),
	),
});

export type ResearchPayload = z.infer<typeof ResearchPayloadSchema>;

export type RejectedByosanCandidate = {
	topic: string;
	angle: string;
	issues: string[];
};

export type SettledResearchPayload = {
	selected_topics: Array<
		Omit<ResearchPayload["selected_topics"][number], "results"> & {
			results: Array<
				Omit<
					ResearchPayload["selected_topics"][number]["results"][number],
					"byosan_angle"
				> & { byosan_angle?: ByosanAngleCandidate }
			>;
		}
	>;
	rejected_byosan_candidates: RejectedByosanCandidate[];
};

export function settleResearchPayload(
	payload: ResearchPayload,
	options: { requireByosanAngle: boolean },
): SettledResearchPayload {
	const rejected: RejectedByosanCandidate[] = [];
	const selected_topics = payload.selected_topics.map((topic) => ({
		...topic,
		results: topic.results.map(({ byosan_angle, ...result }) => {
			if (byosan_angle === undefined) {
				if (options.requireByosanAngle) {
					rejected.push({
						topic: topic.selected_topic,
						angle: result.angle,
						issues: ["byosan_angle: missing from LLM result"],
					});
				}
				return result;
			}
			const settled = settleByosanAngleCandidate(byosan_angle);
			if (settled.status === "VALID") {
				return { ...result, byosan_angle: settled.candidate };
			}
			rejected.push({
				topic: topic.selected_topic,
				angle: result.angle,
				issues: settled.issues,
			});
			return result;
		}),
	}));
	return { selected_topics, rejected_byosan_candidates: rejected };
}

export function countSettledByosanCandidates(
	research: SettledResearchPayload,
): number {
	return research.selected_topics
		.flatMap((topic) => topic.results)
		.filter((result) => result.byosan_angle !== undefined).length;
}

export function mergeSettledResearchPayloads(
	first: SettledResearchPayload,
	second: SettledResearchPayload,
): SettledResearchPayload {
	return {
		selected_topics: [...first.selected_topics, ...second.selected_topics],
		rejected_byosan_candidates: [
			...first.rejected_byosan_candidates,
			...second.rejected_byosan_candidates,
		],
	};
}

export const BYOSAN_ANGLE_SHAPE_EXAMPLE = {
	topic: "EXAMPLE_TOPIC",
	angle: "EXAMPLE_ANGLE_TEXT_FOR_THE_OBSERVED_CHANGE",
	titleHook: "EXAMPLE_TITLE_HOOK_TEXT",
	whyNow: "EXAMPLE_WHY_NOW_TEXT",
	hiddenMechanism: "EXAMPLE_HIDDEN_MECHANISM_TEXT",
	counterfactual: "EXAMPLE_COUNTERFACTUAL_TEXT",
	audiencePayoff: "EXAMPLE_AUDIENCE_PAYOFF_TEXT",
	numbers: ["EXAMPLE_NUMBER_1", "EXAMPLE_NUMBER_2"],
	sources: [
		{
			id: "example-source-1",
			name: "EXAMPLE_SOURCE_NAME",
			url: "https://example.com/source-1",
			publishedAt: "2026-01-01",
			tier: "L1",
			supports: ["EXAMPLE_SUPPORTED_CLAIM"],
		},
		{
			id: "example-source-2",
			name: "EXAMPLE_SOURCE_NAME",
			url: "https://example.com/source-2",
			tier: "L2",
			supports: ["EXAMPLE_SUPPORTED_CLAIM"],
		},
	],
	noveltyFingerprint: "EXAMPLE_NOVELTY_FINGERPRINT",
	visualPlan: "EXAMPLE_VISUAL_PLAN_TEXT",
	risks: ["EXAMPLE_RISK_TEXT"],
	explorationProfile: {
		geography: "EXAMPLE",
		sector: "EXAMPLE",
		actorType: "EXAMPLE",
		eventType: "EXAMPLE",
		timeHorizon: "EXAMPLE",
		causalDirection: "EXAMPLE",
		financialMetric: "EXAMPLE",
		supplyChainLayer: "EXAMPLE",
		marketRealEconomy: "EXAMPLE",
		dataSurface: "EXAMPLE",
		scale: "EXAMPLE",
	},
	adversarialEvidence: [
		{
			id: "example-adversarial-1",
			kind: "no_counter_evidence",
			targetClaim: "EXAMPLE_TARGET_CLAIM_TEXT",
			statement: "EXAMPLE_ADVERSARIAL_STATEMENT_TEXT",
			sourceIds: ["example-source-1"],
			checkedSourceIds: ["example-source-1", "example-source-2"],
		},
	],
	archetypeEvidence: [],
};

export type ResearchStructuredRequest = {
	schema: z.ZodSchema<ResearchPayload>;
	name: string;
	maxAttempts: number;
	evidencePath: string;
	rawResponseDir: string;
	messages: (
		attempt: number,
		lastValidationError?: string,
	) => Array<{ role: "system" | "user"; content: string }>;
};

export type ResearchStructuredInvoker = (
	request: ResearchStructuredRequest,
) => Promise<ResearchPayload>;

export function geminiResearchParams(
	request: ResearchStructuredRequest,
	opts: Record<string, unknown>,
	runDir: string,
) {
	return {
		...request,
		responseFormat: "json_text" as const,
		llmOptions: { ...opts, sessionId: runDir } as LlmOptions,
	};
}

export function byosanAngleGate(): ByosanAngleGate {
	const gate = (
		loadConfig("byosan_money") as unknown as {
			angle_gate: {
				min_candidate_count: number;
				min_distinct_publishers: number;
			};
		}
	).angle_gate;
	return {
		minCandidateCount: gate.min_candidate_count,
		minDistinctPublishers: gate.min_distinct_publishers,
	};
}

export class TrendScout extends BaseAgent {
	private readonly invokeStructured: ResearchStructuredInvoker;

	constructor(store: AssetStore, invokeStructured?: ResearchStructuredInvoker) {
		super(store, RunStage.RESEARCH, {
			temperature: store.cfg.steps.research?.temperature || 0.5,
		});
		this.invokeStructured =
			invokeStructured ??
			((request) =>
				invokeStructuredLlm<ResearchPayload>(
					geminiResearchParams(request, this.opts, store.runDir),
				));
	}

	async run(
		bucket: string,
		limit?: number,
		missionFile?: string,
	): Promise<ResearchResult> {
		const cached = this.store.load<ResearchResult>(this.name, "output");
		if (
			cached &&
			(bucket !== "byosan_money" ||
				isCurrentByosanAngleDecision(cached.angle_decision))
		)
			return cached;
		const researchCfg = this.config.steps.research;
		if (!researchCfg) throw new Error("Research config missing");
		this.logInput({
			bucket,
			limit: limit || researchCfg.default_limit || 3,
		});
		const memoryContext = composeResearchMemoryContext(bucket, "", ROOT);
		const promptCfg = this.loadPrompt<{
			consolidated_research: {
				system: string;
				user_template: string;
				candidate_repair_template: string;
			};
		}>(this.name);
		const currentDate = getCurrentDateString();
		const recentThemes = fetchRecentThemes(this.store, 7);
		let userPrompt = promptCfg.consolidated_research.user_template
			.replace(
				"{regions}",
				researchCfg.regions.map((region) => region.lang).join(", "),
			)
			.replace("{recent_topics}", memoryContext)
			.replace("{recent_themes}", recentThemes)
			.replace("{current_date}", currentDate);
		userPrompt += this.buildSourceRegistryPrompt(bucket);
		const angleGate = bucket === "byosan_money" ? byosanAngleGate() : undefined;
		if (angleGate) userPrompt += this.buildSharpAnglePrompt(angleGate);

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

		const systemPrompt = promptCfg.consolidated_research.system
			.replace(
				"{regions}",
				researchCfg.regions.map((region) => region.lang).join(", "),
			)
			.replace("{current_date}", currentDate);
		const invokeResearch = (label: "initial" | "repair", prompt: string) =>
			this.invokeStructured({
				schema: ResearchPayloadSchema,
				name: "byosan_research_selected_topics",
				maxAttempts: 5,
				evidencePath: path.join(
					this.store.runDir,
					"research",
					`structured_attempts_${label}.json`,
				),
				rawResponseDir: path.join(
					this.store.runDir,
					"research",
					"raw_responses",
					label,
				),
				messages: (attempt, lastValidationError) => [
					{ role: "system", content: systemPrompt },
					{
						role: "user",
						content:
							lastValidationError === undefined
								? prompt
								: `${prompt}\n\n[SCHEMA VALIDATION FEEDBACK]\nattempt=${attempt}\n前回の出力は次の検証で不正でした。同じ観測条件を保ったまま、selected_topics の全要素に results 配列を含む JSON のみを返してください。\n前回の検証エラー: ${lastValidationError}`,
					},
				],
			});
		const payload = await invokeResearch("initial", userPrompt);
		let research = settleResearchPayload(payload, {
			requireByosanAngle: bucket === "byosan_money",
		});
		if (
			angleGate &&
			countSettledByosanCandidates(research) < angleGate.minCandidateCount
		) {
			const repairPayload = await invokeResearch(
				"repair",
				this.buildCandidateRepairPrompt(
					userPrompt,
					promptCfg.consolidated_research.candidate_repair_template,
					research,
					angleGate.minCandidateCount,
				),
			);
			research = mergeSettledResearchPayloads(
				research,
				settleResearchPayload(repairPayload, { requireByosanAngle: true }),
			);
		}

		const allTopics = research.selected_topics || [];
		const candidateLocations = allTopics.flatMap((topic) =>
			(topic.results || [])
				.map((result) => ({
					topic,
					result,
					candidate: result.byosan_angle,
				}))
				.filter(
					(
						entry,
					): entry is typeof entry & {
						candidate: ByosanAngleCandidate;
					} => Boolean(entry.candidate),
				),
		);
		let angleDecision: ByosanAngleDecision | undefined;
		let selectedTopic = allTopics[0];
		let selectedResult = selectedTopic?.results?.[0];

		if (angleGate) {
			const recentTitles = loadRecentByosanTitles(
				ROOT,
				new Date(`${currentDate}T23:59:59Z`),
			);
			angleDecision = selectByosanAngle(
				candidateLocations.map((entry) => entry.candidate),
				recentTitles,
				angleGate,
			);
			fs.outputJsonSync(
				path.join(
					this.store.runDir,
					"research",
					"rejected_byosan_candidates.json",
				),
				research.rejected_byosan_candidates,
				{ spaces: 2 },
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
			memory_context: memoryContext,
			angle_decision: angleDecision,
		};
		this.logOutput(result);
		return result;
	}

	private buildCandidateRepairPrompt(
		userPrompt: string,
		template: string,
		research: SettledResearchPayload,
		minCandidateCount: number,
	): string {
		const rejected = research.rejected_byosan_candidates
			.map(
				(entry) =>
					`- ${entry.topic}（${entry.angle}）: ${entry.issues.join(" / ")}`,
			)
			.join("\n");
		const accepted = research.selected_topics
			.flatMap((topic) => topic.results)
			.flatMap((result) =>
				result.byosan_angle ? [`- ${result.byosan_angle.topic}`] : [],
			)
			.join("\n");
		const needed = minCandidateCount - countSettledByosanCandidates(research);
		return `${userPrompt}\n\n${template
			.replace("{rejected_issues}", rejected)
			.replace("{accepted_topics}", accepted)
			.replace("{needed}", String(needed))}`;
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
			"Use this registry as the approved source universe. Prefer L1-L3 primary sources. Cite a registry source only for a claim that the registry or the MISSION EVIDENCE article attributes to it; do not invent or reuse fallback content.",
			...sourceLines,
		].join("\n");
	}

	private buildSharpAnglePrompt(gate: ByosanAngleGate): string {
		return `

[BYOSAN SHARP-ANGLE STRUCTURED OUTPUT]
Return at least ${gate.minCandidateCount} total results across selected_topics and cover at least ${gate.minDistinctPublishers} distinct publishers. Every results item MUST include a byosan_angle object with exactly these camelCase fields:
topic, angle, titleHook, whyNow, hiddenMechanism, counterfactual, audiencePayoff, numbers, sources, noveltyFingerprint, visualPlan, risks, explorationProfile, adversarialEvidence, archetypeEvidence.
explorationProfile must contain non-empty strings for geography, sector, actorType, eventType, timeHorizon, causalDirection, financialMetric, supplyChainLayer, marketRealEconomy, dataSurface, scale. Describe where this candidate sits on each axis. The axes are descriptive; the harness does not require the candidate set to cover every value.
numbers must contain at least two concrete numerical strings. sources must contain at least two objects with id, name, absolute url, optional publishedAt, tier (L1|L2|L3|L4|L5|unknown), and non-empty supports. Use L1 for regulators/filings/central banks, L2 for state policy and official statistics, L3 for company or lab primary releases. source ids must be stable machine-readable identifiers. counterfactual must be testable by exclusion, subtraction, or a changed denominator, and must contain at least one of these markers: ${BYOSAN_COUNTERFACTUAL_TEST_MARKERS.join(" / ")}.

Shape of one byosan_angle object (types only; replace every value with observed facts and never copy example text):
${JSON.stringify(BYOSAN_ANGLE_SHAPE_EXAMPLE, null, 2)}

archetypeEvidence is an array of zero or more evidence bundles. Do not choose a winner or force a specialized pattern. Each bundle has archetype and slots. Each slot has slot, statement, sourceIds, optional adversarialEvidenceIds, optional activeProbeIds, and optional observedAt (YYYY-MM-DD). Only emit a bundle when every required slot is supported by listed sources. Supported archetypes/required slots are:
- actionable_prescription: pain, cause, prescription, ordering
- paradox_resolution: fact_a, fact_b, hidden_mechanism, catalyst_or_incentive
- progressive_comparison: round_1, round_2, round_3, role_fit
- first_principles: current_pain, old_model, mechanism, trade_off, simplification_boundary
- timeline_motive: event_1, event_2, event_3, anomaly, hypothesis_1, hypothesis_2, incentive; event_1..3 require observedAt
- role_reversal: side_a, side_b, historical_mirror, role_reversal, disclosure_incentive
- asymmetric_cost: headline_value, footnote_condition, specialization_gap, hidden_total_cost, downside_risk; footnote_condition must reference measurement_condition or source_limitation adversarialEvidence
- arithmetic_runtime_bias: headline_claim, reverse_calculation, offsetting_factor, runtime_default_bias, attribution_boundary; use this only when the vendor headline can be mathematically reversed into an implicit assumption and runtime defaults materially change user cost or behavior
- rollout_verification: access_gating, quota_consumption, behavior_change, self_report_boundary; quota_consumption must reference at least one VERIFIED authorized_api active probe through activeProbeIds, and this archetype is eligible only for breaking format
- supply_chain_dependency: surface_event, contract_trigger, hidden_dependency, downstream_impact
- regulatory_game_theory: legal_force, foreign_comparator, empirical_blowback, jurisdiction_asymmetry, equilibrium
- hardware_capital: headline_multiplier, robust_baseline, physical_bottleneck, supplier_capital, remaining_spof
The deterministic harness will select among eligible bundles after production format is known. If no bundle is complete, it will use standard Fact -> Context -> Impact. Do not invent missing slots to qualify a bundle.

adversarialEvidence must contain at least one object with id, kind, targetClaim, statement, sourceIds, checkedSourceIds. kind must be measurement_condition | counter_metric | third_party_disagreement | source_limitation | no_counter_evidence. Before returning a candidate, check the MISSION EVIDENCE articles for footnotes, methodology notes, unfavorable metrics, changed denominators, exclusions, and third-party measurements that could weaken the headline claim; record what the articles show, and do not claim a source body was read when it was not supplied. sourceIds must identify sources that directly support the adversarial statement. checkedSourceIds records the sources actually inspected for counter-evidence. sourceIds and checkedSourceIds must only reference ids listed in sources. Use no_counter_evidence only when at least two ids from sources appear in checkedSourceIds and no material counter-evidence was found; never omit the search silently.

If explicit active-probe evidence is supplied through MISSION EVIDENCE, activeProbes may be included with the canonical probe fields and archetypeEvidence slots may reference those probe ids through activeProbeIds. Never invent a probe, never mark an unexecuted probe VERIFIED, and never upgrade an identity or causal inference to verified solely because a probe observation exists. Active probes are observation-only evidence. Do not infer a company's motive as fact: record observable document structure as evidence and keep interpretation in hiddenMechanism/risks. Do not award or select a winner yourself; the deterministic harness will score every candidate and stop if no candidate passes.`;
	}
}
