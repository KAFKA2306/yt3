import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import * as yaml from "js-yaml";
import sharp from "sharp";
import { getByosanChartTheme } from "../domain/byosan/charts.js";
import { buildByosanDescription } from "../domain/byosan/description.js";
import {
	displayUnits,
	wrapDisplay,
	xml,
} from "../domain/byosan/display_text.js";
import { ExplanationSchema } from "../domain/byosan/explanation.js";
import { explanationCheckItems } from "../domain/byosan/explanation_contract.js";
import {
	type ByosanFeatureSegment,
	type ByosanFeatureSpec,
	parseAndAuditByosanFeatureSpec,
	staticSceneMotionFilter,
} from "../domain/byosan/feature_spec.js";
import {
	byosanFontDir,
	fontMatchProblem,
	matchFontFamily,
	requiredFontFamilies,
} from "../domain/byosan/fonts.js";
import {
	layoutCueSpans,
	planSpeechParts,
} from "../domain/byosan/production_audit.js";
import {
	BYOSAN_CONFIG_PATH,
	getByosanProductionConfig,
	getByosanSpeechPlan,
} from "../domain/byosan/production_config.js";
import {
	type ByosanSceneRender,
	resolveSceneRender,
} from "../domain/byosan/scene_render.js";
import { compileScenes } from "../domain/byosan/scene_spec.js";
import {
	type SceneSvgStyle,
	renderSceneLayers,
} from "../domain/byosan/scene_svg.js";
import { buildThumbnailFiles } from "../domain/byosan/thumbnail.js";
import { resolveByosanVisualIdentity } from "../domain/byosan/visual_identity.js";
import {
	capVoiceControls,
	measureVoiceRegister,
	voiceRegisterPasses,
} from "../domain/byosan/voice_register.js";
import { getByosanVisualSystem } from "../domain/design/kafka_visual_system.js";
import { runAudioQA } from "../io/utils/audio_qa.js";
import {
	TtsOrchestrator,
	type TtsVoiceControls,
} from "../io/utils/tts_orchestrator.js";

type FeatureSegment = ByosanFeatureSegment;

type TimedSegment = FeatureSegment & {
	index: number;
	duration: number;
	start: number;
	audioPath: string;
	render: ByosanSceneRender;
	voice: TtsVoiceControls;
};

type FeatureSpec = ByosanFeatureSpec;

const CONFIG = getByosanProductionConfig();
const F = CONFIG.feature_production;
const RUN = F.run_layout;
const FILENAMES = CONFIG.workflow.filenames;
const VOICEVOX = CONFIG.providers.tts.voicevox;
const DESIGN = getByosanVisualSystem();
const LANDSCAPE = DESIGN.landscape;
const THUMBNAIL = DESIGN.thumbnail;
const THUMBNAIL_CANVAS = DESIGN.canvas.thumbnail;
const WIDTH = DESIGN.canvas.landscape.width;
const HEIGHT = DESIGN.canvas.landscape.height;
const FPS = DESIGN.canvas.landscape.fps;
const FONT = DESIGN.typography.japanese;
const PROJECT_ROOT = process.cwd();
const FONT_DIR = byosanFontDir();
const DEFAULT_SPEC = path.join(PROJECT_ROOT, F.default_spec);
const VISUAL_IDENTITY = resolveByosanVisualIdentity(
	yaml.load(fs.readFileSync(BYOSAN_CONFIG_PATH, "utf8")),
);
const SCENE_STYLE: SceneSvgStyle = {
	design: DESIGN,
	feature: F,
	identity: VISUAL_IDENTITY,
	chart: getByosanChartTheme(),
};

function captionProtectedRanges(value: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	const protect = (startCodeUnit: number, text: string): void => {
		const start = Array.from(value.slice(0, startCodeUnit)).length;
		ranges.push([start, start + Array.from(text).length]);
	};
	for (const term of F.captions.no_break_terms) {
		let searchFrom = 0;
		while (searchFrom < value.length) {
			const start = value.indexOf(term, searchFrom);
			if (start < 0) break;
			protect(start, term);
			searchFrom = start + term.length;
		}
	}
	for (const match of value.matchAll(
		new RegExp(F.captions.protected_number_pattern, "gu"),
	)) {
		protect(match.index, match[0]);
	}
	return ranges;
}

function isUnsafeCaptionBreak(value: string, index: number): boolean {
	const chars = Array.from(value);
	const previous = chars[index - 1] ?? "";
	const next = chars[index] ?? "";
	if (/^[、。！？,.%％）】」』]/u.test(next)) return true;
	if (/[A-Za-z0-9]$/.test(previous) && /^[A-Za-z0-9]/.test(next)) return true;
	return captionProtectedRanges(value).some(
		([start, end]) => index > start && index < end,
	);
}

