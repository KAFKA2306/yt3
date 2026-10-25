import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
import { z } from "zod";
import { ByosanChaptersConfigSchema } from "./description.js";
import { ByosanFeatureSegmentSchema } from "./feature_spec.js";
import type { SpeechPlan } from "./production_audit.js";
import { ByosanScenesConfigSchema } from "./scene_spec.js";

export const BYOSAN_CONFIG_PATH = path.join(
	process.cwd(),
	"config/domains/byosan_money.yaml",
);

const EmotionSchema = ByosanFeatureSegmentSchema.shape.emotion;
const SpeakerSchema = ByosanFeatureSegmentSchema.shape.speaker;
const nonEmptyString = z.string().min(1);
const positiveInteger = z.number().int().positive();
const nonNegativeNumber = z.number().nonnegative();
const stringList = z.array(nonEmptyString).min(1);

const VoiceControlsSchema = z.object({
	speedScale: z.number().positive(),
	pitchScale: z.number(),
	intonationScale: z.number().positive(),
	volumeScale: z.number().positive(),
	prePhonemeLength: nonNegativeNumber,
	postPhonemeLength: nonNegativeNumber,
	pauseLengthScale: z.number().positive(),
	outputSamplingRate: positiveInteger,
});

const VoiceCapSchema = z.object({
	pitchScale: z.number().optional(),
	intonationScale: z.number().positive().optional(),
});

const VoiceRegisterSchema = z.object({
	frame_length: positiveInteger,
	hop_length: positiveInteger,
	fmin_hz: z.number().positive(),
	fmax_hz: z.number().positive(),
	reference_percentile: z.number().min(0).max(100),
	loud_relative_db: z.number().max(0),
	loud_percentile: z.number().min(0).max(100),
	max_loud_f0_percentile_hz: z.number().positive(),
	jump_window_seconds: z.number().positive(),
	jump_ratio: z.number().gt(1),
	clip_threshold: z.number().min(0).max(1),
});

export type ByosanVoiceRegisterConfig = z.infer<typeof VoiceRegisterSchema>;

const ColorSchema = z.object({
	r: z.number().int().min(0).max(255),
	g: z.number().int().min(0).max(255),
	b: z.number().int().min(0).max(255),
	alpha: z.number().min(0).max(1),
});

const RectOffsetSchema = z.object({
	right_inset: nonNegativeNumber,
	baseline_offset: nonNegativeNumber,
	font_size: positiveInteger,
	opacity: z.number().min(0).max(1),
});

const SpeakerPointerSchema = z.object({
	start_x: nonNegativeNumber,
	start_bottom: nonNegativeNumber,
	control1_x: nonNegativeNumber,
	control1_bottom: nonNegativeNumber,
	control2_x: nonNegativeNumber,
	control2_bottom: nonNegativeNumber,
	end_x: nonNegativeNumber,
	end_bottom: nonNegativeNumber,
	stroke_opacity: z.number().min(0).max(1),
	stroke_width: positiveInteger,
	dot_radius: positiveInteger,
});

const BedToneSchema = z.object({
	frequency_hz: z.number().positive(),
	amplitude: z.number().positive(),
	lfo_hz: z.number().positive(),
	lfo_offset: z.number(),
	lfo_depth: z.number(),
});

