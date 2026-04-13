import { z } from "zod";

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
