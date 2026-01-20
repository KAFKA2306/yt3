import { NewsItem, Script } from "./models.js";

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
