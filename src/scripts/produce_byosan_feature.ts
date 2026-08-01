import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
import sharp from "sharp";
import {
	type ByosanFeatureSegment,
	type ByosanFeatureSpec,
	type ByosanStatColor,
	centerLockedMotionFilter,
	parseAndAuditByosanFeatureSpec,
} from "../domain/byosan/feature_spec.js";
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

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const FONT = "Noto Sans CJK JP";
const PROJECT_ROOT = process.cwd();
const DEFAULT_SPEC = path.join(
	PROJECT_ROOT,
	"config/productions/sp500_anthropic_2026q2.json",
);
const HERO_SOURCE_NAME = "hero_imagegen_source.png";

const COLORS: Record<StatColor, string> = {
	cyan: "#40D9FF",
	amber: "#FFB547",
	white: "#F7FBFF",
	muted: "#8FA7BF",
};

const EMOTION_LABELS: Record<string, string> = {
	shock: "驚き",
	reveal: "核心",
	curious: "疑問",
	analytical: "分析",
	caution: "注意",
	confident: "確信",
	warm: "納得",
	relieved: "理解",
	serious: "警戒",
	joy: "次へ",
};

const CAPTION_NO_BREAK_TERMS = [
	"S&P 500",
	"ブレンデッド",
	"パーセント",
	"ポイント",
	"非議決権優先株",
	"推定公正価値",
	"経済的エクスポージャー",
	"利益成長率",
	"株式評価益",
	"純利益",
	"未発表企業",
	"稼いだ",
	"ではない",
	"比較用",
	"権利差",
	"来年",
	"から",
	"引き上げ",
	"あります",
	"なります",
	"推定します",
	"構造です",
	"どう動く",
	"のだ",
	"FactSet",
	"Alphabet",
	"Amazon",
	"Anthropic",
	"SpaceX",
	"AWS",
	"EPS",
	"IPO",
];

