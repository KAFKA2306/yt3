import { z } from "zod";

export interface Rect { x: number; y: number; width: number; height: number; }
export interface Size { width: number; height: number; }
export interface OverlayConfig {
    type: string;
    enabled: boolean;
    image_path: string;
    anchor?: string;
    offset?: { top?: number; bottom?: number; left?: number; right?: number };
    width?: number;
    height?: number;
    height_ratio?: number;
    width_ratio?: number;
}

export const NewsItemSchema = z.object({
    title: z.string(),
    summary: z.string(),
    url: z.string(),
    published_at: z.string().optional().default(() => new Date().toISOString()),
    snippet: z.string().optional(),
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
    youtube: z.object({ status: z.string(), video_id: z.string().optional() }).optional(),
    twitter: z.object({ status: z.string(), tweet_id: z.string().optional() }).optional(),
});
export type PublishResult = z.infer<typeof PublishResultSchema>;

export interface AppConfig {
    workflow: {
        default_run_dir: string;
        checkpoint_enabled: boolean;
        trend_settings: {
            enabled: boolean;
            regions: string[];
            sources: string[];
        };
    };
    steps: {
        news: {
            query_buckets: Record<string, string>;
            fetch_count: number;
            final_count: number;
            cooldown_hours: number;
            count: number;
            recent_topics_runs: number;
            recent_topics_max_chars: number;
            recent_topics_min_token_length: number;
            recent_topics_stopwords: string[];
        };
        research: {
            recent_days: number;
            essence_limit: number;
        };
        script: {
            min_duration: number;
            max_duration: number;
            target_wow_score: number;
            retention_optimization: {
                enabled: boolean;
                opening_duration_seconds: number;
                bridge_interval_seconds: number;
                engagement_prompt_interval_seconds: number;
                cta_timing: string;
                max_topic_duration_seconds: number;
            };
            speakers: Record<string, { name: string; aliases: string[] }>;
        };
        audio: {
            sample_rate: number;
            format: string;
        };
        subtitle: {
            width_per_char_pixels: number;
            min_visual_width: number;
            max_visual_width: number;
        };
        video: {
            resolution: string;
            fps: number;
            background_color?: string;
            intro_seconds?: number;
            codec?: string;
            preset?: string;
            encoder_options?: Record<string, unknown>;
            encoder_global_args?: string[];
            thumbnail_overlay?: {
                enabled: boolean;
                duration_seconds?: number;
                source_key?: string;
            };
            effects: OverlayConfig[];
            subtitles?: {
                font_path?: string;
                font_name?: string;
                font_size?: number;
                primary_colour?: string;
                outline_colour?: string;
                outline?: number;
                shadow?: number;
                alignment?: number;
                margin_l?: number;
                margin_r?: number;
                margin_v?: number;
                min_font_size?: number;
                safe_area_min_width_percent?: number;
                overlay_padding?: number;
            };
        };
        thumbnail: {
            enabled: boolean;
            width: number;
            height: number;
            background_color: string;
            title_color: string;
            subtitle_color: string;
            show_subtitle: boolean;
            padding: number;
            max_lines: number;
            max_chars_per_line: number;
            title_font_size: number;
            subtitle_font_size: number;
            font_path: string;
            right_guard_band_px: number;
            outline_inner_color: string;
            outline_inner_width: number;
            outline_outer_color: string;
            outline_outer_width: number;
            palettes: Array<{
                background_color: string;
                title_color: string;
                outline_inner_color: string;
                outline_inner_width: number;
                outline_outer_color: string;
                outline_outer_width: number;
                subtitle_color: string;
            }>;
            overlays: OverlayConfig[];
            resolution?: string;
        };
        youtube?: {
            enabled: boolean;
            dry_run: boolean;
            max_title_length: number;
            max_description_length: number;
            default_tags: string[];
            category_id: number;
            default_visibility: string;
        };
        twitter?: {
            enabled: boolean;
            dry_run: boolean;
        };
    };
    providers: {
        llm: {
            gemini: { model: string; fallback_model: string | null; temperature: number; max_tokens: number };
        };
        tts: {
            voicevox: {
                enabled: boolean;
                url: string;
                speakers: Record<string, number>;
            };
        };
    };
}

export interface PromptData {
    system: string;
    user_template: string;
    speakers?: Record<string, { name: string; persona: string }>;
}

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
