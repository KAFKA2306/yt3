import { z } from "zod";

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