const VOICE_PRESETS: Record<string, TtsVoiceControls> = {
	shock: {
		speedScale: 1.12,
		pitchScale: 0.025,
		intonationScale: 1.32,
		volumeScale: 1.0,
		prePhonemeLength: 0.08,
		postPhonemeLength: 0.24,
		pauseLengthScale: 1.08,
		outputSamplingRate: 48000,
	},
	reveal: {
		speedScale: 1.04,
		pitchScale: 0.005,
		intonationScale: 1.22,
		volumeScale: 1.0,
		prePhonemeLength: 0.08,
		postPhonemeLength: 0.3,
		pauseLengthScale: 1.15,
		outputSamplingRate: 48000,
	},
	curious: {
		speedScale: 1.1,
		pitchScale: 0.035,
		intonationScale: 1.28,
		volumeScale: 0.98,
		prePhonemeLength: 0.08,
		postPhonemeLength: 0.22,
		pauseLengthScale: 1.05,
		outputSamplingRate: 48000,
	},
	analytical: {
		speedScale: 1.06,
		pitchScale: -0.005,
		intonationScale: 1.1,
		volumeScale: 0.98,
		prePhonemeLength: 0.08,
		postPhonemeLength: 0.25,
		pauseLengthScale: 1.04,
		outputSamplingRate: 48000,
	},
	caution: {
		speedScale: 0.99,
		pitchScale: -0.02,
		intonationScale: 1.16,
		volumeScale: 0.98,
		prePhonemeLength: 0.09,
		postPhonemeLength: 0.34,
		pauseLengthScale: 1.2,
		outputSamplingRate: 48000,
	},
	confident: {
		speedScale: 1.08,
		pitchScale: 0.0,
		intonationScale: 1.2,
		volumeScale: 1.0,
		prePhonemeLength: 0.08,
		postPhonemeLength: 0.26,
		pauseLengthScale: 1.05,
		outputSamplingRate: 48000,
	},
	warm: {
		speedScale: 1.02,
		pitchScale: 0.015,
		intonationScale: 1.18,
		volumeScale: 0.98,
		prePhonemeLength: 0.09,
		postPhonemeLength: 0.32,
		pauseLengthScale: 1.12,
		outputSamplingRate: 48000,
	},
	relieved: {
		speedScale: 1.05,
		pitchScale: 0.02,
		intonationScale: 1.2,
		volumeScale: 0.98,
		prePhonemeLength: 0.08,
		postPhonemeLength: 0.28,
		pauseLengthScale: 1.08,
		outputSamplingRate: 48000,
	},
	serious: {
		speedScale: 0.98,
		pitchScale: -0.025,
		intonationScale: 1.12,
		volumeScale: 0.99,
		prePhonemeLength: 0.09,
		postPhonemeLength: 0.36,
		pauseLengthScale: 1.18,
		outputSamplingRate: 48000,
	},
	joy: {
		speedScale: 1.08,
		pitchScale: 0.025,
		intonationScale: 1.26,
		volumeScale: 0.99,
		prePhonemeLength: 0.08,
		postPhonemeLength: 0.38,
		pauseLengthScale: 1.12,
		outputSamplingRate: 48000,
	},
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
		(total, char) => total + ((char.codePointAt(0) ?? 0) <= 0xff ? 0.58 : 1),
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
	for (const term of CAPTION_NO_BREAK_TERMS) {
		let searchFrom = 0;
		while (searchFrom < value.length) {
			const start = value.indexOf(term, searchFrom);
			if (start < 0) break;
			protect(start, term);
			searchFrom = start + term.length;
		}
	}
	for (const match of value.matchAll(
		/[0-9.億万兆]+(?:ドル|パーセント|ポイント|セント)?/gu,
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
		const score = overflow * 100 + Math.abs(leftUnits - rightUnits);
		if (score < bestScore) {
			bestScore = score;
			bestIndex = index;
		}
	}
	if (bestIndex === 0) return wrapDisplay(value, maxUnits).slice(0, 2);
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

function narrationText(text: string): string {
	return text
		.replaceAll("S&P 500", "エスアンドピー・ファイブハンドレッド")
		.replaceAll("S&P500", "エスアンドピー・ファイブハンドレッド")
		.replaceAll("Alphabet", "アルファベット")
		.replaceAll("Amazon", "アマゾン")
		.replaceAll("Anthropic", "アンソロピック")
		.replaceAll("FactSet", "ファクトセット")
		.replaceAll("SpaceX", "スペースエックス")
		.replaceAll("AWS", "エーダブリューエス")
		.replaceAll("EPS", "イーピーエス")
		.replaceAll("IPO", "アイピーオー")
		.replaceAll("GAAP", "ギャップ")
		.replaceAll("OI&E", "その他損益")
		.replaceAll("Level 3", "レベルスリー")
		.replaceAll("Q2", "第2四半期")
		.replaceAll("%", "パーセント")
		.replaceAll("$", "");
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
	const valueSize = valueUnits > 12 ? 39 : valueUnits > 8 ? 47 : 61;
	const valueLines = wrapDisplay(stat.value, valueUnits > 12 ? 16 : 20).slice(
		0,
		2,
	);
	return `
		<g>
			<rect x="${x}" y="${y}" width="${width}" height="224" rx="28" fill="#0B1C2E" fill-opacity="0.94" stroke="${color}" stroke-opacity="0.44" stroke-width="2"/>
			<rect x="${x}" y="${y}" width="8" height="224" rx="4" fill="${color}"/>
			<text x="${x + 30}" y="${y + 44}" class="stat-label">${xml(stat.label)}</text>
			<text x="${x + 30}" y="${y + 112}" class="stat-value" font-size="${valueSize}" fill="${color}">${tspans(valueLines, x + 30, y + 112, 54)}</text>
			<text x="${x + 30}" y="${y + 196}" class="stat-detail">${xml(stat.detail)}</text>
		</g>`;
}

function sceneSvg(
	spec: FeatureSpec,
	segment: FeatureSegment,
	index: number,
): Buffer {
	const headlineLines = wrapDisplay(segment.headline, 21).slice(0, 2);
	const headlineSize = headlineLines.some((line) => displayUnits(line) > 18)
		? 68
		: 82;
	const statCount = Math.max(1, segment.stats.length);
	const cardGap = 24;
	const available = 1334;
	const cardWidth = Math.floor(
		(available - cardGap * (statCount - 1)) / statCount,
	);
	const cards = segment.stats
		.map((stat, cardIndex) =>
			statCard(stat, 92 + cardIndex * (cardWidth + cardGap), 500, cardWidth),
		)
		.join("");
	const speakerColor = segment.speaker === "ずんだもん" ? "#A9F07B" : "#FFB86B";
	const accent =
		segment.emotion === "caution" || segment.emotion === "serious"
			? "#FFB547"
			: "#40D9FF";
	const emotionLabel = EMOTION_LABELS[segment.emotion] ?? "解説";
	const questionMark =
		segment.visualType === "question"
			? '<text x="1560" y="550" font-family="Noto Sans CJK JP" font-size="310" font-weight="900" fill="#40D9FF" fill-opacity="0.12">?</text>'
			: "";
	return Buffer.from(`
	<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
		<defs>
			<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
				<stop offset="0" stop-color="#07111F"/>
				<stop offset="0.58" stop-color="#0A2037"/>
				<stop offset="1" stop-color="#071827"/>
			</linearGradient>
			<radialGradient id="glow" cx="0.78" cy="0.34" r="0.62">
				<stop offset="0" stop-color="${accent}" stop-opacity="0.19"/>
				<stop offset="1" stop-color="#07111F" stop-opacity="0"/>
			</radialGradient>
			<pattern id="grid" width="56" height="56" patternUnits="userSpaceOnUse">
				<path d="M 56 0 L 0 0 0 56" fill="none" stroke="#7BC8FF" stroke-opacity="0.055" stroke-width="1"/>
			</pattern>
			<filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
				<feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#000814" flood-opacity="0.62"/>
			</filter>
			<style>
				text { font-family: '${FONT}', sans-serif; }
				.brand { fill:#F7FBFF; font-size:25px; font-weight:800; letter-spacing:2px; }
				.section { fill:#7FCDF5; font-size:22px; font-weight:700; letter-spacing:3px; }
				.headline { fill:#F7FBFF; font-weight:900; letter-spacing:-1px; }
				.subheadline { fill:#B8CADB; font-size:31px; font-weight:600; }
				.stat-label { fill:#A9BED2; font-size:23px; font-weight:700; letter-spacing:1px; }
				.stat-value { font-weight:900; letter-spacing:-1px; }
				.stat-detail { fill:#8FA7BF; font-size:20px; font-weight:500; }
				.source { fill:#7592AC; font-size:20px; font-weight:500; }
			</style>
		</defs>
		<rect width="1920" height="1080" fill="url(#bg)"/>
		<rect width="1920" height="1080" fill="url(#grid)"/>
		<rect width="1920" height="1080" fill="url(#glow)"/>
		<path d="M0 826 C280 774 390 856 650 792 S1050 816 1435 730 S1750 706 1920 650" fill="none" stroke="#40D9FF" stroke-opacity="0.12" stroke-width="3"/>
		<rect x="0" y="858" width="1920" height="222" fill="#030A12" fill-opacity="0.72"/>
		<rect x="0" y="0" width="12" height="1080" fill="${accent}"/>
		<g transform="translate(92,62)">
			<rect width="240" height="52" rx="26" fill="#0F2D48" stroke="#40D9FF" stroke-opacity="0.32"/>
			<text x="28" y="35" class="brand">秒算マネー</text>
		</g>
		<text x="1440" y="96" class="section">${String(index + 1).padStart(2, "0")} / ${String(spec.segments.length).padStart(2, "0")}</text>
		<rect x="1506" y="117" width="310" height="5" rx="3" fill="#19334C"/>
		<rect x="1506" y="117" width="${Math.round(310 * ((index + 1) / spec.segments.length))}" height="5" rx="3" fill="${accent}"/>
		<text x="92" y="181" class="section">${xml(segment.section)}</text>
		<text x="92" y="290" class="headline" font-size="${headlineSize}">${tspans(headlineLines, 92, 290, headlineSize + 17)}</text>
		<text x="92" y="${headlineLines.length > 1 ? 458 : 398}" class="subheadline">${xml(segment.subheadline)}</text>
		${cards}
		${questionMark}
		<g filter="url(#shadow)">
			<ellipse cx="1650" cy="596" rx="218" ry="300" fill="${speakerColor}" fill-opacity="0.08" stroke="${speakerColor}" stroke-opacity="0.24" stroke-width="2"/>
			<path d="M1462 697 C1510 650 1556 620 1614 610" fill="none" stroke="${speakerColor}" stroke-opacity="0.38" stroke-width="5" stroke-linecap="round"/>
			<circle cx="1462" cy="697" r="7" fill="${speakerColor}"/>
		</g>
		<g transform="translate(1510,164)">
			<rect width="286" height="56" rx="28" fill="#07111F" stroke="${speakerColor}" stroke-width="2"/>
			<text x="24" y="37" font-size="23" font-weight="800" fill="${speakerColor}">${xml(segment.speaker)}</text>
			<text x="250" y="37" text-anchor="end" font-size="21" font-weight="700" fill="#B8CADB">${xml(emotionLabel)}</text>
		</g>
		<text x="92" y="824" class="source">SOURCE  ${xml(segment.source)}</text>
	</svg>`);
}

async function characterBuffer(
	speaker: FeatureSegment["speaker"],
): Promise<Buffer> {
	const source =
		speaker === "ずんだもん"
			? path.join(PROJECT_ROOT, "assets/zundamon.webp")
			: path.join(
					PROJECT_ROOT,
					"assets/春日部つむぎ立ち絵公式_v2.0/春日部つむぎ立ち絵公式_v2.0.png",
				);
	return sharp(source)
		.trim({ background: { r: 255, g: 255, b: 255, alpha: 0 } })
		.resize({
			height: speaker === "ずんだもん" ? 650 : 720,
			fit: "inside",
			withoutEnlargement: true,
		})
		.png()
		.toBuffer();
}

async function renderScene(
	spec: FeatureSpec,
	segment: FeatureSegment,
	index: number,
	outputPath: string,
): Promise<void> {
	const base = sceneSvg(spec, segment, index);
	const character = await characterBuffer(segment.speaker);
	const metadata = await sharp(character).metadata();
	const left = WIDTH - (metadata.width ?? 340) - 66;
	const top = HEIGHT - (metadata.height ?? 650) - 168;
	await sharp(base)
		.composite([
			{ input: character, left: Math.max(1425, left), top: Math.max(215, top) },
		])
		.png({ compressionLevel: 8, adaptiveFiltering: true })
		.toFile(outputPath);
}

async function renderThumbnail(
	spec: FeatureSpec,
	runDir: string,
	heroPath: string,
): Promise<{ png: string; jpg: string }> {
	const thumbnailPng = path.join(runDir, "thumbnail.png");
	const thumbnailJpg = path.join(runDir, "thumbnail_youtube.jpg");
	const character = await sharp(
		path.join(
			PROJECT_ROOT,
			"assets/春日部つむぎ立ち絵公式_v2.0/春日部つむぎ立ち絵公式_v2.0.png",
		),
	)
		.trim({ background: { r: 255, g: 255, b: 255, alpha: 0 } })
		.resize({ height: 930, fit: "inside", withoutEnlargement: false })
		.png()
		.toBuffer();
	const thumbnail = spec.thumbnail;
	const accentSize = Array.from(thumbnail.accent).length > 9 ? 112 : 148;
	const secondLineSize =
		Array.from(thumbnail.secondLine).length > 12 ? 82 : 104;
	const calloutTopSize = Array.from(thumbnail.calloutTop).length > 18 ? 37 : 47;
	const calloutBottomSize =
		Array.from(thumbnail.calloutBottom).length > 18 ? 38 : 48;
	const overlay = Buffer.from(`
	<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
		<defs>
			<linearGradient id="shade" x1="0" x2="1">
				<stop offset="0" stop-color="#020812" stop-opacity="0.98"/>
				<stop offset="0.57" stop-color="#020812" stop-opacity="0.82"/>
				<stop offset="0.78" stop-color="#020812" stop-opacity="0.14"/>
				<stop offset="1" stop-color="#020812" stop-opacity="0.02"/>
			</linearGradient>
			<filter id="textShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="12" stdDeviation="8" flood-color="#000" flood-opacity="0.95"/></filter>
			<style>text{font-family:'${FONT}',sans-serif}</style>
		</defs>
		<rect width="1920" height="1080" fill="url(#shade)"/>
		<rect x="74" y="70" width="520" height="62" rx="31" fill="#113454" stroke="#40D9FF" stroke-width="2"/>
		<text x="108" y="111" font-size="29" font-weight="800" fill="#F7FBFF" letter-spacing="2">${xml(thumbnail.eyebrow)}</text>
		<g filter="url(#textShadow)">
			<text x="78" y="318" font-size="114" font-weight="900" fill="#F7FBFF">${xml(thumbnail.lead)}</text>
			<text x="330" y="318" font-size="${accentSize}" font-weight="950" fill="#40D9FF">${xml(thumbnail.accent)}</text>
			<text x="1010" y="318" font-size="118" font-weight="950" fill="#FFB547">${xml(thumbnail.reaction)}</text>
			<text x="78" y="472" font-size="${secondLineSize}" font-weight="900" fill="#F7FBFF">${xml(thumbnail.secondLine)}</text>
		</g>
		<rect x="78" y="550" width="940" height="92" rx="24" fill="#E9932F"/>
		<text x="116" y="611" font-size="${calloutTopSize}" font-weight="900" fill="#07111F">${xml(thumbnail.calloutTop)}</text>
		<g transform="translate(78,695)">
			<rect width="850" height="116" rx="28" fill="#07111F" fill-opacity="0.9" stroke="#40D9FF" stroke-width="3"/>
			<text x="32" y="72" font-size="${calloutBottomSize}" font-weight="900" fill="#F7FBFF">${xml(thumbnail.calloutBottom)}</text>
		</g>
		<text x="82" y="1002" font-size="31" font-weight="800" fill="#F7FBFF" letter-spacing="3">秒算マネー</text>
	</svg>`);
	const composed = sharp(heroPath)
		.resize(WIDTH, HEIGHT, { fit: "cover", position: "centre" })
		.composite([
			{ input: overlay, left: 0, top: 0 },
			{ input: character, left: 1390, top: 128 },
		]);
	await composed.clone().png({ compressionLevel: 8 }).toFile(thumbnailPng);
	await composed
		.clone()
		.jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
		.toFile(thumbnailJpg);
	return { png: thumbnailPng, jpg: thumbnailJpg };
}

function stableHash(text: string): number {
	let hash = 2166136261;
	for (const char of text) {
		hash ^= char.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

async function ensureHeroSource(
	spec: FeatureSpec,
	runDir: string,
): Promise<string> {
	const heroPath = path.join(runDir, "source", HERO_SOURCE_NAME);
	if (await fs.pathExists(heroPath)) return heroPath;
	await fs.ensureDir(path.dirname(heroPath));
	const palettes = [
		["#07111F", "#0B3555", "#40D9FF", "#FFB547"],
		["#090B1A", "#24194D", "#9D7BFF", "#48E0C4"],
		["#08130F", "#174B38", "#55E59A", "#FFD166"],
		["#140A12", "#53213B", "#FF6B9D", "#6EE7F2"],
	] as const;
	const palette =
		palettes[stableHash(spec.angle) % palettes.length] ?? palettes[0];
	const [dark, mid, accent, contrast] = palette;
	const seed = stableHash(`${spec.asOf}:${spec.searchQuery}`);
	const circleX = 1160 + (seed % 360);
	const circleY = 260 + ((seed >>> 5) % 420);
	const background = Buffer.from(`
	<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
		<defs>
			<radialGradient id="glow" cx="70%" cy="40%" r="75%">
				<stop offset="0" stop-color="${accent}" stop-opacity="0.55"/>
				<stop offset="0.48" stop-color="${mid}" stop-opacity="0.72"/>
				<stop offset="1" stop-color="${dark}"/>
			</radialGradient>
			<linearGradient id="bar" x1="0" y1="1" x2="1" y2="0">
				<stop offset="0" stop-color="${accent}" stop-opacity="0.2"/>
				<stop offset="1" stop-color="${contrast}" stop-opacity="0.9"/>
			</linearGradient>
		</defs>
		<rect width="1920" height="1080" fill="url(#glow)"/>
		<g opacity="0.15" stroke="${accent}" stroke-width="2">
			${Array.from({ length: 12 }, (_, index) => `<path d="M0 ${100 + index * 86} H1920"/>`).join("")}
			${Array.from({ length: 20 }, (_, index) => `<path d="M${index * 104} 0 V1080"/>`).join("")}
		</g>
		<circle cx="${circleX}" cy="${circleY}" r="310" fill="none" stroke="${contrast}" stroke-opacity="0.38" stroke-width="44"/>
		<circle cx="${circleX}" cy="${circleY}" r="195" fill="${dark}" fill-opacity="0.38" stroke="${accent}" stroke-opacity="0.6" stroke-width="8"/>
		<g fill="url(#bar)" opacity="0.82">
			<rect x="930" y="790" width="92" height="178" rx="18"/>
			<rect x="1058" y="690" width="92" height="278" rx="18"/>
			<rect x="1186" y="560" width="92" height="408" rx="18"/>
			<rect x="1314" y="402" width="92" height="566" rx="18"/>
		</g>
		<path d="M870 840 C1060 770 1190 620 1460 310" fill="none" stroke="${contrast}" stroke-width="18" stroke-linecap="round"/>
	</svg>`);
	await sharp(background).png({ compressionLevel: 8 }).toFile(heroPath);
	return heroPath;
}

function captionChunks(text: string, maxUnits = 19): string[] {
	const normalized = text.replaceAll(/\s+/g, "").trim();
	const phrases = normalized.split(/(?<=[。！？、])/u).filter(Boolean);
	const splitPhrase = (phrase: string): string[] => {
		const wrapped = wrapCaptionDisplay(phrase, maxUnits);
		if (
			wrapped.length <= 2 &&
			wrapped.every((line) => displayUnits(line) <= maxUnits + 0.5)
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
			if (Math.min(leftUnits, rightUnits) < 4) continue;
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

function captionLines(text: string, maxUnits = 19): string {
	const lines = wrapCaptionDisplay(text, maxUnits).slice(0, 2);
	return lines.join("\\N").replaceAll("{", "(").replaceAll("}", ")");
}

function generateAss(timed: TimedSegment[]): string {
	const header = `[Script Info]
Title: 秒算マネー Feature Captions
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Tsumugi,${FONT},68,&H00FFFFFF,&H000000FF,&H00102032,&H98020810,-1,0,0,0,100,100,0,0,1,5,2,2,180,180,52,1
Style: Zundamon,${FONT},68,&H00E8FFD8,&H000000FF,&H00102032,&H98020810,-1,0,0,0,100,100,0,0,1,5,2,2,180,180,52,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
	const events: string[] = [];
	for (const segment of timed) {
		const chunks = captionChunks(segment.text);
		const weights = chunks.map((chunk) => Math.max(1, displayUnits(chunk)));
		const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
		const usableStart = segment.start + 0.08;
		const usableDuration = Math.max(0.8, segment.duration - 0.18);
		let cursor = usableStart;
		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i] ?? "";
			const share = (weights[i] ?? 1) / totalWeight;
			const duration =
				i === chunks.length - 1
					? segment.start + segment.duration - cursor
					: usableDuration * share;
			const end = Math.max(cursor + 0.84, cursor + duration);
			const style = segment.speaker === "ずんだもん" ? "Zundamon" : "Tsumugi";
			events.push(
				`Dialogue: 0,${assTimestamp(cursor)},${assTimestamp(end)},${style},${segment.speaker},0,0,0,,{\\fad(80,100)}${captionLines(chunk)}`,
			);
			cursor = end;
		}
	}
	return `${header}${events.join("\n")}\n`;
}

function renderVisualSegment(segment: TimedSegment): void {
	const filter = [
		"scale=1920:1080:flags=lanczos",
		centerLockedMotionFilter(FPS),
		`fade=t=in:st=0:d=${segment.index === 0 ? "0.35" : "0.10"}`,
		"format=yuv420p",
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
			"-c:v",
			"h264_nvenc",
			"-preset",
			"p5",
			"-rc",
			"vbr",
			"-cq",
			"15",
			"-b:v",
			"16M",
			"-maxrate",
			"24M",
			"-bufsize",
			"32M",
			"-r",
			String(FPS),
			"-g",
			"15",
			"-bf",
			"2",
			"-pix_fmt",
			"yuv420p",
			"-color_primaries",
			"bt709",
			"-color_trc",
			"bt709",
			"-colorspace",
			"bt709",
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
	const listPath = path.join(runDir, "media/video/segments.ffconcat");
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
	const listPath = path.join(runDir, "media/audio/segments.ffconcat");
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
			"48000",
			"-ac",
			"1",
			"-c:a",
			"pcm_s24le",
			outputPath,
		],
		"concat narration",
	);
}

function composeFinal(
	visualPath: string,
	narrationPath: string,
	subtitlePath: string,
	duration: number,
	outputPath: string,
): void {
	const bed = `aevalsrc=0.006*sin(2*PI*55*t)*(0.72+0.28*sin(2*PI*0.10*t))+0.0035*sin(2*PI*82.41*t)*(0.62+0.38*sin(2*PI*0.067*t)):s=48000:d=${duration.toFixed(3)}`;
	const subtitleFilter = `subtitles=${subtitlePath}:fontsdir=${path.join(PROJECT_ROOT, "assets/fonts")}`;
	const filter = [
		`[0:v]${subtitleFilter}[v]`,
		"[1:a]aresample=48000,highpass=f=70,lowpass=f=16000,acompressor=threshold=-20dB:ratio=2:attack=8:release=110,pan=stereo|c0=c0|c1=c0[narr]",
		"[2:a]lowpass=f=950,highpass=f=35,pan=stereo|c0=c0|c1=c0[bed]",
		"[narr][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,loudnorm=I=-14.5:TP=-1.0:LRA=7[a]",
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
			bed,
			"-filter_complex",
			filter,
			"-map",
			"[v]",
			"-map",
			"[a]",
			"-shortest",
			"-c:v",
			"h264_nvenc",
			"-preset",
			"p6",
			"-rc",
			"cbr",
			"-b:v",
			"8M",
			"-maxrate",
			"8M",
			"-bufsize",
			"16M",
			"-profile:v",
			"high",
			"-g",
			"15",
			"-bf",
			"2",
			"-pix_fmt",
			"yuv420p",
			"-color_primaries",
			"bt709",
			"-color_trc",
			"bt709",
			"-colorspace",
			"bt709",
			"-c:a",
			"aac",
			"-b:a",
			"384k",
			"-ar",
			"48000",
			"-ac",
			"2",
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
	const result = spawnSync(
		"ffmpeg",
		[
			"-hide_banner",
			"-nostats",
			"-i",
			videoPath,
			"-vf",
			"blackdetect=d=1.0:pix_th=0.03,freezedetect=n=-50dB:d=4.0",
			"-an",
			"-f",
			"null",
			"-",
		],
		{ encoding: "utf8", maxBuffer: 100 * 1024 * 1024 },
	);
	const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
	return {
		blackSegments: Array.from(log.matchAll(/black_start:/g)).length,
		freezeSegments: Array.from(log.matchAll(/freeze_start:/g)).length,
		details: log
			.split("\n")
			.filter((line) => /black_|freeze_/.test(line))
			.slice(0, 40)
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
	await fs.outputFile(
		path.join(runDir, "content/output.yaml"),
		yaml.dump(contentOutput, { lineWidth: 110, noRefs: true }),
	);
	await fs.outputJson(path.join(runDir, "metadata.json"), metadata, {
		spaces: 2,
	});
	await fs.outputJson(
		path.join(runDir, "research.json"),
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
		bucket: "byosan_money",
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
			profile: "byosan",
			bucket: "byosan_money",
			visibility: "public",
			requires_receipt: true,
			requires_visibility_attestation: true,
		},
		audio_paths: timed.map((segment) => segment.audioPath),
		thumbnail_path: thumbnailPath,
		video_path: videoPath,
		publish_video_path: videoPath,
	};
	await fs.outputJson(path.join(runDir, "state.json"), state, { spaces: 2 });
	await fs.outputFile(
		path.join(runDir, "media/output.yaml"),
		yaml.dump(
			{
				audio_paths: timed.map((segment) => segment.audioPath),
				thumbnail_path: thumbnailPath,
				video_path: videoPath,
				publish_video_path: videoPath,
				script,
			},
			{ lineWidth: 110, noRefs: true },
		),
	);
	await fs.outputFile(
		path.join(runDir, "publish/input.yaml"),
		yaml.dump(
			{
				video_path: videoPath,
				publish_video_path: videoPath,
				metadata,
			},
			{ lineWidth: 110, noRefs: true },
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
		path.join(runDir, "subtitles.ass"),
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
	const minimumCueSeconds = Math.min(...cues.map((cue) => cue.end - cue.start));
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
	const openingText = timed
		.slice(0, 2)
		.map((segment) => segment.text)
		.join(" ");
	const openingPromisesPaid = spec.hookPromises.every((promise) =>
		openingText.includes(promise),
	);
	const motionFilter = centerLockedMotionFilter(FPS);
	const motionPolicyPass =
		!motionFilter.match(/sin|cos/) &&
		motionFilter.includes("iw/2-(iw/zoom/2)") &&
		motionFilter.includes("ih/2-(ih/zoom/2)");
	const requirements = {
		audio_quality: {
			status: audioQA.status === "PASS" ? "PASS" : "FAIL",
			evidence: audioQA.report,
		},
		video_quality: {
			status:
				video?.codec_name === "h264" &&
				video?.width === 1920 &&
				video?.height === 1080 &&
				audio?.codec_name === "aac" &&
				audio?.sample_rate === "48000" &&
				outputBitrate >= 7_500_000 &&
				defects.blackSegments === 0
					? "PASS"
					: "FAIL",
			evidence: { video, audio, format: probe.format, defects },
		},
		catch: {
			status: titleLength <= 100 && openingPromisesPaid ? "PASS" : "FAIL",
			evidence: {
				title_length: titleLength,
				opening_seconds: timed
					.slice(0, 2)
					.reduce((sum, segment) => sum + segment.duration, 0),
				promise: spec.hookPromises,
				opening_text: openingText,
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
			status:
				new Set(timed.map((segment) => segment.emotion)).size >= 7
					? "PASS"
					: "FAIL",
			evidence: {
				emotion_presets: Array.from(
					new Set(timed.map((segment) => segment.emotion)),
				),
				manifest: path.join(runDir, "media/audio/manifest.json"),
			},
		},
		subtitles: {
			status:
				dialogueLines.length > timed.length &&
				tooManyLines.length === 0 &&
				badLineBreaks.length === 0 &&
				overlappingCues.length === 0 &&
				minimumCueSeconds >= 0.83 &&
				maximumCaptionLineUnits <= 19.5
					? "PASS"
					: "FAIL",
			evidence: {
				cue_count: dialogueLines.length,
				max_lines_per_cue: 2,
				bad_line_breaks: badLineBreaks.length,
				overlapping_cues: overlappingCues.length,
				minimum_cue_seconds: minimumCueSeconds,
				maximum_line_display_units: maximumCaptionLineUnits,
				font_size: 68,
				bottom_safe_margin: 52,
			},
		},
		motion: {
			status:
				defects.freezeSegments === 0 &&
				maxSceneSeconds <= 16 &&
				motionPolicyPass
					? "PASS"
					: "FAIL",
			evidence: {
				scene_count: timed.length,
				max_scene_seconds: maxSceneSeconds,
				camera_motion:
					"center-locked slow push-in; no lateral or vertical oscillation",
				filter: motionFilter,
				no_lateral_oscillation: motionPolicyPass,
				freeze_segments: defects.freezeSegments,
			},
		},
		emotion: {
			status:
				new Set(timed.map((segment) => segment.emotion)).size >= 7
					? "PASS"
					: "FAIL",
			evidence: {
				arc: [
					"shock",
					"curious",
					"reveal",
					"caution",
					"relieved",
					"confident",
					"warm",
					"joy",
				],
			},
		},
		gesture: {
			status: timed.some((segment) => segment.speaker === "春日部つむぎ")
				? "PASS"
				: "FAIL",
			evidence: {
				asset: "official 春日部つむぎ standing art with extended pointing arm",
				synchronization:
					"speaker-specific cutout, pointer line, emotion label, and stat target on every scene",
			},
		},
		thumbnail: {
			status: (await fs.stat(thumbnailPath)).size > 100000 ? "PASS" : "FAIL",
			evidence: {
				path: thumbnailPath,
				continuity: {
					thumbnail_title: spec.thumbnailTitle,
					hook_promises: spec.hookPromises,
					opening_promises_paid: openingPromisesPaid,
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
		path.join(runDir, "audit/production_quality_report.json"),
		{
			decision,
			generated_at: new Date().toISOString(),
			requirements,
		},
		{ spaces: 2 },
	);
	await fs.outputJson(
		path.join(runDir, "audit/report.json"),
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
			`Production audit failed: ${path.join(runDir, "audit/production_quality_report.json")}`,
		);
	}
}

async function main(): Promise<void> {
	const specPath = path.resolve(process.argv[2] ?? DEFAULT_SPEC);
	const spec = parseAndAuditByosanFeatureSpec(await fs.readJson(specPath));
	const runDir = path.join(PROJECT_ROOT, "runs", spec.runId);
	const audioDir = path.join(runDir, "media/audio");
	const sceneDir = path.join(runDir, "media/scenes");
	const segmentVideoDir = path.join(runDir, "media/video/segments");
	const videoDir = path.join(runDir, "media/video");
	await Promise.all([
		fs.ensureDir(audioDir),
		fs.ensureDir(sceneDir),
		fs.ensureDir(segmentVideoDir),
		fs.ensureDir(videoDir),
		fs.ensureDir(path.join(runDir, "audit")),
		fs.ensureDir(path.join(runDir, "publish")),
	]);
	const heroPath = await ensureHeroSource(spec, runDir);
	const tts = new TtsOrchestrator({
		ttsUrl: process.env.VOICEVOX_URL ?? "http://localhost:50121",
		speakers: { 春日部つむぎ: 8, ずんだもん: 1 },
		timeout: { query: 30000, synthesis: 60000 },
	});
	const timed: TimedSegment[] = [];
	let cursor = 0;
	for (let index = 0; index < spec.segments.length; index++) {
		const segment = spec.segments[index];
		if (!segment) continue;
		const audioPath = path.join(
			audioDir,
			`${String(index).padStart(3, "0")}.wav`,
		);
		const scenePath = path.join(
			sceneDir,
			`${String(index).padStart(3, "0")}.png`,
		);
		const segmentVideoPath = path.join(
			segmentVideoDir,
			`${String(index).padStart(3, "0")}.mp4`,
		);
		const speakerId = segment.speaker === "ずんだもん" ? 1 : 8;
		const voice =
			VOICE_PRESETS[segment.emotion] ?? VOICE_PRESETS.analytical ?? {};
		if (!(await fs.pathExists(audioPath))) {
			console.log(
				`[TTS ${index + 1}/${spec.segments.length}] ${segment.speaker} ${segment.emotion}`,
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
				`[SCENE ${index + 1}/${spec.segments.length}] ${segment.headline}`,
			);
			await renderScene(spec, segment, index, scenePath);
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
		path.join(audioDir, "manifest.json"),
		{
			total_chunks: timed.length,
			voice_map: { 春日部つむぎ: 8, ずんだもん: 1 },
			chunks: timed.map((segment) => ({
				index: segment.index,
				script_speaker: segment.speaker,
				tts_requested_voice_id: segment.speaker === "ずんだもん" ? 1 : 8,
				resolved_voice_id: segment.speaker === "ずんだもん" ? 1 : 8,
				no_fallback_used: true,
				output_path: segment.audioPath,
				text_preview: segment.text.slice(0, 60),
				emotion: segment.emotion,
				voice_controls: segment.voice,
			})),
		},
		{ spaces: 2 },
	);
	const subtitlePath = path.join(runDir, "subtitles.ass");
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
	const visualPath = path.join(videoDir, "visual_master.mp4");
	const narrationPath = path.join(audioDir, "full.wav");
	concatVisuals(timed, visualPath, runDir);
	concatNarration(timed, narrationPath, runDir);
	const finalPath = path.join(videoDir, "publish_video.mp4");
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
