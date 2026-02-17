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

export interface AppConfig {
    workflow: {
        default_run_dir: string;
        default_bucket: string;
        checkpoint_enabled: boolean;
        memory: { index_file: string; essence_file: string };
        trend_settings: { enabled: boolean; regions: string[]; sources: string[] };
        paths: { lock_file: string; runs_dir: string; prompts_dir: string; memory_dir: string };
        filenames: { output: string; state: string; audio_full: string; subtitles: string; thumbnail: string; video: string; audio_dir?: string; video_dir?: string };
    };
    steps: {
        news: { query_buckets: Record<string, string>; fetch_count: number; cooldown_hours: number };
        research: {
            recent_days: number;
            essence_limit: number;
            regions: { lang: string; code: string }[];
            request_cooldown_ms?: number;
            angles: { name: string; lang: string; suffix: string }[];
            temperature?: number;
            selection_temperature?: number;
            relevance_temperature?: number;
            default_limit?: number;
        };
        script: {
            target_wow_score: number;
            speakers: Record<string, { name: string; aliases: string[] }>;
            context_overlap_lines?: number;
            segment_sleep_ms?: number;
            default_tags?: string[];
        };
        audio: { sample_rate: number; format: string };
        subtitle: { width_per_char_pixels: number };
        video: {
            resolution: string;
            fps: number;
            effects: OverlayConfig[];
            background_color?: string;
            intro_seconds?: number;
            thumbnail_overlay?: { enabled: boolean };
            codec?: string;
            subtitles?: {
                font_name?: string;
                font_size?: number;
                font_path?: string;
                primary_colour?: string;
                outline_colour?: string;
                outline?: number;
                shadow?: number;
                alignment?: number;
                margin_l?: number;
                margin_r?: number;
                margin_v?: number;
                min_font_size?: number;
            };
        };
        thumbnail: {
            enabled: boolean;
            width: number;
            height: number;
            title_font_size: number;
            palettes: Array<{ background_color: string; title_color: string; outline_inner_color: string; outline_inner_width: number; outline_outer_color: string; outline_outer_width: number; }>;
            overlays: OverlayConfig[];
            padding: number;
            resolution?: string;
        };
        youtube?: {
            enabled: boolean;
            dry_run: boolean;
            max_title_length: number;
            max_description_length: number;
            default_tags?: string[];
            category_id?: number;
            default_visibility?: string;
        };
        twitter?: { enabled: boolean; dry_run: boolean };
    };
    providers: {
        llm: {
            gemini: { model: string; fallback_model: string | null; temperature: number; max_tokens: number };
            content?: { temperature: number };
            media?: { temperature: number };
            research?: { temperature: number; selection_temperature: number; relevance_temperature: number };
        };
        tts: { voicevox: { enabled: boolean; url: string; speakers: Record<string, number> } };
        manager: { check_interval_ms: number; stale_lock_timeout_seconds: number; start_hour: number; user: string };
    };
    logging: {
        level: string;
        format: string;
        activity_log_file: string;
    };
    discord?: { notification_channel_id: string };
    defaults?: {
        retries?: number;
        media?: {
            background_color?: string;
            intro_seconds?: number;
        };
    };
}

export interface PromptData {
    system: string;
    user_template: string;
    speakers?: Record<string, { name: string; persona: string }>;
}
