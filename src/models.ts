
import { z } from "zod";

export const NewsItemSchema = z.object({
    title: z.string(),
    summary: z.string(),
    url: z.string(),
    published_at: z.string().optional().default(() => new Date().toISOString()),
});
export type NewsItem = z.infer<typeof NewsItemSchema>;

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

export const VideoMetadataSchema = z.object({
    title: z.string(),
    description: z.string(),
    tags: z.array(z.string()),
    thumbnail_path: z.string().default(""),
});
export type VideoMetadata = z.infer<typeof VideoMetadataSchema>;
