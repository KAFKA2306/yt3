import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
import sharp from "sharp";
import {
	type ByosanFeatureSegment,
	type ByosanFeatureSpec,
	type ByosanStatColor,
	parseAndAuditByosanFeatureSpec,
	staticSceneMotionFilter,
} from "../domain/byosan/feature_spec.js";
import {
	evaluateOpeningCatch,
	minimumCueSecondsAtAssPrecision,
	planSpeechSegments,
} from "../domain/byosan/production_audit.js";
import {
	BYOSAN_CONFIG_PATH,
	getByosanProductionConfig,
} from "../domain/byosan/production_config.js";
import { resolveByosanVisualIdentity } from "../domain/byosan/visual_identity.js";
import { getByosanVisualSystem } from "../domain/design/kafka_visual_system.js";
import { runAudioQA } from "../io/utils/audio_qa.js";
import {
	TtsOrchestrator,
	type TtsVoiceControls,
} from "../io/utils/tts_orchestrator.js";

type StatColor = ByosanStatColor;
type FeatureSegment = ByosanFeatureSegment;
type FeatureSpec = ByosanFeatureSpec;
type FeatureStat = FeatureSegment["stats"][number];

type TimedSegment = FeatureSegment & {
	index: number;
	duration: number;
	start: number;
	audioPath: string;
	scenePath: string;
	segmentVideoPath: string;
	voice: TtsVoiceControls;
};

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
const DEFAULT_SPEC = path.join(PROJECT_ROOT, F.default_spec);
const VISUAL_IDENTITY = resolveByosanVisualIdentity(
	yaml.load(fs.readFileSync(BYOSAN_CONFIG_PATH, "utf8")),
);

const COLORS: Record<StatColor, string> = {
	cyan: VISUAL_IDENTITY.brandAccent,
	amber: VISUAL_IDENTITY.warning,
	white: VISUAL_IDENTITY.textPrimary,
	muted: VISUAL_IDENTITY.textMuted,
};

function xml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function displayUnits(value: string): number {
	return Array.from(value).reduce(
		(total, char) =>
			total +
			((char.codePointAt(0) ?? 0) <= 0xff ? F.captions.half_width_units : 1),
		0,
	);
}

function wrapDisplay(value: string, maxUnits: number): string[] {
	const hardLines = value.split("\n");
	const result: string[] = [];
	for (const hardLine of hardLines) {
		let current = "";
		for (const char of Array.from(hardLine)) {
			if (current && displayUnits(`${current}${char}`) > maxUnits) {
				result.push(current);
				current = char;
			} else {
				current += char;
			}
		}
		if (current) result.push(current);
	}
	return result.length > 0 ? result : [""];
}

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
	if (displayUnits(value) <= maxUnits) return [value];
	const chars = Array.from(value);
	let bestIndex = 0;
	let bestScore = Number.POSITIVE_INFINITY;
	for (let index = 1; index < chars.length; index++) {
		if (isUnsafeCaptionBreak(value, index)) continue;
		const leftUnits = displayUnits(chars.slice(0, index).join(""));
		const rightUnits = displayUnits(chars.slice(index).join(""));
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
		return wrapDisplay(value, maxUnits).slice(0, F.captions.max_lines);
	return [chars.slice(0, bestIndex).join(""), chars.slice(bestIndex).join("")];
}

function tspans(
	lines: string[],
	x: number,
	y: number,
	lineHeight: number,
): string {
	return lines
		.map(
			(line, index) =>
				`<tspan x="${x}" y="${y + index * lineHeight}">${xml(line)}</tspan>`,
		)
		.join("");
}

