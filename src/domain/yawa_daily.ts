import path from "node:path";
import fs from "fs-extra";
import * as yaml from "js-yaml";
import { z } from "zod";
import type { AuditCheck } from "./types.js";

const CreativeSchema = z.record(z.string(), z.unknown());

const RuntimeSchema = z
	.object({
		run: z.object({
			bucket: z.string().min(1),
			name_prefix: z.string().min(1),
		}),
		script: z.object({
			model: z.string().min(1),
			sandbox: z.literal("read-only"),
		}),
		tts: z.object({
			backend: z.string().min(1),
			device: z.enum(["cpu", "cuda"]),
			hf_home: z.string().min(1),
			backends: z.record(
				z.string(),
				z.object({
					dir: z.string().min(1),
					checkpoint: z.string().min(1),
					codec: z.string().min(1),
					steps: z.number().int().positive(),
				}),
			),
		}),
		image_tools: z.record(
			z.string(),
			z.object({
				command: z.string().min(1),
				size: z.string().min(1),
				sizes: z.array(z.string().min(1)).optional(),
			}),
		),
		video: z.object({
			file: z.string().min(1),
			width: z.number().int().positive(),
			height: z.number().int().positive(),
			fps: z.number().positive(),
			crf: z.number().int().min(0).max(51),
			audio_bitrate: z.string().min(1),
		}),
		thumbnail: z.object({
			file: z.string().min(1),
			width: z.number().int().positive(),
			height: z.number().int().positive(),
			quality: z.number().int().min(1).max(31),
		}),
		metadata: z.object({
			ai_disclosure: z.string().min(1),
			rights_declaration: z.string().min(1),
		}),
		audit: z.object({ duration_tolerance_seconds: z.number().nonnegative() }),
	})
	.passthrough();

const PerformanceSchema = z
	.object({
		voice_id: z.string().min(1),
		text: z.string().min(1),
		acting: z.string().optional(),
		duration_scale: z.number().finite().positive().optional(),
		pause_after_seconds: z.number().finite().nonnegative().optional(),
	})
	.passthrough();

const VoiceSchema = z
	.object({
		id: z.string().min(1),
		caption: z.string().min(1),
		reference_text: z.string().min(1).optional(),
	})
	.passthrough();

const MotionSchema = z
	.object({
		zoom_start: z.number().min(1),
		zoom_end: z.number().min(1),
		x_start: z.number().min(0).max(1),
		x_end: z.number().min(0).max(1),
		y_start: z.number().min(0).max(1),
		y_end: z.number().min(0).max(1),
	})
	.passthrough();

const ProductionSchema = z
	.object({
		tts_backend: z.string().min(1),
		image_tool: z.string().min(1),
		order: z.array(z.enum(["audio", "image"])).length(2),
		mix: z
			.object({
				target_lufs: z.number().finite(),
				true_peak_db: z.number().finite(),
				loudness_range: z.number().finite().positive(),
			})
			.passthrough()
			.optional(),
		video: z
			.object({
				width: z
					.number()
					.int()
					.positive()
					.refine((n) => n % 2 === 0),
				height: z
					.number()
					.int()
					.positive()
					.refine((n) => n % 2 === 0),
			})
			.passthrough()
			.optional(),
		cover_size: z.string().min(1).optional(),
		thumbnail_size: z.string().min(1).optional(),
		motion: MotionSchema.optional(),
	})
	.passthrough();

const DraftShape = z
	.object({
		title: z.string().min(1),
		description: z.string().optional(),
		tags: z.array(z.string().min(1)).optional(),
		voices: z.array(VoiceSchema).min(1),
		performances: z.array(PerformanceSchema).min(1).optional(),
		chapters: z
			.array(
				z
					.object({
						name: z.string().min(1).optional(),
						performances: z.array(PerformanceSchema).min(1),
					})
					.passthrough(),
			)
			.min(1)
			.optional(),
		cover_prompt: z.string().min(1),
		thumbnail_prompt: z.string().min(1),
		production: ProductionSchema,
	})
	.passthrough();

