import { z } from "zod";
export enum RunStage {
	RESEARCH = "research",
	CONTENT = "content",
	MEDIA = "media",
	PUBLISH = "publish",
	WATCHER = "watcher",
	MEMORY = "memory",
	AUDIT = "audit",
}
import type { OverlayConfig, Rect, Size } from "./config/base.js";

export interface RenderPlan {
	canvas: Size;
	overlays: Array<{
		config: OverlayConfig;
		resolvedPath: string;
		bounds: Rect;
	}>;
	subtitleArea?: Rect;
	safeMarginL?: number;
	safeMarginR?: number;
}
export * from "./config_types.js";
export const NewsItemSchema = z.object({
	title: z.string(),
	summary: z.string(),
	url: z.string(),
	published_at: z.string().optional(),
	snippet: z.string().optional(),
	original_english_text: z.string().optional(),
});
export type NewsItem = z.infer<typeof NewsItemSchema>;

export const WebSearchResultSchema = z.object({
	title: z.string(),
	url: z.string(),
	snippet: z.string(),
	source: z.string().optional(),
});
export type WebSearchResult = z.infer<typeof WebSearchResultSchema>;

export const IqaResultSchema = z.object({
	passed: z.boolean(),
	score: z.number(),
	metrics: z.object({
		sharpness: z.number(),
		contrastRatio: z.number(),
		isResolutionCorrect: z.boolean(),
		cognitiveRecognitionScore: z.number(),
		xHeightLegibilityScore: z.number(),
		mobileEdgeStrength: z.number(),
	}),
	backgroundRisk: z.enum(["low", "medium", "high"]),
	textLayout: z
		.object({
			isTextClipped: z.boolean(),
			clipBoundaryRatio: z.number(),
			isTextOverlappingCharacter: z.boolean(),
			overlapRatio: z.number(),
		})
		.optional(),
	reason: z.string().optional(),
});
export type IqaResult = z.infer<typeof IqaResultSchema>;
export const ScriptLineSchema = z.object({
	speaker: z.string(),
	text: z.string(),
	duration: z.number().default(0.0),
});
export type ScriptLine = z.infer<typeof ScriptLineSchema>;
export const ScriptSchema = z.object({
	title: z.string(),
	description: z.string(),
	lines: z.array(ScriptLineSchema),
	total_duration: z.number().default(0.0),
});
export type Script = z.infer<typeof ScriptSchema>;
export const MetadataSchema = z.object({
	title: z.string(),
	thumbnail_title: z.string(),
	description: z.string(),
	tags: z.array(z.string()),
});
export type Metadata = z.infer<typeof MetadataSchema>;
export const ContentResultSchema = z.object({
	script: ScriptSchema,
	metadata: MetadataSchema,
});
export type ContentResult = z.infer<typeof ContentResultSchema>;
export const ContentLlmResponseSchema = z.object({
	script: z.object({
		title: z.string(),
		lines: z.array(z.object({ speaker: z.string(), text: z.string() })),
	}),
	metadata: MetadataSchema,
});
export type ContentLlmResponse = z.infer<typeof ContentLlmResponseSchema>;
export const DirectorDataSchema = z.object({
	angle: z.string(),
	title_hook: z.string(),
	search_query: z.string(),
	key_questions: z.array(z.string()),
});
export type DirectorData = z.infer<typeof DirectorDataSchema>;
export const PublishResultsSchema = z.object({
	youtube: z
		.object({
			status: z.string(),
			video_id: z.string().optional(),
			channel_id: z.string().optional(),
			channel_title: z.string().optional(),
			privacy_status: z.string().optional(),
			published_at: z.string().optional(),
		})
		.optional(),
	twitter: z
		.object({ status: z.string(), tweet_id: z.string().optional() })
		.optional(),
});
export type PublishResults = z.infer<typeof PublishResultsSchema>;
export const ResearchLlmResponseSchema = z.object({
	director_data: z.object({
		angle: z.string(),
		title_hook: z.string(),
		key_questions: z.array(z.string()),
	}),
	news: z.array(NewsItemSchema),
});
export type ResearchLlmResponse = z.infer<typeof ResearchLlmResponseSchema>;
export const EditorSelectionSchema = z.object({
	selected_topic: z.string(),
	reason: z.string(),
	search_query: z.string(),
	angle: z.string(),
	trends: z.array(
		z.object({ region: z.string(), headline: z.string(), summary: z.string() }),
	),
});
export type EditorSelection = z.infer<typeof EditorSelectionSchema>;
export const ResearchDeepDiveSchema = z.object({
	results: z.array(
		z.object({
			angle: z.string(),
			title_hook: z.string(),
			key_questions: z.array(z.string()),
			news: z.array(NewsItemSchema),
		}),
	),
});
export type ResearchDeepDive = z.infer<typeof ResearchDeepDiveSchema>;
export const ContentOutlineSchema = z.object({
	title: z.string(),
	sections: z.array(
		z.object({
			id: z.number(),
			title: z.string(),
			key_points: z.array(z.string()),
			target_character_count: z.coerce.number(),
		}),
	),
});
export type ContentOutline = z.infer<typeof ContentOutlineSchema>;
export const ContentSegmentSchema = z.object({
	lines: z.array(
		z.object({
			speaker: z.string(),
			text: z.string(),
		}),
	),
});
export type ContentSegment = z.infer<typeof ContentSegmentSchema>;
export interface Palette {
	background: string;
	support: string;
	accent: string;
	text: string;
}
export interface DesignTokens {
	palettes: Palette[];
	typography: {
		primary_font: string;
		bold_weight: number;
		min_contrast: number;
	};
}
export const StrategicInsightSchema = z.object({
	primary_delta: z.object({
		event: z.string(),
		magnitude: z.string(),
		structural_shift: z.string(),
	}),
	insights: z.array(
		z.object({
			observation: z.string(),
			implication: z.string(),
			wisdom: z.string(),
		}),
	),
	investment_ideas: z.array(
		z.object({
			asset: z.string(),
			rationale: z.string(),
			backdoor_opportunity: z.string().optional(),
		}),
	),
	strategic_summary: z.string(),
	sources: z.array(z.string()),
});
export type StrategicAnalysis = z.infer<typeof StrategicInsightSchema>;

