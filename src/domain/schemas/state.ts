import { z } from "zod";
import { NewsItemSchema, WebSearchResultSchema } from "./news.js";
import { StrategicInsightSchema } from "./research.js";
import { MetadataSchema, ScriptSchema } from "./script.js";

export const PublishResultsSchema = z.object({
	youtube: z
		.object({ status: z.string(), video_id: z.string().optional() })
		.optional(),
	twitter: z
		.object({ status: z.string(), tweet_id: z.string().optional() })
		.optional(),
});
export type PublishResults = z.infer<typeof PublishResultsSchema>;

export const NotebookLMResultSchema = z.object({
	videos: z.array(
		z.object({
			notebook_id: z.string(),
			notebook_title: z.string(),
			video_path: z.string(),
			generated_at: z.string(),
		}),
	),
	total_generated: z.number(),
});
export type NotebookLMResult = z.infer<typeof NotebookLMResultSchema>;

export const AgentStateSchema = z.object({
	run_id: z.string(),
	bucket: z.string(),
	news: z.array(NewsItemSchema).optional(),
	script: ScriptSchema.optional(),
	audio_paths: z.array(z.string()).optional(),
	video_path: z.string().optional(),
	thumbnail_path: z.string().optional(),
	status: z.string().optional(),
	metadata: MetadataSchema.optional(),
	publish_results: PublishResultsSchema.optional(),
	memory_context: z.string().optional(),
	strategic_insight: StrategicInsightSchema.optional(),
	notebook_videos: NotebookLMResultSchema.optional(),
	enriched_research: z
		.object({
			research_theme: z.string(),
			combined_insights: z.string(),
			generated_at: z.string(),
		})
		.optional(),
});
export type AgentState = z.infer<typeof AgentStateSchema>;
