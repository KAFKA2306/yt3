
import { NewsItem, Script } from "./models.js";

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

    research_data?: any;
    trend_data?: any;
    director_data?: any;
    knowledge_context?: any;
}