export const ScriptDraftSchema = DraftShape.superRefine((draft, context) => {
	if (Boolean(draft.performances) === Boolean(draft.chapters)) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message: "provide performances or chapters",
		});
	}
	if (new Set(draft.production.order).size !== 2) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message: "production.order must contain audio and image once each",
		});
	}
	const voices = new Set(draft.voices.map((voice) => voice.id));
	if (voices.size !== draft.voices.length) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			message: "voice ids must be unique",
		});
	}
	const performances =
		draft.performances ??
		draft.chapters?.flatMap((chapter) => chapter.performances) ??
		[];
	for (const performance of performances) {
		if (!voices.has(performance.voice_id)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: `unknown voice '${performance.voice_id}'`,
			});
		}
	}
});

export type YawaCreative = z.infer<typeof CreativeSchema>;
export type YawaRuntime = z.infer<typeof RuntimeSchema>;
export type YawaConfig = YawaRuntime & { creative: YawaCreative };
export type Performance = z.infer<typeof PerformanceSchema>;
export type VoiceDesign = z.infer<typeof VoiceSchema>;
export type ScriptDraft = z.infer<typeof ScriptDraftSchema>;
export type ScriptMeta = {
	title: string;
	description?: string;
	tags?: string[];
	[key: string]: unknown;
};

export const ScriptMetaSchema = z
	.object({
		title: z.string().min(1),
		description: z.string().optional(),
		tags: z.array(z.string()).optional(),
	})
	.passthrough();

export function loadYawaConfig(root: string): YawaConfig {
	const read = (file: string) =>
		yaml.load(fs.readFileSync(path.join(root, file), "utf8"));
	return {
		...RuntimeSchema.parse(read("config/yawa/runtime.yaml")),
		creative: CreativeSchema.parse(read("config/yawa/daily.yaml")),
	};
}

export function capabilities(config: YawaConfig): {
	tts: string[];
	images: string[];
} {
	return {
		tts: Object.keys(config.tts.backends),
		images: Object.keys(config.image_tools),
	};
}

export function flattenPerformances(draft: ScriptDraft): Performance[] {
	return (
		draft.performances ??
		draft.chapters?.flatMap((chapter) => chapter.performances) ??
		[]
	);
}

export function validateDraft(
	draft: ScriptDraft,
	config: YawaConfig,
	available: { tts: string[]; images: string[] },
): string[] {
	const failures: string[] = [];
	if ([...draft.title].length > 100)
		failures.push("title exceeds YouTube's 100-character limit");
	if (/[<>]/u.test(draft.title))
		failures.push("title contains a disallowed angle bracket");
	const description = buildDescription(draft, config);
	if (Buffer.byteLength(description, "utf8") > 5000)
		failures.push("description exceeds YouTube's 5000-byte limit");
	if (/[<>]/u.test(description))
		failures.push("description contains a disallowed angle bracket");
	const tags = draft.tags ?? [];
	const tagLength = tags.reduce(
		(sum, tag) => sum + [...tag].length + (/\s/u.test(tag) ? 2 : 0),
		Math.max(0, tags.length - 1),
	);
	if (tagLength > 500)
		failures.push("tags exceed YouTube's 500-character limit");
	if (!available.tts.includes(draft.production.tts_backend))
		failures.push(`TTS tool unavailable: ${draft.production.tts_backend}`);
	if (!available.images.includes(draft.production.image_tool))
		failures.push(`image tool unavailable: ${draft.production.image_tool}`);
	return failures;
}

export function assertUnprivileged(
	uid: number | undefined,
	writableDirs: string[],
): void {
	if (uid === 0)
		throw new Error("yawa daily must not run as root; use the kafka user");
	for (const dir of writableDirs) {
		fs.ensureDirSync(dir);
		fs.accessSync(dir, fs.constants.W_OK);
		const owner = fs.statSync(dir).uid;
		if (uid !== undefined && owner !== uid)
			throw new Error(`${dir} is owned by uid ${owner}, expected ${uid}`);
	}
}

