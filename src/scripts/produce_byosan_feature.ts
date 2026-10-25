import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
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
	renderSceneSvg,
} from "../domain/byosan/scene_svg.js";
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
	scenePath: string;
	segmentVideoPath: string;
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

async function renderScene(
	segment: FeatureSegment,
	render: ByosanSceneRender,
	index: number,
	total: number,
	outputPath: string,
): Promise<void> {
	const base = Buffer.from(
		renderSceneSvg({ segment, render, index, total }, SCENE_STYLE),
	);
	const character = await characterBuffer(segment.speaker);
	const metadata = await sharp(character).metadata();
	const left =
		LANDSCAPE.character_region.x +
		(LANDSCAPE.character_region.width -
			(metadata.width ?? LANDSCAPE.character_region.width)) /
			2;
	const top =
		LANDSCAPE.character_region.y +
		LANDSCAPE.character_region.height -
		(metadata.height ?? LANDSCAPE.character_region.height);
	await sharp(base)
		.composite([
			{ input: character, left: Math.round(left), top: Math.round(top) },
		])
		.png({
			compressionLevel: F.image.png_compression_level,
			adaptiveFiltering: true,
		})
		.toFile(outputPath);
}

async function renderThumbnail(
	spec: FeatureSpec,
	runDir: string,
	heroPath: string,
): Promise<{ png: string; jpg: string }> {
	const thumbnailPng = path.join(runDir, FILENAMES.thumbnail);
	const thumbnailJpg = path.join(runDir, RUN.thumbnail_jpg);
	const T = F.thumbnail;
	const character = await sharp(await characterSourceBuffer("春日部つむぎ"))
		.trim({ background: F.image.trim_background })
		.resize({
			height: THUMBNAIL.character_zone.height,
			fit: "inside",
			withoutEnlargement: false,
		})
		.png()
		.toBuffer();
	const thumbnail = spec.thumbnail;
	const accentSize = THUMBNAIL.title_zone.font_size;
	const secondLineSize = THUMBNAIL.title_zone.font_size;
	const calloutTopSize = THUMBNAIL.subtitle.font_size;
	const calloutBottomSize = THUMBNAIL.subtitle.font_size;
	const overlay = Buffer.from(`
	<svg width="${THUMBNAIL_CANVAS.width}" height="${THUMBNAIL_CANVAS.height}" xmlns="http://www.w3.org/2000/svg">
		<defs>
			<style>text{font-family:'${FONT}',sans-serif}</style>
		</defs>
		<rect x="${THUMBNAIL.outer_frame.x}" y="${THUMBNAIL.outer_frame.y}" width="${THUMBNAIL.outer_frame.width}" height="${THUMBNAIL.outer_frame.height}" rx="${THUMBNAIL.outer_frame.radius}" fill="none" stroke="${THUMBNAIL.outer_frame.color}" stroke-opacity="${THUMBNAIL.outer_frame.opacity}" stroke-width="${THUMBNAIL.outer_frame.stroke_width}"/>
		<rect x="${THUMBNAIL.accent_rail.x}" y="${THUMBNAIL.accent_rail.y}" width="${THUMBNAIL.accent_rail.width}" height="${THUMBNAIL.accent_rail.height}" fill="${DESIGN.colors.brand_accent}"/>
		<rect x="${THUMBNAIL.brand_chip.x}" y="${THUMBNAIL.brand_chip.y}" width="${THUMBNAIL.brand_chip.width}" height="${THUMBNAIL.brand_chip.height}" rx="${THUMBNAIL.brand_chip.radius}" fill="${DESIGN.colors.surface}" stroke="${DESIGN.colors.brand_accent}" stroke-width="${DESIGN.stroke.default}"/>
		<text x="${THUMBNAIL.brand_chip.x + T.brand_text_inset_x}" y="${THUMBNAIL.brand_chip.y + T.brand_text_inset_y}" font-size="${THUMBNAIL.brand_chip.font_size}" font-weight="${THUMBNAIL.brand_chip.font_weight}" fill="${DESIGN.colors.text_primary}" letter-spacing="${T.brand_letter_spacing}">${xml(thumbnail.eyebrow)}</text>
		<text x="${THUMBNAIL.title_zone.x}" y="${THUMBNAIL.title_zone.y + THUMBNAIL.title_zone.font_size}" font-size="${accentSize}" font-weight="${THUMBNAIL.title_zone.font_weight}" fill="${THUMBNAIL.title_zone.fill}">${xml(thumbnail.lead)} ${xml(thumbnail.accent)}</text>
		<text x="${THUMBNAIL.title_zone.x}" y="${THUMBNAIL.title_zone.y + THUMBNAIL.title_zone.font_size + THUMBNAIL.title_zone.line_height}" font-size="${secondLineSize}" font-weight="${THUMBNAIL.title_zone.font_weight}" fill="${THUMBNAIL.title_zone.fill}">${xml(thumbnail.secondLine)} ${xml(thumbnail.reaction)}</text>
		<rect x="${THUMBNAIL.subtitle.x}" y="${THUMBNAIL.subtitle.baseline_y - THUMBNAIL.subtitle.font_size}" width="${THUMBNAIL.subtitle.width}" height="${THUMBNAIL.subtitle.font_size + T.top_callout_box_extra_height}" rx="${DESIGN.radius.medium}" fill="${DESIGN.colors.human_cream}"/>
		<text x="${THUMBNAIL.subtitle.x + T.callout_text_inset_x}" y="${THUMBNAIL.subtitle.baseline_y - T.top_callout_text_baseline_offset}" font-size="${calloutTopSize}" font-weight="${THUMBNAIL.subtitle.font_weight}" fill="${DESIGN.colors.text_dark}">${xml(thumbnail.calloutTop)}</text>
		<g transform="translate(${THUMBNAIL.subtitle.x},${THUMBNAIL.subtitle.baseline_y + T.bottom_callout_group_offset_y})">
			<rect width="${THUMBNAIL.subtitle.width}" height="${THUMBNAIL.subtitle.font_size + T.bottom_callout_box_extra_height}" rx="${DESIGN.radius.card}" fill="${DESIGN.colors.surface}" stroke="${LANDSCAPE.outer_frame.color}" stroke-width="${DESIGN.stroke.default}"/>
			<text x="${T.callout_text_inset_x}" y="${THUMBNAIL.subtitle.font_size + T.bottom_callout_text_baseline_offset}" font-size="${calloutBottomSize}" font-weight="${THUMBNAIL.title_zone.font_weight}" fill="${DESIGN.colors.text_primary}">${xml(thumbnail.calloutBottom)}</text>
		</g>
		<text x="${THUMBNAIL.brand_chip.x}" y="${THUMBNAIL_CANVAS.height - THUMBNAIL.safe_area.bottom}" font-size="${THUMBNAIL.brand_chip.font_size}" font-weight="${THUMBNAIL.brand_chip.font_weight}" fill="${DESIGN.colors.text_primary}" letter-spacing="${T.footer_letter_spacing}">${xml(F.brand_label)}</text>
	</svg>`);
	const composed = sharp(heroPath)
		.resize(THUMBNAIL_CANVAS.width, THUMBNAIL_CANVAS.height, {
			fit: "cover",
			position: "centre",
		})
		.composite([
			{ input: overlay, left: 0, top: 0 },
			{
				input: character,
				left: THUMBNAIL.character_zone.x,
				top: THUMBNAIL.character_zone.y,
			},
		]);
	await composed
		.clone()
		.png({ compressionLevel: F.image.png_compression_level })
		.toFile(thumbnailPng);
	await composed
		.clone()
		.jpeg({
			quality: T.jpeg_quality,
			chromaSubsampling: T.jpeg_chroma_subsampling,
		})
		.toFile(thumbnailJpg);
	return { png: thumbnailPng, jpg: thumbnailJpg };
}