function formatTimestamp(seconds: number): string {
	const rounded = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(rounded / 3600);
	const minutes = Math.floor((rounded % 3600) / 60);
	const secs = rounded % 60;
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
		: `${minutes}:${String(secs).padStart(2, "0")}`;
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

function statCard(
	stat: FeatureStat,
	x: number,
	y: number,
	width: number,
): string {
	const color = COLORS[stat.color];
	const valueUnits = displayUnits(stat.value);
	const compactValue = valueUnits > F.scene.stat_value_compact_threshold_units;
	const valueSize = compactValue
		? LANDSCAPE.stat_cards.value_compact_font_size
		: valueUnits > F.scene.stat_value_medium_threshold_units
			? LANDSCAPE.stat_cards.value_medium_font_size
			: LANDSCAPE.stat_cards.value_short_font_size;
	const valueLines = wrapDisplay(
		stat.value,
		compactValue
			? F.scene.stat_value_compact_wrap_units
			: F.scene.stat_value_wrap_units,
	).slice(0, F.scene.stat_value_max_lines);
	const textX = x + LANDSCAPE.stat_cards.padding_left;
	return `
		<g>
			<rect x="${x}" y="${y}" width="${width}" height="${LANDSCAPE.stat_cards.height}" rx="${LANDSCAPE.stat_cards.radius}" fill="${LANDSCAPE.stat_cards.fill}" fill-opacity="${LANDSCAPE.stat_cards.fill_opacity}" stroke="${color}" stroke-opacity="${LANDSCAPE.stat_cards.stroke_opacity}" stroke-width="${LANDSCAPE.stat_cards.stroke_width}"/>
			<rect x="${x}" y="${y}" width="${LANDSCAPE.stat_cards.accent_width}" height="${LANDSCAPE.stat_cards.accent_height}" rx="${LANDSCAPE.stat_cards.accent_radius}" fill="${color}"/>
			<text x="${textX}" y="${y + LANDSCAPE.stat_cards.label_baseline_offset}" class="stat-label">${xml(stat.label)}</text>
			<text x="${textX}" y="${y + LANDSCAPE.stat_cards.value_baseline_offset}" class="stat-value" font-size="${valueSize}" fill="${color}">${tspans(valueLines, textX, y + LANDSCAPE.stat_cards.value_baseline_offset, LANDSCAPE.stat_cards.value_line_height)}</text>
			<text x="${textX}" y="${y + LANDSCAPE.stat_cards.detail_baseline_offset}" class="stat-detail">${xml(stat.detail)}</text>
		</g>`;
}

function sceneSvg(
	segment: FeatureSegment,
	index: number,
	total: number,
): Buffer {
	const headlineLines = wrapDisplay(
		segment.headline,
		F.scene.headline_wrap_units,
	).slice(0, LANDSCAPE.headline.max_lines);
	const compactHeadline = headlineLines.some(
		(line) => displayUnits(line) > F.scene.headline_compact_threshold_units,
	);
	const headlineSize = compactHeadline
		? LANDSCAPE.headline.compact_font_size
		: LANDSCAPE.headline.default_font_size;
	const headlineLineHeight = compactHeadline
		? LANDSCAPE.headline.compact_line_height
		: LANDSCAPE.headline.default_line_height;
	const statCount = Math.max(1, segment.stats.length);
	const cardGap = LANDSCAPE.stat_cards.gap;
	const available = LANDSCAPE.data_region.width;
	const cardWidth = Math.floor(
		(available - cardGap * (statCount - 1)) / statCount,
	);
	const cards = segment.stats
		.map((stat, cardIndex) =>
			statCard(
				stat,
				LANDSCAPE.data_region.x + cardIndex * (cardWidth + cardGap),
				LANDSCAPE.data_region.y,
				cardWidth,
			),
		)
		.join("");
	const speakerColor =
		segment.speaker === "ずんだもん"
			? DESIGN.colors.success
			: VISUAL_IDENTITY.secondaryAccent;
	const accent =
		segment.emotion === "caution" || segment.emotion === "serious"
			? VISUAL_IDENTITY.warning
			: VISUAL_IDENTITY.primaryAccent;
	const emotionLabel = F.emotion_labels[segment.emotion];
	const Q = F.scene.question_mark;
	const questionMark =
		segment.visualType === "question"
			? `<text x="${LANDSCAPE.chart_region.x + LANDSCAPE.chart_region.width - Q.right_inset}" y="${LANDSCAPE.chart_region.y + Q.baseline_offset}" font-family="${FONT}" font-size="${Q.font_size}" font-weight="${DESIGN.typography.weights.headline}" fill="${VISUAL_IDENTITY.primaryAccent}" fill-opacity="${Q.opacity}">?</text>`
			: "";
	const P = F.scene.speaker_pointer;
	const characterX = LANDSCAPE.character_region.x;
	const characterBottom =
		LANDSCAPE.character_region.y + LANDSCAPE.character_region.height;
	return Buffer.from(`
	<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
		<defs>
			<style>
				text { font-family: '${FONT}', sans-serif; }
				.brand { fill:${DESIGN.colors.text_primary}; font-size:${LANDSCAPE.brand_chip.font_size}px; font-weight:${LANDSCAPE.brand_chip.font_weight}; letter-spacing:${LANDSCAPE.brand_chip.letter_spacing}px; }
				.section { fill:${DESIGN.colors.brand_accent}; font-size:${LANDSCAPE.section_label.font_size}px; font-weight:${LANDSCAPE.section_label.font_weight}; letter-spacing:${LANDSCAPE.section_label.letter_spacing}px; }
				.headline { fill:${DESIGN.colors.text_primary}; font-weight:${LANDSCAPE.headline.font_weight}; letter-spacing:${LANDSCAPE.headline.letter_spacing}px; }
				.subheadline { fill:${DESIGN.colors.text_secondary}; font-size:${LANDSCAPE.subheadline.font_size}px; font-weight:${LANDSCAPE.subheadline.font_weight}; }
				.stat-label { fill:${DESIGN.colors.text_secondary}; font-size:${LANDSCAPE.stat_cards.label_font_size}px; font-weight:${LANDSCAPE.stat_cards.label_font_weight}; letter-spacing:${LANDSCAPE.stat_cards.label_letter_spacing}px; }
				.stat-value { font-weight:${DESIGN.typography.weights.headline}; letter-spacing:${F.scene.stat_value_letter_spacing_px}px; }
				.stat-detail { fill:${DESIGN.colors.text_muted}; font-size:${LANDSCAPE.stat_cards.detail_font_size}px; font-weight:${LANDSCAPE.stat_cards.detail_font_weight}; }
				.source { fill:${DESIGN.colors.text_muted}; font-size:${LANDSCAPE.source.font_size}px; font-weight:${LANDSCAPE.source.font_weight}; }
			</style>
		</defs>
		<rect width="${WIDTH}" height="${HEIGHT}" fill="${DESIGN.colors.background}"/>
		<rect x="${LANDSCAPE.outer_frame.x}" y="${LANDSCAPE.outer_frame.y}" width="${LANDSCAPE.outer_frame.width}" height="${LANDSCAPE.outer_frame.height}" rx="${LANDSCAPE.outer_frame.radius}" fill="none" stroke="${LANDSCAPE.outer_frame.color}" stroke-opacity="${LANDSCAPE.outer_frame.opacity}" stroke-width="${LANDSCAPE.outer_frame.stroke_width}"/>
		<rect x="${LANDSCAPE.caption_band.x}" y="${LANDSCAPE.caption_band.y}" width="${LANDSCAPE.caption_band.width}" height="${LANDSCAPE.caption_band.height}" fill="${LANDSCAPE.caption_band.color}" fill-opacity="${LANDSCAPE.caption_band.opacity}"/>
		<rect x="${DESIGN.landscape.accent_rail.x}" y="${DESIGN.landscape.accent_rail.y}" width="${DESIGN.landscape.accent_rail.width}" height="${DESIGN.landscape.accent_rail.height}" fill="${accent}"/>
		<g transform="translate(${LANDSCAPE.brand_chip.x},${LANDSCAPE.brand_chip.y})">
			<rect width="${LANDSCAPE.brand_chip.width}" height="${LANDSCAPE.brand_chip.height}" rx="${LANDSCAPE.brand_chip.radius}" fill="${DESIGN.colors.surface}" stroke="${LANDSCAPE.outer_frame.color}" stroke-width="${DESIGN.stroke.default}"/>
			<text x="${LANDSCAPE.brand_chip.text_x - LANDSCAPE.brand_chip.x}" y="${LANDSCAPE.brand_chip.baseline_y - LANDSCAPE.brand_chip.y}" class="brand">${xml(F.brand_label)}</text>
		</g>
		<text x="${LANDSCAPE.section_counter.x}" y="${LANDSCAPE.section_counter.baseline_y}" class="section">${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}</text>
		<rect x="${LANDSCAPE.progress.x}" y="${LANDSCAPE.progress.y}" width="${LANDSCAPE.progress.width}" height="${LANDSCAPE.progress.height}" rx="${LANDSCAPE.progress.radius}" fill="${LANDSCAPE.progress.track}"/>
		<rect x="${LANDSCAPE.progress.x}" y="${LANDSCAPE.progress.y}" width="${Math.round(LANDSCAPE.progress.width * ((index + 1) / total))}" height="${LANDSCAPE.progress.height}" rx="${LANDSCAPE.progress.radius}" fill="${accent}"/>
		<text x="${LANDSCAPE.section_label.x}" y="${LANDSCAPE.section_label.baseline_y}" class="section">${xml(segment.section)}</text>
		<text x="${LANDSCAPE.headline.x}" y="${LANDSCAPE.headline.baseline_y}" class="headline" font-size="${headlineSize}">${tspans(headlineLines, LANDSCAPE.headline.x, LANDSCAPE.headline.baseline_y, headlineLineHeight)}</text>
		<text x="${LANDSCAPE.subheadline.x}" y="${headlineLines.length > 1 ? LANDSCAPE.subheadline.two_line_baseline_y : LANDSCAPE.subheadline.one_line_baseline_y}" class="subheadline">${xml(segment.subheadline)}</text>
		${cards}
		${questionMark}
			<path d="M${characterX + P.start_x} ${characterBottom - P.start_bottom} C${characterX + P.control1_x} ${characterBottom - P.control1_bottom} ${characterX + P.control2_x} ${characterBottom - P.control2_bottom} ${characterX + P.end_x} ${characterBottom - P.end_bottom}" fill="none" stroke="${speakerColor}" stroke-opacity="${P.stroke_opacity}" stroke-width="${P.stroke_width}" stroke-linecap="round"/>
			<circle cx="${characterX + P.start_x}" cy="${characterBottom - P.start_bottom}" r="${P.dot_radius}" fill="${speakerColor}"/>
		<g transform="translate(${LANDSCAPE.speaker_chip.x},${LANDSCAPE.speaker_chip.y})">
			<rect width="${LANDSCAPE.speaker_chip.width}" height="${LANDSCAPE.speaker_chip.height}" rx="${LANDSCAPE.speaker_chip.radius}" fill="${DESIGN.colors.surface}" stroke="${speakerColor}" stroke-width="${LANDSCAPE.speaker_chip.stroke_width}"/>
			<text x="${LANDSCAPE.speaker_chip.text_x - LANDSCAPE.speaker_chip.x}" y="${LANDSCAPE.speaker_chip.baseline_y - LANDSCAPE.speaker_chip.y}" font-size="${LANDSCAPE.speaker_chip.font_size}" font-weight="${LANDSCAPE.speaker_chip.font_weight}" fill="${speakerColor}">${xml(segment.speaker)}</text>
			<text x="${LANDSCAPE.speaker_chip.emotion_x - LANDSCAPE.speaker_chip.x}" y="${LANDSCAPE.speaker_chip.emotion_baseline_y - LANDSCAPE.speaker_chip.y}" text-anchor="end" font-size="${LANDSCAPE.speaker_chip.emotion_font_size}" font-weight="${LANDSCAPE.speaker_chip.emotion_font_weight}" fill="${DESIGN.colors.text_secondary}">${xml(emotionLabel)}</text>
		</g>
		<text x="${LANDSCAPE.source.x}" y="${LANDSCAPE.source.baseline_y}" class="source">${F.scene.source_label}  ${xml(segment.source)}</text>
	</svg>`);
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
	index: number,
	total: number,
	outputPath: string,
): Promise<void> {
	const base = sceneSvg(segment, index, total);
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
				(line) => displayUnits(line) <= maxUnits + F.captions.tolerance_units,
			)
		) {
			return [phrase];
		}
		const chars = Array.from(phrase);
		let bestIndex = 0;
		let bestScore = Number.POSITIVE_INFINITY;
		for (let index = 1; index < chars.length; index++) {
			if (isUnsafeCaptionBreak(phrase, index)) continue;
			const leftUnits = displayUnits(chars.slice(0, index).join(""));
			const rightUnits = displayUnits(chars.slice(index).join(""));
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
Style: Tsumugi,${FONT},${style.font_size},${assColor(DESIGN.landscape.subtitle.color)},&H000000FF,${assColor(DESIGN.landscape.subtitle.outline_color)},${assColor(DESIGN.landscape.subtitle.outline_color)},${styleTail}
Style: Zundamon,${FONT},${style.font_size},${assColor(DESIGN.colors.success)},&H000000FF,${assColor(DESIGN.landscape.subtitle.outline_color)},${assColor(DESIGN.landscape.subtitle.outline_color)},${styleTail}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
	const events: string[] = [];
	for (const segment of timed) {
		const chunks = captionChunks(segment.text);
		const weights = chunks.map((chunk) => Math.max(1, displayUnits(chunk)));
		const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
		const usableStart = segment.start + F.captions.lead_in_seconds;
		const usableDuration = Math.max(
			F.captions.min_usable_seconds,
			segment.duration - F.captions.tail_seconds,
		);
		let cursor = usableStart;
		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i] ?? "";
			const share = (weights[i] ?? 1) / totalWeight;
			const duration =
				i === chunks.length - 1
					? segment.start + segment.duration - cursor
					: usableDuration * share;
			const end = Math.max(
				cursor + F.captions.min_cue_seconds,
				cursor + duration,
			);
			const styleName =
				segment.speaker === "ずんだもん" ? "Zundamon" : "Tsumugi";
			events.push(
				`Dialogue: 0,${assTimestamp(cursor)},${assTimestamp(end)},${styleName},${segment.speaker},0,0,0,,{\\fad(${F.captions.fade_in_ms},${F.captions.fade_out_ms})}${captionLines(chunk)}`,
			);
			cursor = end;
		}
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
	const subtitleFilter = `subtitles=${subtitlePath}:fontsdir=${path.join(PROJECT_ROOT, path.dirname(CONFIG.global_style.font_path))}`;
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

