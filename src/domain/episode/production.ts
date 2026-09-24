import path from "node:path";
import fs from "fs-extra";
import type { AssetStore } from "../../io/core.js";
import { IqaValidator } from "../../io/utils/iqa_validator.js";
import {
	TtsOrchestrator,
	type TtsVoiceControls,
} from "../../io/utils/tts_orchestrator.js";
import { compileEpisode } from "../../scripts/compile_episode.js";
import { renderEpisode } from "../../scripts/render_episode.js";
import { LayoutEngine } from "../layout/engine.js";
import { ThumbnailGenerator } from "../media/thumbnail_generator.js";
import type { AgentState, Metadata, NewsItem, Script } from "../types.js";
import {
	applyLocalePatch,
	auditEpisode,
	auditLocalePatch,
	extractTranslatableStrings,
} from "./compiler.js";
import {
	assertEnglishLocale,
	assertMediaContract,
	probeEpisodeMedia,
} from "./e2e_verifier.js";
import {
	type Episode,
	EpisodeSchema,
	type LocalePatch,
	parseLocalePatch,
} from "./schema.js";

const DEFAULT_ASR_THRESHOLD = 0.82;
const DEFAULT_REPAIR_LIMIT = 1;

export interface EpisodeTtsRequest {
	dialogueId: string;
	text: string;
	speaker: string;
	speakerId: number;
	language: string;
	attempt: number;
	voice?: TtsVoiceControls;
}

export interface EpisodeTtsEngine {
	synthesize(request: EpisodeTtsRequest): Promise<Buffer>;
}

export interface EpisodeAsrRequest {
	dialogueId: string;
	audioPath: string;
	expectedText: string;
	language: string;
	attempt: number;
	evidenceDir: string;
}

export interface EpisodeAsrEngine {
	transcribe(request: EpisodeAsrRequest): Promise<string>;
}

export interface EpisodeThumbnailEngine {
	generate(title: string, outputPath: string): Promise<string>;
}

export interface CanonicalProductionDependencies {
	tts: EpisodeTtsEngine;
	asr: EpisodeAsrEngine;
	thumbnail: EpisodeThumbnailEngine;
}

export interface CanonicalProductionOptions {
	dependencies?: CanonicalProductionDependencies;
	localePatches?: Record<string, string>;
	asrThreshold?: number;
	repairLimit?: number;
}

export interface CanonicalProductionResult {
	audio_paths: string[];
	thumbnail_path: string;
	video_path: string;
	short_video_path: string;
	episode_path: string;
	episode_manifest_path: string;
	asr_report_path: string;
	canonical_qa_path: string;
	locale_video_paths: Record<string, string>;
}

interface DialogueAsrRecord {
	dialogue_id: string;
	language: string;
	expected: string;
	transcript: string;
	similarity: number;
	attempts: number;
	passed: boolean;
	audio_path: string;
}