export const NotebookVideoSchema = z.object({
	notebook_id: z.string(),
	notebook_title: z.string(),
	video_path: z.string(),
	generated_at: z.string(),
});
export type NotebookVideo = z.infer<typeof NotebookVideoSchema>;

export const NotebookLMResultSchema = z.object({
	videos: z.array(NotebookVideoSchema),
	total_generated: z.number(),
});
export type NotebookLMResult = z.infer<typeof NotebookLMResultSchema>;

export const FinancialFindingSchema = z.object({
	company: z.string().optional(),
	edinet_key_metrics: z.record(z.string(), z.string()).optional(),
	jquants_data: z.record(z.string(), z.string()).optional(),
	summary: z.string(),
});
export type FinancialFinding = z.infer<typeof FinancialFindingSchema>;

export const EnrichedResearchSchema = z.object({
	research_theme: z.string(),
	dexter_jp_findings: z.array(FinancialFindingSchema).optional(),
	web_search_results: z.array(WebSearchResultSchema).optional(),
	combined_insights: z.string(),
	generated_at: z.string(),
});
export type EnrichedResearch = z.infer<typeof EnrichedResearchSchema>;

export const AuditStatusSchema = z.enum([
	"PASS",
	"QUALITY_FAIL",
	"INFRA_FAIL",
	"UNVERIFIED",
	"UNKNOWN",
	"ASK_USER",
	"FAIL",
]);
export type AuditStatus = z.infer<typeof AuditStatusSchema>;

export const AuditTypeSchema = z.enum([
	"DETERMINISTIC",
	"BOUNDED_PROBABILISTIC",
]);
export type AuditType = z.infer<typeof AuditTypeSchema>;

export const AuditEvidenceRefSchema = z.object({
	key: z.string(),
	label: z.string(),
	path: z.string().optional(),
	note: z.string().optional(),
});
export type AuditEvidenceRef = z.infer<typeof AuditEvidenceRefSchema>;