const FeatureProductionSchema = z.object({
	default_spec: nonEmptyString,
	hero_source_name: nonEmptyString,
	brand_label: nonEmptyString,
	yaml_line_width: positiveInteger,
	publish_intent: z.object({
		profile: nonEmptyString,
		visibility: nonEmptyString,
		requires_receipt: z.boolean(),
		requires_visibility_attestation: z.boolean(),
	}),
	run_layout: z.object({
		source_dir: nonEmptyString,
		explanation: nonEmptyString,
		content_dir: nonEmptyString,
		content_output: nonEmptyString,
		metadata: nonEmptyString,
		research: nonEmptyString,
		media_dir: nonEmptyString,
		media_output: nonEmptyString,
		audio_dir: nonEmptyString,
		audio_manifest: nonEmptyString,
		scene_dir: nonEmptyString,
		video_dir: nonEmptyString,
		segment_video_dir: nonEmptyString,
		video_concat_list: nonEmptyString,
		audio_concat_list: nonEmptyString,
		thumbnail_jpg: nonEmptyString,
		visual_master: nonEmptyString,
		publish_video: nonEmptyString,
		audit_dir: nonEmptyString,
		production_report: nonEmptyString,
		audit_report: nonEmptyString,
		publish_dir: nonEmptyString,
		publish_input: nonEmptyString,
	}),
	tts: z.object({
		manifest_preview_chars: positiveInteger,
		narration_replacements: z.array(
			z.object({ from: nonEmptyString, to: z.string() }),
		),
		voice_presets: z.record(EmotionSchema, VoiceControlsSchema),
		speaker_caps: z.record(SpeakerSchema, VoiceCapSchema),
	}),
	emotion_labels: z.record(EmotionSchema, nonEmptyString),
	characters: z.object({
		zundamon_image: nonEmptyString,
		tsumugi_image: nonEmptyString,
	}),
	image: z.object({
		png_compression_level: z.number().int().min(0).max(9),
		hero_channels: z.union([z.literal(3), z.literal(4)]),
		trim_background: ColorSchema,
	}),
	audio: z.object({
		sample_rate: positiveInteger,
		narration_codec: nonEmptyString,
		narration_channels: positiveInteger,
		final_codec: nonEmptyString,
		final_channels: positiveInteger,
		final_bitrate: nonEmptyString,
		narration_filter: nonEmptyString,
		bed_filter: nonEmptyString,
		mix_filter: nonEmptyString,
		bed_tones: z.array(BedToneSchema).length(2),
	}),
	video: z.object({
		scale_flags: nonEmptyString,
		first_fade_in_seconds: nonNegativeNumber,
		fade_in_seconds: nonNegativeNumber,
		gop: positiveInteger,
		b_frames: nonNegativeNumber,
		h264_profile: nonEmptyString,
		pixel_format: nonEmptyString,
		color_standard: nonEmptyString,
		encoder_probe_source: nonEmptyString,
		nvenc: z.object({ codec: nonEmptyString, args: stringList }),
		libx264: z.object({ codec: nonEmptyString, args: stringList }),
	}),
	captions: z.object({
		max_lines: positiveInteger,
		max_line_units: positiveInteger,
		tolerance_units: nonNegativeNumber,
		half_width_units: z.number().positive(),
		overflow_penalty: positiveInteger,
		min_split_units: positiveInteger,
		protected_number_pattern: nonEmptyString,
		no_break_terms: z.array(nonEmptyString).min(1),
		lead_in_seconds: nonNegativeNumber,
		tail_seconds: nonNegativeNumber,
		min_usable_seconds: nonNegativeNumber,
		min_cue_seconds: nonNegativeNumber,
		fade_in_ms: nonNegativeNumber,
		fade_out_ms: nonNegativeNumber,
	}),
	ass_style: z.object({
		font_size: positiveInteger,
		bold: z.union([z.literal(-1), z.literal(0)]),
		outline: nonNegativeNumber,
		shadow: nonNegativeNumber,
		alignment: positiveInteger,
		margin_l: nonNegativeNumber,
		margin_r: nonNegativeNumber,
		margin_v: nonNegativeNumber,
	}),
	scene: z.object({
		headline_wrap_units: positiveInteger,
		headline_compact_threshold_units: positiveInteger,
		stat_value_compact_threshold_units: positiveInteger,
		stat_value_medium_threshold_units: positiveInteger,
		stat_value_compact_wrap_units: positiveInteger,
		stat_value_wrap_units: positiveInteger,
		stat_value_max_lines: positiveInteger,
		stat_value_letter_spacing_px: z.number(),
		source_label: nonEmptyString,
		question_mark: RectOffsetSchema,
		speaker_pointer: SpeakerPointerSchema,
	}),
	thumbnail: z.object({
		jpeg_quality: z.number().int().min(1).max(100),
		jpeg_chroma_subsampling: z.enum(["4:2:0", "4:4:4"]),
		brand_text_inset_x: nonNegativeNumber,
		brand_text_inset_y: nonNegativeNumber,
		brand_letter_spacing: nonNegativeNumber,
		footer_letter_spacing: nonNegativeNumber,
		callout_text_inset_x: nonNegativeNumber,
		top_callout_box_extra_height: nonNegativeNumber,
		top_callout_text_baseline_offset: nonNegativeNumber,
		bottom_callout_group_offset_y: nonNegativeNumber,
		bottom_callout_box_extra_height: nonNegativeNumber,
		bottom_callout_text_baseline_offset: nonNegativeNumber,
	}),
	audit: z.object({
		video_codec: nonEmptyString,
		audio_codec: nonEmptyString,
		min_output_bitrate_bps: positiveInteger,
		max_scene_seconds: positiveInteger,
		duration_tolerance_seconds: nonNegativeNumber,
		black_min_seconds: nonNegativeNumber,
		black_pixel_threshold: nonNegativeNumber,
		freeze_noise_db: z.number(),
		freeze_min_seconds: nonNegativeNumber,
		defect_log_max_lines: positiveInteger,
		ffmpeg_max_buffer_bytes: positiveInteger,
		voice_register: VoiceRegisterSchema,
	}),
});

const ByosanProductionConfigSchema = z.object({
	global_style: z.object({
		font_path: nonEmptyString,
		font_name: nonEmptyString,
	}),
	workflow: z.object({
		filenames: z.object({
			state: nonEmptyString,
			subtitles: nonEmptyString,
			thumbnail: nonEmptyString,
			audio_full: nonEmptyString,
		}),
		paths: z.object({ runs_dir: nonEmptyString }),
		default_bucket: nonEmptyString,
	}),
	steps: z.object({
		youtube: z.object({ max_title_length: positiveInteger }),
	}),
	providers: z.object({
		tts: z.object({
			voicevox: z.object({
				url: z.url(),
				speakers: z.object({
					春日部つむぎ: positiveInteger,
					ずんだもん: positiveInteger,
				}),
				timeout_ms: z.object({
					query: positiveInteger,
					synthesis: positiveInteger,
				}),
				health_timeout_ms: positiveInteger,
			}),
		}),
	}),
	feature_production: FeatureProductionSchema,
	scenes: ByosanScenesConfigSchema,
	chapters: ByosanChaptersConfigSchema,
});

export type ByosanProductionConfig = z.infer<
	typeof ByosanProductionConfigSchema
>;

let loaded: ByosanProductionConfig | null = null;

export function getByosanProductionConfig(): ByosanProductionConfig {
	if (loaded) return loaded;
	loaded = ByosanProductionConfigSchema.parse(
		yaml.load(fs.readFileSync(BYOSAN_CONFIG_PATH, "utf8")),
	);
	return loaded;
}

export function getByosanSpeechPlan(): SpeechPlan {
	const config = getByosanProductionConfig();
	return {
		maxSceneSeconds: config.feature_production.audit.max_scene_seconds,
		charsPerSecond: config.scenes.chars_per_second,
	};
}
