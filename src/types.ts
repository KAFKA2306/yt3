import { z } from "zod";

// --- Models ---

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

export const PublishResultSchema = z.object({
    youtube: z.any().optional(),
    twitter: z.any().optional(),
});
export type PublishResult = z.infer<typeof PublishResultSchema>;

// --- State ---

export interface DirectorData {
    angle: string;
    title_hook: string;
    search_query: string;
    key_questions: string[];
}

export interface Metadata {
    title: string;
    thumbnail_title: string;
    description: string;
    tags: string[];
}

export interface PublishResults {
    youtube?: { status: string; video_id?: string };
    twitter?: { status: string; tweet_id?: string };
}

export interface AgentState {
    run_id: string;
    bucket: string;
    limit?: number;
    news?: NewsItem[];
    script?: Script;
    audio_paths?: string[];
    video_path?: string;
    thumbnail_path?: string;
    status?: string;
    director_data?: DirectorData;
    metadata?: Metadata;
    publish_results?: PublishResults;
    memory_context?: string;
}