export const AuditCheckSchema = z.object({
	name: z.string(),
	description: z.string(),
	status: AuditStatusSchema,
	details: z.string().optional(),
	critical: z.boolean(),
	type: AuditTypeSchema,
});
export type AuditCheck = z.infer<typeof AuditCheckSchema>;

export const AuditReportCheckSchema = AuditCheckSchema.extend({
	check_id: z.string(),
	category: z.string(),
	normative_source: z.string(),
	expected_state: z.string(),
	failure_codes: z.array(z.string()),
	verification_method: z.string(),
	evidence_refs: z.array(AuditEvidenceRefSchema),
});
export type AuditReportCheck = z.infer<typeof AuditReportCheckSchema>;

export const AuditReportSchema = z.object({
	schema_version: z.literal("zero_trust_audit_report_v1"),
	run_id: z.string(),
	generated_at: z.string(),
	decision: z.enum(["PASS", "BLOCKED", "UNVERIFIED"]),
	summary: z.object({
		total_checks: z.number(),
		critical_failures: z.number(),
		status_counts: z.record(z.string(), z.number()),
	}),
	checks: z.array(AuditReportCheckSchema),
	evidence_files: z.object({
		evidence_raw: z.string(),
		result: z.string(),
		report: z.string().optional(),
		voice_assignment_report: z.string().optional(),
	}),
});
export type AuditReport = z.infer<typeof AuditReportSchema>;

export const ZeroTrustAuditCriterionSchema = z.object({
	criterion_id: z.string(),
	category: z.string(),
	title: z.string(),
	normative_source: z.string(),
	expected_state: z.string(),
	failure_codes: z.array(z.string()).min(1),
	verification_method: z.string(),
	evidence_required: z.array(z.string()).min(1),
	determinism: z
		.enum(["DETERMINISTIC", "BOUNDED_PROBABILISTIC", "HYBRID"])
		.default("DETERMINISTIC"),
});
export type ZeroTrustAuditCriterion = z.infer<
	typeof ZeroTrustAuditCriterionSchema
>;

export const ZeroTrustAuditCategorySchema = z.object({
	category_id: z.string(),
	title: z.string(),
	purpose: z.string(),
	criteria: z.array(ZeroTrustAuditCriterionSchema).min(1),
});
export type ZeroTrustAuditCategory = z.infer<
	typeof ZeroTrustAuditCategorySchema
>;

export const ZeroTrustAuditChecklistSchema = z.object({
	schema_version: z.literal("zero_trust_audit_checklist_v1"),
	project: z.string(),
	scope: z.string(),
	markdown_role: z.literal("rendering_only"),
	principles: z.array(z.string()).min(1),
	categories: z.array(ZeroTrustAuditCategorySchema).min(1),
});
export type ZeroTrustAuditChecklist = z.infer<
	typeof ZeroTrustAuditChecklistSchema
>;

export * from "./schemas/generation_dynamics.js";
import { GenerationDynamicsSchema } from "./schemas/generation_dynamics.js";

export const AgentStateSchema = z.object({
	run_id: z.string(),
	bucket: z.string(),
	limit: z.number().optional(),
	news: z.array(NewsItemSchema).optional(),
	script: ScriptSchema.optional(),
	audio_paths: z.array(z.string()).optional(),
	video_path: z.string().optional(),
	publish_video_path: z.string().optional(),
	thumbnail_path: z.string().optional(),
	status: z.string().optional(),
	director_data: DirectorDataSchema.optional(),
	metadata: MetadataSchema.optional(),
	publish_results: PublishResultsSchema.optional(),
	memory_context: z.string().optional(),
	mission_file: z.string().optional(),
	strategic_insight: StrategicInsightSchema.optional(),
	notebook_videos: NotebookLMResultSchema.optional(),
	enriched_research: EnrichedResearchSchema.optional(),
	audit_results: z.record(z.string(), AuditCheckSchema).optional(),
	generation_dynamics: GenerationDynamicsSchema.optional(),
});
export type AgentState = z.infer<typeof AgentStateSchema>;