export type IrodoriCall = {
	cwd: string;
	command: string[];
	env: Record<string, string>;
};

export function irodoriCall(
	config: YawaConfig,
	input: {
		backendId: string;
		text: string;
		caption: string;
		referenceWav?: string;
		durationScale?: number;
		outputWav: string;
		device?: "cpu" | "cuda";
	},
): IrodoriCall {
	const backend = config.tts.backends[input.backendId];
	if (!backend) throw new Error(`unknown TTS backend '${input.backendId}'`);
	return {
		cwd: backend.dir,
		command: [
			"uv",
			"run",
			"--frozen",
			"python",
			"infer.py",
			"--hf-checkpoint",
			backend.checkpoint,
			"--codec-repo",
			backend.codec,
			"--text",
			input.text,
			"--caption",
			input.caption,
			...(input.referenceWav
				? ["--ref-wavs", input.referenceWav]
				: ["--no-ref"]),
			"--num-steps",
			String(backend.steps),
			...(input.durationScale === undefined
				? []
				: ["--duration-scale", String(input.durationScale)]),
			"--output-wav",
			input.outputWav,
			...(input.device
				? ["--model-device", input.device, "--codec-device", input.device]
				: []),
		],
		env: { HF_HOME: config.tts.hf_home },
	};
}

export type PreparationAction = "prepare" | "skip_verified";
export function preparationAction(input: {
	publishVerified: boolean;
}): PreparationAction {
	return input.publishVerified ? "skip_verified" : "prepare";
}

function check(name: string, description: string, passed: boolean): AuditCheck {
	return {
		name,
		description,
		status: passed ? "PASS" : "QUALITY_FAIL",
		details: passed ? "ok" : "technical output check failed",
		critical: true,
		type: "DETERMINISTIC",
	};
}

export function yawaAudit(
	input: {
		audioSeconds: number;
		videoSeconds: number;
		coverReadable: boolean;
		thumbnailReadable: boolean;
		metadataValid: boolean;
	},
	config: YawaConfig,
): Record<string, AuditCheck> {
	const durationMatches =
		Number.isFinite(input.audioSeconds) &&
		input.audioSeconds > 0 &&
		Number.isFinite(input.videoSeconds) &&
		Math.abs(input.videoSeconds - input.audioSeconds) <=
			config.audit.duration_tolerance_seconds;
	return {
		audio_playable: check(
			"audio_playable",
			"Audio output can be probed and has positive duration",
			Number.isFinite(input.audioSeconds) && input.audioSeconds > 0,
		),
		video_playable: check(
			"video_playable",
			"Video output can be probed and has positive duration",
			Number.isFinite(input.videoSeconds) && input.videoSeconds > 0,
		),
		media_duration: check(
			"media_duration",
			"Audio and video durations agree",
			durationMatches,
		),
		cover_readable: check(
			"cover_readable",
			"Cover image was produced",
			input.coverReadable,
		),
		thumbnail_readable: check(
			"thumbnail_readable",
			"Thumbnail image was produced",
			input.thumbnailReadable,
		),
		metadata_valid: check(
			"metadata_valid",
			"Metadata fits the YouTube API contract",
			input.metadataValid,
		),
	};
}

export function buildTitle(draft: Pick<ScriptMeta, "title">): string {
	return draft.title;
}

export function buildDescription(
	draft: Pick<ScriptMeta, "description">,
	config: YawaConfig,
): string {
	return [
		draft.description,
		config.metadata.ai_disclosure,
		config.metadata.rights_declaration,
	]
		.filter((line): line is string => Boolean(line?.trim()))
		.join("\n\n");
}

export function buildTags(draft: Pick<ScriptMeta, "tags">): string[] {
	return draft.tags ?? [];
}
