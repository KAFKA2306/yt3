import type {
	AgentState,
	AppConfig,
	DirectorData,
	EnrichedResearch,
	Metadata,
	NotebookLMResult,
	PublishResults,
	Script,
	StrategicAnalysis,
} from "../types.js";

type ChannelReducer<T> = {
	reducer: (x: T, y: T) => T;
	default: () => T;
};

const reducer = <T>(_x: T, y: T): T => y;

export function getChannels(cfg: AppConfig) {
	return {
		run_id: { reducer, default: () => "" },
		bucket: {
			reducer,
			default: () => cfg.workflow.default_bucket || "daily_pulse",
		},
		limit: { reducer, default: () => cfg.steps.research?.default_limit || 3 },
		director_data: { reducer, default: () => undefined } as ChannelReducer<
			DirectorData | undefined
		>,
		news: { reducer, default: () => [] },
		script: { reducer, default: () => undefined } as ChannelReducer<
			Script | undefined
		>,
		metadata: { reducer, default: () => undefined } as ChannelReducer<
			Metadata | undefined
		>,
		audio_paths: { reducer, default: () => [] },
		video_path: { reducer, default: () => "" },
		thumbnail_path: { reducer, default: () => "" },
		status: { reducer, default: () => "idle" },
		publish_results: { reducer, default: () => undefined } as ChannelReducer<
			PublishResults | undefined
		>,
		memory_context: { reducer, default: () => "" },
		mission_file: { reducer, default: () => undefined } as ChannelReducer<
			string | undefined
		>,
		strategic_insight: { reducer, default: () => undefined } as ChannelReducer<
			StrategicAnalysis | undefined
		>,
		notebook_videos: { reducer, default: () => undefined } as ChannelReducer<
			NotebookLMResult | undefined
		>,
		enriched_research: { reducer, default: () => undefined } as ChannelReducer<
			EnrichedResearch | undefined
		>,
	};
}