function buildDescription(spec: FeatureSpec, timed: TimedSegment[]): string {
	const chapters = timed
		.filter((segment) => segment.chapter)
		.map((segment) => `${formatTimestamp(segment.start)} ${segment.chapter}`)
		.join("\n");
	const sources = spec.sources
		.map((source) => `${source.name}\n${source.url}`)
		.join("\n\n");
	const bullets = spec.descriptionBullets
		.map((bullet) => `・${bullet}`)
		.join("\n");
	return `${spec.descriptionLead}

この動画の要点
${bullets}

チャプター
${chapters}

一次資料
${sources}

※${spec.disclaimer}`;
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
	const description = buildDescription(spec, timed);
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
	thumbnailPath: string,
): Promise<void> {
	const D = F.audit;
	const openingCount = D.opening_segment_count;
	const probe = mediaProbe(videoPath);
	const streams = (probe.streams ?? []) as Array<Record<string, unknown>>;
	const video = streams.find((stream) => stream.codec_type === "video");
	const audio = streams.find((stream) => stream.codec_type === "audio");
	const outputBitrate = Number(
		(probe.format as Record<string, unknown> | undefined)?.bit_rate ?? 0,
	);
	const defects = defectAudit(videoPath);
	const audioQA = runAudioQA(videoPath, runDir);
	const subtitleText = await fs.readFile(
		path.join(runDir, FILENAMES.subtitles),
		"utf8",
	);
	const dialogueLines = subtitleText
		.split("\n")
		.filter((line) => line.startsWith("Dialogue:"));
	const tooManyLines = dialogueLines.filter(
		(line) => (line.match(/\\N/g) ?? []).length > 1,
	);
	const badLineBreaks = dialogueLines.filter((line) => {
		const visible = line
			.split(",")
			.slice(9)
			.join(",")
			.replaceAll(/\{[^}]+\}/g, "");
		const marker = visible.indexOf("\\N");
		if (marker < 0) return false;
		const joined = visible.replace("\\N", "");
		const breakIndex = Array.from(visible.slice(0, marker)).length;
		return isUnsafeCaptionBreak(joined, breakIndex);
	});
	const captionLineWidths = dialogueLines.flatMap((line) =>
		line
			.split(",")
			.slice(9)
			.join(",")
			.replaceAll(/\{[^}]+\}/g, "")
			.split("\\N")
			.map(displayUnits),
	);
	const maximumCaptionLineUnits = Math.max(...captionLineWidths);
	const maximumAllowedCaptionUnits =
		F.captions.max_line_units + F.captions.tolerance_units;
	const cues = dialogueLines.map((line) => {
		const fields = line.split(",");
		const toSeconds = (timestamp: string): number => {
			const [hours = "0", minutes = "0", seconds = "0"] = timestamp.split(":");
			return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
		};
		return {
			start: toSeconds(fields[1] ?? "0:0:0"),
			end: toSeconds(fields[2] ?? "0:0:0"),
		};
	});
	const overlappingCues = cues.filter(
		(cue, index) =>
			index > 0 && cue.start < (cues[index - 1]?.end ?? 0) - 0.001,
	);
	const minimumCueSeconds = minimumCueSecondsAtAssPrecision(cues);
	const maxSceneSeconds = Math.max(...timed.map((segment) => segment.duration));
	const titleLength = Array.from(spec.title).length;
	const sourceCoverage = spec.claims.every(
		(claim) =>
			claim.sourceIds.length > 0 &&
			claim.status.length > 0 &&
			claim.sourceIds.every((sourceId) =>
				spec.sources.some((source) => source.id === sourceId),
			),
	);
	const openingSegments = timed.slice(0, openingCount);
	if (!spec.packaging) throw new Error("BYOSAN_PACKAGING_MISSING");
	const opening = evaluateOpeningCatch({
		primaryClaimId: spec.packaging.primaryClaimId,
		claims: spec.claims,
		openingSegments,
	});
	const motionFilter = staticSceneMotionFilter(FPS);
	const forbiddenMotion = new RegExp(D.forbidden_motion_terms.join("|"));
	const motionPolicyPass =
		motionFilter === `fps=${FPS}` && !forbiddenMotion.test(motionFilter);
	const voiceEmotions = timed.every((segment) =>
		Object.hasOwn(F.tts.voice_presets, segment.emotion),
	);
	const requirements = {
		audio_quality: {
			status: audioQA.status === "PASS" ? "PASS" : "FAIL",
			evidence: audioQA.report,
		},
		video_quality: {
			status:
				video?.codec_name === D.video_codec &&
				video?.width === WIDTH &&
				video?.height === HEIGHT &&
				audio?.codec_name === D.audio_codec &&
				audio?.sample_rate === String(F.audio.sample_rate) &&
				outputBitrate >= D.min_output_bitrate_bps &&
				defects.blackSegments === 0
					? "PASS"
					: "FAIL",
			evidence: { video, audio, format: probe.format, defects },
		},
		catch: {
			status:
				titleLength <= CONFIG.steps.youtube.max_title_length && opening.passed
					? "PASS"
					: "FAIL",
			evidence: {
				title_length: titleLength,
				opening_seconds: openingSegments.reduce(
					(sum, segment) => sum + segment.duration,
					0,
				),
				opening: opening.evidence,
			},
		},
		content: {
			status: sourceCoverage ? "PASS" : "FAIL",
			evidence: {
				claims: spec.claims,
				source_count: spec.sources.length,
				caveats: spec.descriptionBullets,
				disclaimer: spec.disclaimer,
			},
		},
		intonation: {
			status: voiceEmotions ? "PASS" : "FAIL",
			evidence: {
				emotion_presets: timed.map((segment) => segment.emotion),
				manifest: path.join(runDir, RUN.audio_dir, RUN.audio_manifest),
			},
		},
		subtitles: {
			status:
				dialogueLines.length > timed.length &&
				tooManyLines.length === 0 &&
				badLineBreaks.length === 0 &&
				overlappingCues.length === 0 &&
				minimumCueSeconds >= F.captions.min_cue_seconds &&
				maximumCaptionLineUnits <= maximumAllowedCaptionUnits
					? "PASS"
					: "FAIL",
			evidence: {
				cue_count: dialogueLines.length,
				max_lines_per_cue: F.captions.max_lines,
				bad_line_breaks: badLineBreaks.length,
				overlapping_cues: overlappingCues.length,
				minimum_cue_seconds: minimumCueSeconds,
				maximum_line_display_units: maximumCaptionLineUnits,
				font_size: F.ass_style.font_size,
				bottom_safe_margin: F.ass_style.margin_v,
			},
		},
		motion: {
			status:
				maxSceneSeconds <= D.max_scene_seconds && motionPolicyPass
					? "PASS"
					: "FAIL",
			evidence: {
				scene_count: timed.length,
				max_scene_seconds: maxSceneSeconds,
				camera_motion:
					"static scene; no zoom, crop, pan, rotation, or oscillation",
				filter: motionFilter,
				static_scene: motionPolicyPass,
				no_camera_transform: motionPolicyPass,
				freeze_segments_diagnostic: defects.freezeSegments,
			},
		},
		gesture: {
			status: timed.some((segment) => segment.speaker === "春日部つむぎ")
				? "PASS"
				: "FAIL",
			evidence: {
				asset:
					"speaker-specific standing art; missing assets fail closed (BYOSAN_CHARACTER_ASSET_MISSING)",
				synchronization:
					"speaker-specific cutout, pointer line, emotion label, and stat target on every scene",
			},
		},
		thumbnail: {
			status:
				(await fs.stat(thumbnailPath)).size > D.min_thumbnail_bytes
					? "PASS"
					: "FAIL",
			evidence: {
				path: thumbnailPath,
				continuity: {
					thumbnail_title: spec.thumbnailTitle,
					opening: opening.evidence,
				},
			},
		},
	};
	const decision = Object.values(requirements).every(
		(requirement) => requirement.status === "PASS",
	)
		? "PASS"
		: "FAIL";
	await fs.outputJson(
		path.join(runDir, RUN.audit_dir, RUN.production_report),
		{
			decision,
			generated_at: new Date().toISOString(),
			requirements,
		},
		{ spaces: 2 },
	);
	await fs.outputJson(
		path.join(runDir, RUN.audit_dir, RUN.audit_report),
		{
			decision,
			summary: "Bespoke byosan feature closed-loop audit",
			checks: Object.fromEntries(
				Object.entries(requirements).map(([key, value]) => [
					key,
					{
						status: value.status,
						critical: true,
						details: JSON.stringify(value.evidence),
					},
				]),
			),
		},
		{ spaces: 2 },
	);
	if (decision !== "PASS") {
		throw new Error(
			`Production audit failed: ${path.join(runDir, RUN.audit_dir, RUN.production_report)}`,
		);
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
	const speechSegments = planSpeechSegments(spec.segments, {
		maxSceneSeconds: F.audit.max_scene_seconds,
		charsPerSecond: CONFIG.scenes.chars_per_second,
		minCueSeconds: F.captions.min_cue_seconds,
	});
	const timed: TimedSegment[] = [];
	let cursor = 0;
	for (let index = 0; index < speechSegments.length; index++) {
		const segment = speechSegments[index];
		if (!segment) continue;
		const key = createHash("sha256")
			.update(JSON.stringify({ index, segment }))
			.digest("hex");
		const stem = `${String(index).padStart(3, "0")}-${key}`;
		const audioPath = path.join(audioDir, `${stem}.wav`);
		const scenePath = path.join(sceneDir, `${stem}.png`);
		const segmentVideoPath = path.join(segmentVideoDir, `${stem}.mp4`);
		const speakerId = VOICEVOX.speakers[segment.speaker];
		const voice = F.tts.voice_presets[segment.emotion];
		if (!(await fs.pathExists(audioPath))) {
			console.log(
				`[TTS ${index + 1}/${speechSegments.length}] ${segment.speaker} ${segment.emotion}`,
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
				`[SCENE ${index + 1}/${speechSegments.length}] ${segment.headline}`,
			);
			await renderScene(segment, index, speechSegments.length, scenePath);
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
	await auditProduction(spec, timed, runDir, finalPath, thumbnail.png);
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