function sanitizeTextForTts(text: string): string {
	return text
		.replace(/https?:\/\/\S+/g, "")
		.replace(/[`*_#>]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeSpeech(text: string): string {
	return text
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[\p{P}\p{S}\s]/gu, "");
}

function levenshteinDistance(left: string, right: string): number {
	const a = [...left];
	const b = [...right];
	const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	const current = new Array<number>(b.length + 1);
	for (let i = 1; i <= a.length; i++) {
		current[0] = i;
		for (let j = 1; j <= b.length; j++) {
			current[j] = Math.min(
				(current[j - 1] ?? 0) + 1,
				(previous[j] ?? 0) + 1,
				(previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
		}
		for (let j = 0; j <= b.length; j++) previous[j] = current[j] ?? 0;
	}
	return previous[b.length] ?? a.length;
}

export function transcriptSimilarity(expected: string, actual: string): number {
	const left = normalizeSpeech(expected);
	const right = normalizeSpeech(actual);
	if (left.length === 0 && right.length === 0) return 1;
	const denominator = Math.max(left.length, right.length, 1);
	return Math.max(0, 1 - levenshteinDistance(left, right) / denominator);
}

function id(prefix: string, index: number): string {
	return `${prefix}-${String(index + 1).padStart(3, "0")}`;
}

function uniqueNewsSources(
	news: NewsItem[],
): Array<NewsItem & { sourceId: string }> {
	const seen = new Set<string>();
	const sources: Array<NewsItem & { sourceId: string }> = [];
	for (const item of news) {
		if (seen.has(item.url)) continue;
		seen.add(item.url);
		sources.push({ ...item, sourceId: id("source", sources.length) });
	}
	return sources;
}

export function buildCanonicalEpisode(input: {
	script: Script;
	metadata: Metadata;
	news: NewsItem[];
	fps: number;
	audioPaths: string[];
	locales?: string[];
}): Episode {
	if (input.script.lines.length === 0)
		throw new Error("canonical episode requires dialogue");
	if (input.audioPaths.length !== input.script.lines.length)
		throw new Error(
			"canonical episode audio path count does not match dialogue count",
		);
	const research = uniqueNewsSources(input.news);
	const sources = research.map((item) => ({
		id: item.sourceId,
		url: item.url,
		title: item.title,
	}));
	const claims = research.map((item, index) => ({
		id: id("claim", index),
		text: item.summary || item.title,
		source_ids: [item.sourceId],
	}));
	const visuals = input.script.lines.map((line, index) => {
		const source =
			research.length > 0 ? research[index % research.length] : undefined;
		return {
			id: id("visual", index),
			type:
				index === 0
					? ("title" as const)
					: source
						? ("source-card" as const)
						: ("title" as const),
			props:
				index === 0
					? { title: input.metadata.title, subtitle: line.text }
					: source
						? { title: source.title, url: source.url }
						: { title: line.text },
			elements: [],
			...(source ? { source_ref: source.sourceId } : {}),
		};
	});
	const episode = EpisodeSchema.parse({
		schema_version: 1,
		metadata: {
			title: input.metadata.title,
			description: input.metadata.description,
			tags: input.metadata.tags,
			language: "ja",
		},
		fps: input.fps,
		sources,
		claims,
		assets: [],
		visuals,
		sections: [
			{
				id: "main",
				title: input.script.title || input.metadata.title,
				dialogue: input.script.lines.map((line, index) => ({
					id: id("line", index),
					speaker: line.speaker,
					text: line.text,
					subtitle: line.text,
					visual_ref: id("visual", index),
					audio: { path: input.audioPaths[index] },
				})),
			},
		],
		thumbnail: {
			lines: [input.metadata.thumbnail_title],
			layout: {},
		},
		shorts: { enabled: true, max_seconds: 60 },
		locales: input.locales ?? [],
	});
	const issues = auditEpisode(episode);
	if (issues.length > 0)
		throw new Error(
			`canonical episode audit failed: ${JSON.stringify(issues)}`,
		);
	return episode;
}

class VoicevoxEpisodeTtsEngine implements EpisodeTtsEngine {
	private readonly orchestrator: TtsOrchestrator;
	constructor(store: AssetStore) {
		this.orchestrator = new TtsOrchestrator({
			ttsUrl: store.cfg.providers.tts.voicevox.url,
			speakers: store.cfg.providers.tts.voicevox.speakers,
			timeout: { query: 30_000, synthesis: 60_000 },
		});
	}
	async synthesize(request: EpisodeTtsRequest): Promise<Buffer> {
		const result = await this.orchestrator.synthesize({
			text: sanitizeTextForTts(request.text),
			speakerId: request.speakerId,
			voice: request.voice,
		});
		return result.audio;
	}
}

export class FasterWhisperEpisodeAsrEngine implements EpisodeAsrEngine {
	async transcribe(request: EpisodeAsrRequest): Promise<string> {
		await fs.ensureDir(request.evidenceDir);
		const model = process.env.EPISODE_ASR_MODEL?.trim() || "base";
		const command = [
			"uv",
			"run",
			"--no-project",
			"--with",
			"faster-whisper",
			"python3",
			"scripts/run_asr.py",
			"--input-wav",
			request.audioPath,
			"--output-dir",
			request.evidenceDir,
			"--model",
			model,
			"--language",
			request.language,
		];
		const child = Bun.spawn(command, {
			cwd: process.cwd(),
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exitCode, stderr] = await Promise.all([
			child.exited,
			new Response(child.stderr).text(),
		]);
		if (exitCode !== 0)
			throw new Error(`ASR failed for ${request.dialogueId}: ${stderr.trim()}`);
		const jsonlPath = path.join(request.evidenceDir, "asr_raw.jsonl");
		const lines = (await fs.readFile(jsonlPath, "utf8"))
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { text?: string });
		return lines
			.map((line) => line.text ?? "")
			.join("")
			.trim();
	}
}

class CanonicalThumbnailEngine implements EpisodeThumbnailEngine {
	private readonly generator: ThumbnailGenerator;
	constructor(store: AssetStore) {
		const layout = new LayoutEngine(store.cfg);
		const validator = new IqaValidator(store.cfg);
		this.generator = new ThumbnailGenerator({
			layout,
			validator,
			config: store.cfg.steps.thumbnail,
			mcpServers: store.cfg.mcp?.servers,
			agentName: "canonical_episode",
		});
	}
	generate(title: string, outputPath: string): Promise<string> {
		return this.generator.generate(title, outputPath);
	}
}

export function createCanonicalProductionDependencies(
	store: AssetStore,
): CanonicalProductionDependencies {
	return {
		tts: new VoicevoxEpisodeTtsEngine(store),
		asr: new FasterWhisperEpisodeAsrEngine(),
		thumbnail: new CanonicalThumbnailEngine(store),
	};
}

function dialogueList(episode: Episode) {
	return episode.sections.flatMap((section) => section.dialogue);
}

function repairVoice(attempt: number): TtsVoiceControls | undefined {
	if (attempt === 0) return undefined;
	return {
		speedScale: 0.94,
		intonationScale: 1.05,
		prePhonemeLength: 0.12,
		postPhonemeLength: 0.12,
	};
}

async function synthesizeAndVerify(
	episode: Episode,
	episodeDir: string,
	store: AssetStore,
	dependencies: CanonicalProductionDependencies,
	options: { threshold: number; repairLimit: number; locale: string },
): Promise<{ audioPaths: string[]; reportPath: string }> {
	const speakers = store.cfg.providers.tts.voicevox.speakers;
	const ttsRecords: Array<Record<string, unknown>> = [];
	const asrRecords: DialogueAsrRecord[] = [];
	const audioPaths: string[] = [];
	for (const dialogue of dialogueList(episode)) {
		const speakerId = speakers[dialogue.speaker];
		if (speakerId === undefined)
			throw new Error(
				`canonical TTS speaker is not configured: ${dialogue.speaker}`,
			);
		const audioPath = path.resolve(episodeDir, dialogue.audio.path);
		await fs.ensureDir(path.dirname(audioPath));
		let transcript = "";
		let similarity = 0;
		let passed = false;
		let finalAttempt = 0;
		for (let attempt = 0; attempt <= options.repairLimit; attempt++) {
			finalAttempt = attempt;
			const voice = repairVoice(attempt);
			const audio = await dependencies.tts.synthesize({
				dialogueId: dialogue.id,
				text: dialogue.text,
				speaker: dialogue.speaker,
				speakerId,
				language: options.locale,
				attempt,
				voice,
			});
			await fs.writeFile(audioPath, audio);
			ttsRecords.push({
				dialogue_id: dialogue.id,
				speaker: dialogue.speaker,
				speaker_id: speakerId,
				language: options.locale,
				attempt,
				voice: voice ?? {},
				audio_path: audioPath,
			});
			const asrDir = path.join(
				episodeDir,
				"asr",
				options.locale,
				dialogue.id,
				`attempt-${attempt}`,
			);
			transcript = await dependencies.asr.transcribe({
				dialogueId: dialogue.id,
				audioPath,
				expectedText: dialogue.text,
				language: options.locale,
				attempt,
				evidenceDir: asrDir,
			});
			similarity = transcriptSimilarity(dialogue.text, transcript);
			passed = similarity >= options.threshold;
			if (passed) break;
		}
		asrRecords.push({
			dialogue_id: dialogue.id,
			language: options.locale,
			expected: dialogue.text,
			transcript,
			similarity,
			attempts: finalAttempt + 1,
			passed,
			audio_path: audioPath,
		});
		if (!passed)
			throw new Error(
				`ASR reverse verification failed for ${dialogue.id}: similarity=${similarity.toFixed(3)}`,
			);
		audioPaths.push(audioPath);
	}
	const ttsManifestPath = path.join(
		episodeDir,
		`tts-manifest-${options.locale}.json`,
	);
	const reportPath = path.join(episodeDir, `asr-report-${options.locale}.json`);
	await fs.writeJson(
		ttsManifestPath,
		{ language: options.locale, records: ttsRecords },
		{ spaces: 2 },
	);
	await fs.writeJson(
		reportPath,
		{
			language: options.locale,
			threshold: options.threshold,
			all_passed: asrRecords.every((record) => record.passed),
			targeted_repairs: asrRecords
				.filter((record) => record.attempts > 1)
				.map((record) => record.dialogue_id),
			records: asrRecords,
		},
		{ spaces: 2 },
	);
	return { audioPaths, reportPath };
}

function resolveLocalePatches(
	store: AssetStore,
	explicit: Record<string, string> | undefined,
): Record<string, string> {
	if (explicit) return explicit;
	const localeDir = path.join(store.runDir, "locales");
	if (!fs.existsSync(localeDir)) return {};
	return Object.fromEntries(
		fs
			.readdirSync(localeDir)
			.filter((name) => name.endsWith(".json"))
			.map((name) => [
				path.basename(name, ".json"),
				path.join(localeDir, name),
			]),
	);
}

function localeAudioPaths(
	episode: Episode,
	episodeDir: string,
	store: AssetStore,
	locale: string,
): string[] {
	const audioDir = path.join(store.audioDir(), locale);
	return dialogueList(episode).map((_, index) =>
		path.relative(
			episodeDir,
			path.join(audioDir, `${String(index).padStart(3, "0")}.wav`),
		),
	);
}

function replaceAudioPaths(episode: Episode, audioPaths: string[]): Episode {
	const next = structuredClone(episode);
	let index = 0;
	for (const dialogue of dialogueList(next)) {
		const audioPath = audioPaths[index++];
		if (!audioPath) throw new Error("locale audio path count mismatch");
		dialogue.audio.path = audioPath;
	}
	return EpisodeSchema.parse(next);
}

async function writeCanonicalEpisode(
	filePath: string,
	episode: Episode,
): Promise<void> {
	const issues = auditEpisode(episode);
	if (issues.length > 0)
		throw new Error(
			`canonical episode audit failed: ${JSON.stringify(issues)}`,
		);
	await fs.writeJson(filePath, episode, { spaces: 2 });
}

export async function runCanonicalEpisodeProduction(
	store: AssetStore,
	state: AgentState,
	options: CanonicalProductionOptions = {},
): Promise<CanonicalProductionResult> {
	if (!state.script) throw new Error("canonical production requires script");
	if (!state.metadata)
		throw new Error("canonical production requires metadata");
	const dependencies =
		options.dependencies ?? createCanonicalProductionDependencies(store);
	const threshold = options.asrThreshold ?? DEFAULT_ASR_THRESHOLD;
	const repairLimit = options.repairLimit ?? DEFAULT_REPAIR_LIMIT;
	const episodeDir = path.join(store.runDir, "episode");
	const compiledRoot = path.join(episodeDir, "compiled");
	await fs.ensureDir(episodeDir);
	const localePatches = resolveLocalePatches(store, options.localePatches);
	const jaAudioPaths = localeAudioPaths(
		buildCanonicalEpisode({
			script: state.script,
			metadata: state.metadata,
			news: state.news ?? [],
			fps: store.cfg.steps.video.fps,
			audioPaths: state.script.lines.map(() => "placeholder.wav"),
		}),
		episodeDir,
		store,
		"ja",
	);
	const episode = buildCanonicalEpisode({
		script: state.script,
		metadata: state.metadata,
		news: state.news ?? [],
		fps: store.cfg.steps.video.fps,
		audioPaths: jaAudioPaths,
		locales: Object.keys(localePatches),
	});
	const episodePath = path.join(episodeDir, "episode.json");
	await writeCanonicalEpisode(episodePath, episode);
	const jaSpeech = await synthesizeAndVerify(
		episode,
		episodeDir,
		store,
		dependencies,
		{
			threshold,
			repairLimit,
			locale: "ja",
		},
	);
	const jaCompiled = path.join(compiledRoot, "ja");
	await compileEpisode({
		episode: episodePath,
		out: jaCompiled,
		ffprobe: "ffprobe",
	});
	const videoPath = path.join(
		store.videoDir(),
		store.cfg.workflow.filenames.video,
	);
	const shortVideoPath = path.join(store.videoDir(), "short.mp4");
	await renderEpisode({
		compiled: jaCompiled,
		kind: "main",
		output: videoPath,
		dryRun: false,
	});
	await renderEpisode({
		compiled: jaCompiled,
		kind: "short",
		output: shortVideoPath,
		dryRun: false,
	});

	const thumbnailPath = path.join(
		store.runDir,
		store.cfg.workflow.filenames.thumbnail,
	);
	const thumbnailTitle = episode.thumbnail.lines.join(" ");
	await dependencies.thumbnail.generate(thumbnailTitle, thumbnailPath);
	if (!fs.existsSync(thumbnailPath) || fs.statSync(thumbnailPath).size === 0)
		throw new Error("canonical thumbnail generation produced no image");

	const localeVideoPaths: Record<string, string> = {};
	for (const [locale, patchPath] of Object.entries(localePatches)) {
		const patch = parseLocalePatch(await fs.readFile(patchPath, "utf8"));
		if (patch.locale !== locale)
			throw new Error(
				`locale patch key ${locale} does not match patch locale ${patch.locale}`,
			);
		const localeIssues = auditLocalePatch(episode, patch);
		if (localeIssues.length > 0)
			throw new Error(
				`locale patch audit failed: ${JSON.stringify(localeIssues)}`,
			);
		let localized = EpisodeSchema.parse(applyLocalePatch(episode, patch));
		localized = replaceAudioPaths(
			localized,
			localeAudioPaths(localized, episodeDir, store, locale),
		);
		if (locale === "en")
			assertEnglishLocale(extractTranslatableStrings(localized));
		const localeEpisodePath = path.join(episodeDir, `episode.${locale}.json`);
		await writeCanonicalEpisode(localeEpisodePath, localized);
		await synthesizeAndVerify(localized, episodeDir, store, dependencies, {
			threshold,
			repairLimit,
			locale,
		});
		const localeCompiled = path.join(compiledRoot, locale);
		await compileEpisode({
			episode: localeEpisodePath,
			out: localeCompiled,
			ffprobe: "ffprobe",
		});
		const localeVideo = path.join(store.videoDir(), `video.${locale}.mp4`);
		await renderEpisode({
			compiled: localeCompiled,
			kind: "main",
			output: localeVideo,
			dryRun: false,
		});
		localeVideoPaths[locale] = localeVideo;
	}

	const mainProbe = probeEpisodeMedia(videoPath);
	const shortProbe = probeEpisodeMedia(shortVideoPath);
	const mainContract = assertMediaContract(mainProbe, {
		width: 1920,
		height: 1080,
	});
	const shortContract = assertMediaContract(shortProbe, {
		width: 1080,
		height: 1920,
	});
	const localeQa = Object.fromEntries(
		Object.entries(localeVideoPaths).map(([locale, filePath]) => {
			const probe = probeEpisodeMedia(filePath);
			return [
				locale,
				{
					probe,
					contract: assertMediaContract(probe, { width: 1920, height: 1080 }),
				},
			];
		}),
	);
	const canonicalQaPath = path.join(episodeDir, "qa.json");
	await fs.writeJson(
		canonicalQaPath,
		{
			status: "PASS",
			episode_audit_issues: [],
			main: { probe: mainProbe, contract: mainContract },
			short: { probe: shortProbe, contract: shortContract },
			locales: localeQa,
			thumbnail_path: thumbnailPath,
		},
		{ spaces: 2 },
	);

	const timeline = (await fs.readJson(
		path.join(jaCompiled, "timeline.json"),
	)) as Array<{
		startMs: number;
		endMs: number;
	}>;
	for (let index = 0; index < state.script.lines.length; index++) {
		const line = state.script.lines[index];
		const timing = timeline[index];
		if (line && timing) line.duration = (timing.endMs - timing.startMs) / 1000;
	}
	const result: CanonicalProductionResult = {
		audio_paths: jaSpeech.audioPaths,
		thumbnail_path: thumbnailPath,
		video_path: videoPath,
		short_video_path: shortVideoPath,
		episode_path: episodePath,
		episode_manifest_path: path.join(jaCompiled, "episode.manifest.json"),
		asr_report_path: jaSpeech.reportPath,
		canonical_qa_path: canonicalQaPath,
		locale_video_paths: localeVideoPaths,
	};
	await fs.writeJson(path.join(episodeDir, "production-result.json"), result, {
		spaces: 2,
	});
	return result;
}
