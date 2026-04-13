import { z } from "zod";
import { NewsItemSchema } from "./news.js";

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
