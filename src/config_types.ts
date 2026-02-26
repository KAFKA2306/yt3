export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}
export interface Size {
	width: number;
	height: number;
}
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
export interface McpServerConfig {
	command: string;
	args?: string[];
	env?: Record<string, string>;
}
export interface McpConfig {
	servers: {
		context7?: McpServerConfig;
		figma?: McpServerConfig;
		pptx?: McpServerConfig;
		arxiv?: McpServerConfig;
	};
}
export interface GlobalStyle {
	font_path: string;
	font_name: string;
	thumbnail: {
		title_size: number;
		subtitle_size: number;
	};
	video: {
		subtitle_size: number;
	};
}
export interface DesignTokens {
	primary_brand_color: string;
	accent_brand_color: string;
	contrast_text_color: string;
	alert_color: string;
	success_color: string;
	font_display: string;
	font_text: string;
}
export interface AppConfig {
	global_style: GlobalStyle;
	workflow: {
		default_run_dir: string;
		default_bucket: string;
		checkpoint_enabled: boolean;
		memory: { index_file: string; essence_file: string };
		trend_settings: { enabled: boolean; regions: string[]; sources: string[] };
		paths: {
			lock_file: string;
			runs_dir: string;
			memory_dir: string;
			ace_dir: string;
			state_dir: string;
		};
		filenames: {
			output: string;
			state: string;
			audio_full: string;
			subtitles: string;
			thumbnail: string;
			video: string;
			audio_dir?: string;
			video_dir?: string;
		};
	};
	steps: {
		news: {
			query_buckets: Record<string, string>;
			fetch_count: number;
			cooldown_hours: number;
		};
		research: {
			recent_days: number;
			essence_limit: number;
			regions: { lang: string; code: string }[];
			angles: { name: string; lang: string; suffix: string }[];
			temperature?: number;
			selection_temperature?: number;
			relevance_temperature?: number;
			default_limit?: number;
		};
		script: {
			speakers: Record<string, { name: string; aliases: string[] }>;
			context_overlap_lines?: number;
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
				overlay_padding?: number;
			};
		};
		thumbnail: {
			enabled: boolean;
			width: number;
			height: number;
			padding: number;
			max_lines?: number;
			max_chars_per_line?: number;
			right_guard_band_px?: number;
			show_subtitle?: boolean;
			title_font_size?: number;
			subtitle_font_size?: number;
			palettes: Array<{
				background_color: string;
				title_color: string;
				outline_inner_color: string;
				outline_inner_width: number;
				outline_outer_color: string;
				outline_outer_width: number;
				subtitle_color?: string;
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
			gemini: {
				model: string;
				primary_llm?: string;
				temperature: number;
				max_tokens: number;
			};
			content?: { temperature: number };
			media?: { temperature: number };
			research?: {
				temperature: number;
				selection_temperature: number;
				relevance_temperature: number;
			};
		};
		tts: {
			voicevox: {
				enabled: boolean;
				url: string;
				speakers: Record<string, number>;
			};
		};
		manager: {
			check_interval_ms: number;
			stale_lock_timeout_seconds: number;
			start_hour: number;
			user: string;
		};
	};
	logging: {
		level: string;
		format: string;
		activity_log_file: string;
	};
	automation: {
		enabled: boolean;
		venv_activate: string;
		log_dir: string;
		services: Array<{ name: string; command: string[] }>;
		schedules: Array<{ name: string; command: string[]; cron: string }>;
	};
	mcp: McpConfig;
	design_tokens: DesignTokens;
	news_bot?: {
		token_env: string;
		command_name: string;
		command_description: string;
		starter_template: string;
		response_template: string;
		thread_prefix: string;
		thread_message: string;
	};
	public_url?: string;
	// biome-ignore lint/suspicious/noExplicitAny: generic context
	prompts: Record<string, any>;
}