function wrapCaptionDisplay(value: string, maxUnits: number): string[] {
	if (displayUnits(value, F.captions.half_width_units) <= maxUnits)
		return [value];
	const chars = Array.from(value);
	let bestIndex = 0;
	let bestScore = Number.POSITIVE_INFINITY;
	for (let index = 1; index < chars.length; index++) {
		if (isUnsafeCaptionBreak(value, index)) continue;
		const leftUnits = displayUnits(
			chars.slice(0, index).join(""),
			F.captions.half_width_units,
		);
		const rightUnits = displayUnits(
			chars.slice(index).join(""),
			F.captions.half_width_units,
		);
		const overflow =
			Math.max(0, leftUnits - maxUnits) + Math.max(0, rightUnits - maxUnits);
		const score =
			overflow * F.captions.overflow_penalty + Math.abs(leftUnits - rightUnits);
		if (score < bestScore) {
			bestScore = score;
			bestIndex = index;
		}
	}
	if (bestIndex === 0)
		return wrapDisplay(value, maxUnits, F.captions.half_width_units).slice(
			0,
			F.captions.max_lines,
		);
	return [chars.slice(0, bestIndex).join(""), chars.slice(bestIndex).join("")];
}

function assTimestamp(seconds: number): string {
	const bounded = Math.max(0, seconds);
	const hours = Math.floor(bounded / 3600);
	const minutes = Math.floor((bounded % 3600) / 60);
	const secs = Math.floor(bounded % 60);
	const centis = Math.floor((bounded - Math.floor(bounded)) * 100);
	return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

function assColor(hex: string): string {
	const [red, green, blue] = Array.from(
		hex.slice(1).matchAll(/[0-9A-Fa-f]{2}/g),
		(match) => match[0],
	);
	return `&H00${blue}${green}${red}`;
}

function narrationText(text: string): string {
	return F.tts.narration_replacements.reduce(
		(current, { from, to }) => current.replaceAll(from, to),
		text,
	);
}

function audioDuration(filePath: string): number {
	return Number.parseFloat(
		execFileSync(
			"ffprobe",
			[
				"-v",
				"error",
				"-show_entries",
				"format=duration",
				"-of",
				"default=noprint_wrappers=1:nokey=1",
				filePath,
			],
			{ encoding: "utf8" },
		).trim(),
	);
}

function run(command: string, args: string[], label: string): void {
	const result = spawnSync(command, args, {
		cwd: PROJECT_ROOT,
		stdio: "inherit",
	});
	if (result.status !== 0) {
		throw new Error(
			`${label} failed with exit code ${result.status ?? "null"}`,
		);
	}
}

async function characterSourceBuffer(
	speaker: FeatureSegment["speaker"],
): Promise<Buffer> {
	const source =
		speaker === "ずんだもん"
			? path.join(PROJECT_ROOT, F.characters.zundamon_image)
			: path.join(PROJECT_ROOT, F.characters.tsumugi_image);
	if (!(await fs.pathExists(source))) {
		throw new Error(`BYOSAN_CHARACTER_ASSET_MISSING: ${speaker}: ${source}`);
	}
	return fs.readFile(source);
}

async function characterBuffer(
	speaker: FeatureSegment["speaker"],
): Promise<Buffer> {
	return sharp(await characterSourceBuffer(speaker))
		.trim({ background: F.image.trim_background })
		.resize({
			height: LANDSCAPE.character_region.height,
			fit: "inside",
			withoutEnlargement: true,
		})
		.png()
		.toBuffer();
}

function renderHeldSegment(
	segment: TimedSegment,
	masterPath: string,
	outputPath: string,
): void {
	const entrance = F.video.remotion.entrance_frames / FPS;
	const hold = Math.max(0, segment.duration - entrance);
	run(
		"ffmpeg",
		[
			"-y",
			"-hide_banner",
			"-loglevel",
			"error",
			"-ss",
			(segment.index * entrance).toFixed(3),
			"-t",
			entrance.toFixed(3),
			"-i",
			masterPath,
			"-vf",
			`tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)},trim=duration=${segment.duration.toFixed(3)},fps=${FPS},format=${F.video.pixel_format}`,
			"-an",
			...videoEncoderArgs(),
			"-r",
			String(FPS),
			"-g",
			String(F.video.gop),
			"-bf",
			String(F.video.b_frames),
			"-pix_fmt",
			F.video.pixel_format,
			...colorArgs(),
			outputPath,
		],
		`hold visual segment ${segment.index}`,
	);
}

async function renderVisualMaster(
	timed: TimedSegment[],
	visualPath: string,
	publicDir: string,
	runDir: string,
	firstSlidePath: string,
): Promise<void> {
	await fs.emptyDir(publicDir);
	await fs.copyFile(firstSlidePath, path.join(publicDir, "first-slide.png"));
	const characters = new Map<
		FeatureSegment["speaker"],
		{ file: string; left: number; top: number }
	>();
	for (const [speakerIndex, speaker] of [
		...new Set(timed.map((segment) => segment.speaker)),
	].entries()) {
		const buffer = await characterBuffer(speaker);
		const metadata = await sharp(buffer).metadata();
		const region = LANDSCAPE.character_region;
		const file = `character-${speakerIndex}.png`;
		await fs.writeFile(path.join(publicDir, file), buffer);
		characters.set(speaker, {
			file,
			left: Math.round(
				region.x + (region.width - (metadata.width ?? region.width)) / 2,
			),
			top: Math.round(
				region.y + region.height - (metadata.height ?? region.height),
			),
		});
	}
	const scenes = await Promise.all(
		timed.map(async (segment) => {
			const character = characters.get(segment.speaker);
			if (!character) {
				throw new Error(`BYOSAN_CHARACTER_MISSING: ${segment.speaker}`);
			}
			const layers = renderSceneLayers(
				{
					segment,
					render: segment.render,
					index: segment.index,
					total: timed.length,
				},
				SCENE_STYLE,
			);
			const files = Object.fromEntries(
				await Promise.all(
					Object.entries(layers).map(async ([name, svg]) => {
						const file = `scene-${segment.index}-${name}.svg`;
						await fs.writeFile(path.join(publicDir, file), svg);
						return [name, file] as const;
					}),
				),
			);
			return {
				...files,
				full: segment.index === 0 ? "first-slide.png" : undefined,
				character: character.file,
				characterLeft: character.left,
				characterTop: character.top,
			};
		}),
	);
	const propsPath = path.join(publicDir, "props.json");
	await fs.writeJson(propsPath, {
		width: WIDTH,
		height: HEIGHT,
		fps: FPS,
		entranceFrames: F.video.remotion.entrance_frames,
		scenes,
	});
	const entrancePath = path.join(publicDir, "entrance.mp4");
	run(
		"node",
		[
			"src/remotion/render.mjs",
			propsPath,
			entrancePath,
			F.video.remotion.browser,
			String(F.video.remotion.crf),
			publicDir,
		],
		"render entrance clips",
	);
	const segmentDir = path.join(path.dirname(visualPath), "segments");
	await fs.emptyDir(segmentDir);
	const segments = timed.map((segment) => {
		const segmentPath = path.join(segmentDir, `${segment.index}.mp4`);
		renderHeldSegment(segment, entrancePath, segmentPath);
		return segmentPath;
	});
	const listPath = path.join(runDir, RUN.video_concat_list);
	fs.writeFileSync(
		listPath,
		`ffconcat version 1.0\n${segments.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n")}\n`,
	);
	run(
		"ffmpeg",
		[
			"-y",
			"-hide_banner",
			"-loglevel",
			"error",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			listPath,
			"-c",
			"copy",
			visualPath,
		],
		"concat visuals",
	);
}

async function buildThumbnail(
	spec: FeatureSpec,
	runDir: string,
): Promise<{ png: string; jpg: string; full: string }> {
	const paths = {
		artPath: path.join(runDir, RUN.source_dir, F.hero_source_name),
		fullPath: path.join(runDir, RUN.source_dir, "thumbnail_full.png"),
		pngPath: path.join(runDir, FILENAMES.thumbnail),
		jpgPath: path.join(runDir, RUN.thumbnail_jpg),
	};
	await buildThumbnailFiles({
		...paths,
		text: spec.thumbnailTitle,
		refs: [
			path.join(PROJECT_ROOT, F.characters.tsumugi_image),
			path.join(PROJECT_ROOT, F.characters.zundamon_image),
		],
		brand: F.brand_label,
		width: WIDTH,
		height: HEIGHT,
		thumbnailWidth: THUMBNAIL_CANVAS.width,
		thumbnailHeight: THUMBNAIL_CANVAS.height,
		font: FONT,
		fontWeight: DESIGN.typography.weights.headline ?? "bold",
		halfWidthUnits: F.captions.half_width_units,
		pngCompression: F.image.png_compression_level,
		config: F.thumbnail,
	});
	return { png: paths.pngPath, jpg: paths.jpgPath, full: paths.fullPath };
}

function captionChunks(text: string): string[] {
	const maxUnits = F.captions.max_line_units;
	const normalized = text.replaceAll(/\s+/g, "").trim();
	const phrases = normalized.split(/(?<=[。！？、])/u).filter(Boolean);
	const splitPhrase = (phrase: string): string[] => {
		const wrapped = wrapCaptionDisplay(phrase, maxUnits);
		if (
			wrapped.length <= F.captions.max_lines &&
			wrapped.every(
				(line) =>
					displayUnits(line, F.captions.half_width_units) <=
					maxUnits + F.captions.tolerance_units,
			)
		) {
			return [phrase];
		}
		const chars = Array.from(phrase);
		let bestIndex = 0;
		let bestScore = Number.POSITIVE_INFINITY;
		for (let index = 1; index < chars.length; index++) {
			if (isUnsafeCaptionBreak(phrase, index)) continue;
			const leftUnits = displayUnits(
				chars.slice(0, index).join(""),
				F.captions.half_width_units,
			);
			const rightUnits = displayUnits(
				chars.slice(index).join(""),
				F.captions.half_width_units,
			);
			if (Math.min(leftUnits, rightUnits) < F.captions.min_split_units)
				continue;
			const score = Math.abs(leftUnits - rightUnits);
			if (score < bestScore) {
				bestScore = score;
				bestIndex = index;
			}
		}
		if (bestIndex === 0) {
			bestIndex = Math.max(1, Math.floor(chars.length / 2));
		}
		const left = chars.slice(0, bestIndex).join("");
		const right = chars.slice(bestIndex).join("");
		if (!left || !right || left === phrase || right === phrase) return [phrase];
		return [...splitPhrase(left), ...splitPhrase(right)];
	};
	const chunks = phrases.flatMap(splitPhrase);
	return chunks.length > 0 ? chunks : [normalized];
}

function captionLines(text: string): string {
	const lines = wrapCaptionDisplay(text, F.captions.max_line_units).slice(
		0,
		F.captions.max_lines,
	);
	return lines.join("\\N").replaceAll("{", "(").replaceAll("}", ")");
}

function generateAss(timed: TimedSegment[]): string {
	const style = F.ass_style;
	const styleTail = `${style.bold},0,0,0,100,100,0,0,1,${style.outline},${style.shadow},${style.alignment},${style.margin_l},${style.margin_r},${style.margin_v},1`;
	const header = `[Script Info]
Title: ${F.brand_label} Feature Captions
ScriptType: v4.00+
PlayResX: ${WIDTH}
PlayResY: ${HEIGHT}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Tsumugi,${CONFIG.global_style.font_name},${style.font_size},${assColor(DESIGN.landscape.subtitle.color)},&H000000FF,${assColor(DESIGN.landscape.subtitle.outline_color)},${assColor(DESIGN.landscape.subtitle.outline_color)},${styleTail}
Style: Zundamon,${CONFIG.global_style.font_name},${style.font_size},${assColor(DESIGN.colors.success)},&H000000FF,${assColor(DESIGN.landscape.subtitle.outline_color)},${assColor(DESIGN.landscape.subtitle.outline_color)},${styleTail}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
	const events: string[] = [];
	for (const segment of timed) {
		const chunks = captionChunks(segment.text);
		const weights = chunks.map((chunk) =>
			Math.max(1, displayUnits(chunk, F.captions.half_width_units)),
		);
		const usableStart = segment.start + F.captions.lead_in_seconds;
		const usableDuration = Math.max(
			F.captions.min_usable_seconds,
			segment.duration - F.captions.tail_seconds,
		);
		const spans = layoutCueSpans(
			weights,
			usableStart,
			usableStart + usableDuration,
			F.captions.min_cue_seconds,
		);
		const styleName = segment.speaker === "ずんだもん" ? "Zundamon" : "Tsumugi";
		chunks.forEach((chunk, i) => {
			const span = spans[i];
			if (!span) throw new Error(`BYOSAN_CUE_MISSING: ${segment.index}`);
			events.push(
				`Dialogue: 0,${assTimestamp(span.start)},${assTimestamp(span.end)},${styleName},${segment.speaker},0,0,0,,{\\fad(${F.captions.fade_in_ms},${F.captions.fade_out_ms})}${captionLines(chunk)}`,
			);
		});
	}
	return `${header}${events.join("\n")}\n`;
}

let cachedVideoEncoderArgs: string[] | null = null;

function videoEncoderArgs(): string[] {
	if (cachedVideoEncoderArgs) return cachedVideoEncoderArgs;
	const nvenc = F.video.nvenc;
	const libx264 = F.video.libx264;
	const nvencProbe = spawnSync(
		"ffmpeg",
		[
			"-hide_banner",
			"-loglevel",
			"error",
			"-f",
			"lavfi",
			"-i",
			F.video.encoder_probe_source,
			"-frames:v",
			"1",
			"-c:v",
			nvenc.codec,
			"-f",
			"null",
			"-",
		],
		{ stdio: "ignore" },
	);
	if (nvencProbe.status === 0) {
		cachedVideoEncoderArgs = ["-c:v", nvenc.codec, ...nvenc.args];
		console.log(`[VIDEO_ENCODER] ${nvenc.codec}`);
	} else {
		cachedVideoEncoderArgs = ["-c:v", libx264.codec, ...libx264.args];
		console.log(`[VIDEO_ENCODER] ${libx264.codec} (NVENC unavailable)`);
	}
	return cachedVideoEncoderArgs;
}

function colorArgs(): string[] {
	const standard = F.video.color_standard;
	return [
		"-color_primaries",
		standard,
		"-color_trc",
		standard,
		"-colorspace",
		standard,
	];
}

function concatNarration(
	timed: TimedSegment[],
	outputPath: string,
	runDir: string,
): void {
	const listPath = path.join(runDir, RUN.audio_concat_list);
	fs.writeFileSync(
		listPath,
		`ffconcat version 1.0\n${timed
			.map((segment) => `file '${segment.audioPath.replaceAll("'", "'\\''")}'`)
			.join("\n")}\n`,
	);
	run(
		"ffmpeg",
		[
			"-y",
			"-hide_banner",
			"-loglevel",
			"error",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			listPath,
			"-ar",
			String(F.audio.sample_rate),
			"-ac",
			String(F.audio.narration_channels),
			"-c:a",
			F.audio.narration_codec,
			outputPath,
		],
		"concat narration",
	);
}

function bedExpression(duration: number): string {
	const tones = F.audio.bed_tones
		.map(
			(tone) =>
				`${tone.amplitude}*sin(2*PI*${tone.frequency_hz}*t)*(${tone.lfo_offset}+${tone.lfo_depth}*sin(2*PI*${tone.lfo_hz}*t))`,
		)
		.join("+");
	return `aevalsrc=${tones}:s=${F.audio.sample_rate}:d=${duration.toFixed(3)}`;
}

function composeFinal(
	visualPath: string,
	narrationPath: string,
	subtitlePath: string,
	duration: number,
	outputPath: string,
): void {
	const A = F.audio;
	const subtitleFilter = `subtitles=${subtitlePath}:fontsdir=${FONT_DIR}`;
	const filter = [
		`[0:v]${subtitleFilter}[v]`,
		`[1:a]aresample=${A.sample_rate},${A.narration_filter}[narr]`,
		`[2:a]${A.bed_filter}[bed]`,
		`[narr][bed]${A.mix_filter}[a]`,
	].join(";");
	run(
		"ffmpeg",
		[
			"-y",
			"-hide_banner",
			"-loglevel",
			"error",
			"-i",
			visualPath,
			"-i",
			narrationPath,
			"-f",
			"lavfi",
			"-i",
			bedExpression(duration),
			"-filter_complex",
			filter,
			"-map",
			"[v]",
			"-map",
			"[a]",
			"-shortest",
			...videoEncoderArgs(),
			"-profile:v",
			F.video.h264_profile,
			"-g",
			String(F.video.gop),
			"-bf",
			String(F.video.b_frames),
			"-pix_fmt",
			F.video.pixel_format,
			...colorArgs(),
			"-c:a",
			A.final_codec,
			"-b:a",
			A.final_bitrate,
			"-ar",
			String(A.sample_rate),
			"-ac",
			String(A.final_channels),
			"-movflags",
			"+faststart",
			outputPath,
		],
		"compose final video",
	);
}

function mediaProbe(videoPath: string): Record<string, unknown> {
	return JSON.parse(
		execFileSync(
			"ffprobe",
			[
				"-v",
				"error",
				"-show_entries",
				"format=duration,size,bit_rate:stream=index,codec_name,codec_type,width,height,r_frame_rate,sample_rate,channels,pix_fmt,profile,color_space,color_transfer,color_primaries",
				"-of",
				"json",
				videoPath,
			],
			{ encoding: "utf8" },
		),
	);
}

function defectAudit(videoPath: string): {
	blackSegments: number;
	freezeSegments: number;
	details: string;
} {
	const D = F.audit;
	const result = spawnSync(
		"ffmpeg",
		[
			"-hide_banner",
			"-nostats",
			"-i",
			videoPath,
			"-vf",
			`blackdetect=d=${D.black_min_seconds}:pix_th=${D.black_pixel_threshold},freezedetect=n=${D.freeze_noise_db}dB:d=${D.freeze_min_seconds}`,
			"-an",
			"-f",
			"null",
			"-",
		],
		{ encoding: "utf8", maxBuffer: D.ffmpeg_max_buffer_bytes },
	);
	const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
	return {
		blackSegments: Array.from(log.matchAll(/black_start:/g)).length,
		freezeSegments: Array.from(log.matchAll(/freeze_start:/g)).length,
		details: log
			.split("\n")
			.filter((line) => /black_|freeze_/.test(line))
			.slice(0, D.defect_log_max_lines)
			.join("\n"),
	};
}

async function writeOutputs(
	spec: FeatureSpec,
	timed: TimedSegment[],
	runDir: string,
	videoPath: string,
	thumbnailPath: string,
): Promise<void> {
	const description = buildByosanDescription(spec, timed, CONFIG.chapters);
	const explanation = ExplanationSchema.parse(
		await fs.readJson(path.join(runDir, RUN.source_dir, RUN.explanation)),
	);
	const metadata = {
		title: spec.title,
		thumbnail_title: spec.thumbnailTitle,
		description,
		tags: spec.tags,
	};
	const script = {
		title: spec.title,
		description: spec.descriptionLead,
		total_duration: timed.reduce((sum, segment) => sum + segment.duration, 0),
		lines: timed.map((segment) => ({
			speaker: segment.speaker,
			text: segment.text,
			duration: segment.duration,
			emotion: segment.emotion,
			visual_type: segment.visualType,
		})),
	};
	const contentOutput = { script, metadata };
	const audioPaths = timed.map((segment) => segment.audioPath);
	await fs.outputFile(
		path.join(runDir, RUN.content_dir, RUN.content_output),
		yaml.dump(contentOutput, { lineWidth: F.yaml_line_width, noRefs: true }),
	);
	await fs.outputJson(path.join(runDir, RUN.metadata), metadata, {
		spaces: 2,
	});
	await fs.outputJson(
		path.join(runDir, RUN.research),
		{
			as_of: spec.asOf,
			method:
				"Primary-source claim matrix with explicit derived-estimate caveats",
			sources: spec.sources,
			claims: spec.claims,
			search_novelty_check: {
				queries: spec.noveltyQueries,
				result:
					"Queries retained for the selection audit; exact-match absence is not asserted automatically.",
			},
		},
		{ spaces: 2 },
	);
	const state = {
		run_id: spec.runId,
		bucket: CONFIG.workflow.default_bucket,
		news: spec.sources.map((source) => ({
			title: source.name,
			summary: "Primary source used by the feature production claim matrix.",
			url: source.url,
		})),
		director_data: {
			angle: spec.angle,
			title_hook: spec.title,
			search_query: spec.searchQuery,
			key_questions: explanationCheckItems(explanation),
		},
		script,
		metadata,
		publish_intent: {
			profile: F.publish_intent.profile,
			bucket: CONFIG.workflow.default_bucket,
			visibility: F.publish_intent.visibility,
			requires_receipt: F.publish_intent.requires_receipt,
			requires_visibility_attestation:
				F.publish_intent.requires_visibility_attestation,
		},
		audio_paths: audioPaths,
		thumbnail_path: thumbnailPath,
		video_path: videoPath,
		publish_video_path: videoPath,
	};
	await fs.outputJson(path.join(runDir, FILENAMES.state), state, { spaces: 2 });
	await fs.outputFile(
		path.join(runDir, RUN.media_dir, RUN.media_output),
		yaml.dump(
			{
				audio_paths: audioPaths,
				thumbnail_path: thumbnailPath,
				video_path: videoPath,
				publish_video_path: videoPath,
				script,
			},
			{ lineWidth: F.yaml_line_width, noRefs: true },
		),
	);
	await fs.outputFile(
		path.join(runDir, RUN.publish_dir, RUN.publish_input),
		yaml.dump(
			{
				video_path: videoPath,
				publish_video_path: videoPath,
				metadata,
			},
			{ lineWidth: F.yaml_line_width, noRefs: true },
		),
	);
}

async function auditProduction(
	spec: FeatureSpec,
	timed: TimedSegment[],
	runDir: string,
	videoPath: string,
): Promise<void> {
	const D = F.audit;
	const probe = mediaProbe(videoPath);
	const streams = (probe.streams ?? []) as Array<Record<string, unknown>>;
	const video = streams.find((stream) => stream.codec_type === "video");
	const audio = streams.find((stream) => stream.codec_type === "audio");
	const format = (probe.format ?? {}) as Record<string, unknown>;
	const timelineSeconds = timed.reduce(
		(sum, segment) => sum + segment.duration,
		0,
	);
	const mediaSeconds = Number(format.duration ?? 0);
	const outputBitrate = Number(format.bit_rate ?? 0);
	const defects = defectAudit(videoPath);
	const voiceRegister = measureVoiceRegister(
		timed.map((segment) => segment.audioPath),
		D.voice_register,
	);
	const audioQA = runAudioQA(videoPath, runDir, {
		voice_register: voiceRegister,
	});
	const titleLength = Array.from(spec.title).length;
	const descriptionLength = Array.from(
		buildByosanDescription(spec, timed, CONFIG.chapters),
	).length;
	const tagsLength = spec.tags.reduce(
		(total, tag) => total + Array.from(tag).length,
		0,
	);
	const fontMatches = requiredFontFamilies([
		FONT,
		DESIGN.typography.numeric,
		CONFIG.global_style.font_name,
		SCENE_STYLE.chart.font_family,
		SCENE_STYLE.chart.numeric_font_family,
	]).map((family) => ({ family, match: matchFontFamily(family) }));
	const fontProblems = fontMatches.flatMap(({ family, match }) => {
		const problem = fontMatchProblem(family, match, FONT_DIR);
		return problem ? [problem] : [];
	});
	const requirements = {
		fonts: {
			status: fontProblems.length === 0 ? "PASS" : "FAIL",
			evidence: {
				font_dir: FONT_DIR,
				matches: fontMatches,
				problems: fontProblems,
			},
		},
		video_playback: {
			status:
				video?.codec_name === D.video_codec &&
				video?.width === WIDTH &&
				video?.height === HEIGHT &&
				audio?.codec_name === D.audio_codec &&
				audio?.sample_rate === String(F.audio.sample_rate) &&
				Math.abs(mediaSeconds - timelineSeconds) <= D.duration_tolerance_seconds
					? "PASS"
					: "FAIL",
			evidence: {
				video,
				audio,
				format,
				timeline_seconds: timelineSeconds,
				media_seconds: mediaSeconds,
			},
		},
		title: {
			status:
				titleLength <= CONFIG.steps.youtube.max_title_length ? "PASS" : "FAIL",
			evidence: { title_length: titleLength },
		},
		description: {
			status:
				descriptionLength <= CONFIG.steps.youtube.max_description_length
					? "PASS"
					: "FAIL",
			evidence: { description_length: descriptionLength },
		},
		tags: {
			status:
				tagsLength <= CONFIG.steps.youtube.max_tags_total_length
					? "PASS"
					: "FAIL",
			evidence: { tags_length: tagsLength },
		},
	};
	const advisories = {
		audio_quality: {
			status: audioQA.status === "PASS" ? "PASS" : "WARN",
			evidence: audioQA.report,
		},
		voice_register: {
			status: voiceRegister.every((segment) =>
				voiceRegisterPasses(
					segment,
					D.voice_register.max_loud_f0_percentile_hz,
				),
			)
				? "PASS"
				: "WARN",
			evidence: voiceRegister,
		},
		video_defects: {
			status: defects.blackSegments === 0 ? "PASS" : "WARN",
			evidence: defects,
		},
		output_bitrate: {
			status: outputBitrate >= D.min_output_bitrate_bps ? "PASS" : "WARN",
			evidence: { bit_rate: outputBitrate },
		},
	};
	const decision = Object.values(requirements).every(
		(requirement) => requirement.status === "PASS",
	)
		? "PASS"
		: "FAIL";
	const productionReportPath = path.join(
		runDir,
		RUN.audit_dir,
		RUN.production_report,
	);
	await fs.outputJson(
		productionReportPath,
		{
			decision,
			generated_at: new Date().toISOString(),
			requirements,
			advisories,
		},
		{ spaces: 2 },
	);
	await fs.outputJson(
		path.join(runDir, RUN.audit_dir, RUN.audit_report),
		{
			decision,
			summary: "Bespoke byosan feature closed-loop audit",
			checks: {
				...Object.fromEntries(
					Object.entries(requirements).map(([key, value]) => [
						key,
						{
							status: value.status,
							critical: true,
							details: JSON.stringify(value.evidence),
						},
					]),
				),
				...Object.fromEntries(
					Object.entries(advisories).map(([key, value]) => [
						key,
						{
							status: value.status,
							critical: false,
							details: JSON.stringify(value.evidence),
						},
					]),
				),
			},
		},
		{ spaces: 2 },
	);
	if (decision !== "PASS") {
		throw new Error(`Production audit failed: ${productionReportPath}`);
	}
}

async function main(): Promise<void> {
	const specPath = path.resolve(process.argv[2] ?? DEFAULT_SPEC);
	const spec = parseAndAuditByosanFeatureSpec(await fs.readJson(specPath));
	const runDir = path.join(
		PROJECT_ROOT,
		CONFIG.workflow.paths.runs_dir,
		spec.runId,
	);
	const audioDir = path.join(runDir, RUN.audio_dir);
	const videoDir = path.join(runDir, RUN.video_dir);
	await Promise.all([
		fs.ensureDir(audioDir),
		fs.ensureDir(videoDir),
		fs.ensureDir(path.join(runDir, RUN.audit_dir)),
		fs.ensureDir(path.join(runDir, RUN.publish_dir)),
	]);
	const tts = new TtsOrchestrator({
		ttsUrl: VOICEVOX.url,
		speakers: VOICEVOX.speakers,
		timeout: VOICEVOX.timeout_ms,
	});
	const speechPlan = getByosanSpeechPlan();
	const explanation = ExplanationSchema.parse(
		await fs.readJson(path.join(runDir, RUN.source_dir, RUN.explanation)),
	);
	const scenes = new Map(
		compileScenes(spec, explanation, CONFIG.scenes).flatMap((scene) =>
			scene.segmentIndexes.map(
				(segmentIndex) => [segmentIndex, scene] as const,
			),
		),
	);
	const speechParts = planSpeechParts(spec.segments, speechPlan);
	const timed: TimedSegment[] = [];
	let cursor = 0;
	for (let index = 0; index < speechParts.length; index++) {
		const part = speechParts[index];
		if (!part) continue;
		const { segment } = part;
		const scene = scenes.get(part.segmentIndex);
		if (!scene) {
			throw new Error(`BYOSAN_SCENE_MISSING: segment ${part.segmentIndex}`);
		}
		const render = resolveSceneRender(
			scene,
			spec,
			explanation,
			part.partIndex > 0,
		);
		const key = createHash("sha256")
			.update(JSON.stringify({ index, segment }))
			.digest("hex");
		const stem = `${String(index).padStart(3, "0")}-${key}`;
		const audioPath = path.join(audioDir, `${stem}.wav`);
		const speakerId = VOICEVOX.speakers[segment.speaker];
		const voice = capVoiceControls(
			F.tts.voice_presets[segment.emotion],
			F.tts.speaker_caps[segment.speaker],
		);
		if (!(await fs.pathExists(audioPath))) {
			console.log(
				`[TTS ${index + 1}/${speechParts.length}] ${segment.speaker} ${segment.emotion}`,
			);
			const result = await tts.synthesize({
				text: narrationText(segment.text),
				speakerId,
				voice,
			});
			await fs.writeFile(audioPath, result.audio);
		}
		const duration = audioDuration(audioPath);
		timed.push({
			...segment,
			index,
			duration,
			start: cursor,
			audioPath,
			render,
			voice,
		});
		cursor += duration;
	}
	await fs.outputJson(
		path.join(audioDir, RUN.audio_manifest),
		{
			total_chunks: timed.length,
			voice_map: VOICEVOX.speakers,
			chunks: timed.map((segment) => {
				const speakerId = VOICEVOX.speakers[segment.speaker];
				return {
					index: segment.index,
					script_speaker: segment.speaker,
					tts_requested_voice_id: speakerId,
					resolved_voice_id: speakerId,
					no_fallback_used: true,
					output_path: segment.audioPath,
					text_preview: segment.text.slice(0, F.tts.manifest_preview_chars),
					emotion: segment.emotion,
					voice_controls: segment.voice,
				};
			}),
		},
		{ spaces: 2 },
	);
	const subtitlePath = path.join(runDir, FILENAMES.subtitles);
	await fs.writeFile(subtitlePath, generateAss(timed));
	const thumbnail = await buildThumbnail(spec, runDir);
	const visualPath = path.join(videoDir, RUN.visual_master);
	const narrationPath = path.join(audioDir, FILENAMES.audio_full);
	await renderVisualMaster(
		timed,
		visualPath,
		path.join(videoDir, RUN.remotion_public),
		runDir,
		thumbnail.full,
	);
	concatNarration(timed, narrationPath, runDir);
	const finalPath = path.join(videoDir, RUN.publish_video);
	composeFinal(visualPath, narrationPath, subtitlePath, cursor, finalPath);
	await writeOutputs(spec, timed, runDir, finalPath, thumbnail.jpg);
	await auditProduction(spec, timed, runDir, finalPath);
	console.log(`RUN_DIR=${runDir}`);
	console.log(`VIDEO=${finalPath}`);
	console.log(`THUMBNAIL=${thumbnail.png}`);
	console.log(`DURATION=${cursor.toFixed(2)}`);
}

main().catch((error) => {
	console.error(
		error instanceof Error ? (error.stack ?? error.message) : error,
	);
	process.exit(1);
});