async function ensureHeroSource(runDir: string): Promise<string> {
	const heroPath = path.join(runDir, RUN.source_dir, F.hero_source_name);
	if (await fs.pathExists(heroPath)) return heroPath;
	await fs.ensureDir(path.dirname(heroPath));
	await sharp({
		create: {
			width: WIDTH,
			height: HEIGHT,
			channels: F.image.hero_channels,
			background: VISUAL_IDENTITY.background,
		},
	})
		.png({ compressionLevel: F.image.png_compression_level })
		.toFile(heroPath);
	return heroPath;
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

function renderVisualSegment(segment: TimedSegment): void {
	const fadeInSeconds =
		segment.index === 0
			? F.video.first_fade_in_seconds
			: F.video.fade_in_seconds;
	const filter = [
		`scale=${WIDTH}:${HEIGHT}:flags=${F.video.scale_flags}`,
		staticSceneMotionFilter(FPS),
		`fade=t=in:st=0:d=${fadeInSeconds}`,
		`format=${F.video.pixel_format}`,
	].join(",");
	run(
		"ffmpeg",
		[
			"-y",
			"-hide_banner",
			"-loglevel",
			"error",
			"-loop",
			"1",
			"-framerate",
			String(FPS),
			"-i",
			segment.scenePath,
			"-t",
			segment.duration.toFixed(3),
			"-vf",
			filter,
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
			segment.segmentVideoPath,
		],
		`render visual segment ${segment.index}`,
	);
}

function concatVisuals(
	timed: TimedSegment[],
	outputPath: string,
	runDir: string,
): void {
	const listPath = path.join(runDir, RUN.video_concat_list);
	fs.writeFileSync(
		listPath,
		`ffconcat version 1.0\n${timed
			.map(
				(segment) =>
					`file '${segment.segmentVideoPath.replaceAll("'", "'\\''")}'`,
			)
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
			"-c",
			"copy",
			outputPath,
		],
		"concat visuals",
	);
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
	const sceneDir = path.join(runDir, RUN.scene_dir);
	const segmentVideoDir = path.join(runDir, RUN.segment_video_dir);
	const videoDir = path.join(runDir, RUN.video_dir);
	await Promise.all([
		fs.ensureDir(audioDir),
		fs.ensureDir(sceneDir),
		fs.ensureDir(segmentVideoDir),
		fs.ensureDir(videoDir),
		fs.ensureDir(path.join(runDir, RUN.audit_dir)),
		fs.ensureDir(path.join(runDir, RUN.publish_dir)),
	]);
	const heroPath = await ensureHeroSource(runDir);
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
		const sceneKey = createHash("sha256")
			.update(JSON.stringify({ segment, render }))
			.digest("hex");
		const stem = `${String(index).padStart(3, "0")}-${key}`;
		const audioPath = path.join(audioDir, `${stem}.wav`);
		const scenePath = path.join(sceneDir, `${stem}-${sceneKey}.png`);
		const segmentVideoPath = path.join(segmentVideoDir, `${stem}.mp4`);
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
		if (!(await fs.pathExists(scenePath))) {
			console.log(
				`[SCENE ${index + 1}/${speechParts.length}] ${segment.headline}`,
			);
			await renderScene(segment, render, index, speechParts.length, scenePath);
		}
		timed.push({
			...segment,
			index,
			duration,
			start: cursor,
			audioPath,
			scenePath,
			segmentVideoPath,
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
	const thumbnail = await renderThumbnail(spec, runDir, heroPath);
	for (const segment of timed) {
		if (!(await fs.pathExists(segment.segmentVideoPath))) {
			console.log(
				`[VIDEO ${segment.index + 1}/${timed.length}] ${segment.duration.toFixed(2)}s`,
			);
			renderVisualSegment(segment);
		}
	}
	const visualPath = path.join(videoDir, RUN.visual_master);
	const narrationPath = path.join(audioDir, FILENAMES.audio_full);
	concatVisuals(timed, visualPath, runDir);
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
