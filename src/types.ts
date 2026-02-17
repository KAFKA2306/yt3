import { z } from "zod";
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

export interface DirectorData {
    angle: string;
    title_hook: string;
    search_query: string;
    key_questions: string[];
}

export interface ContentResult { script: Script; metadata: Metadata; }

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

export interface EvaluationReport {
    score: number;
    critique: string;
    essence?: {
        topic: string;
        key_insights: string[];
    };
}

export interface ResearchLlmResponse {
    director_data: {
        angle: string;
        title_hook: string;
        key_questions: string[];
    };
    news: NewsItem[];
}

export interface EditorSelection {
    selected_topic: string;
    reason: string;
    search_query: string;
    angle: string;
}

export interface ContentOutline {
    title: string;
    sections: {
        id: number;
        title: string;
        key_points: string[];
        estimated_duration: number;
    }[];
}

export interface ContentSegment {
    lines: {
        speaker: string;
        text: string;
    }[];
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
    evaluation?: EvaluationReport;
    retries?: number;
}
