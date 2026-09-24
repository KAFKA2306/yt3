import path from "node:path";
import fs from "fs-extra";
import sharp from "sharp";
import {
	extractTranslatableStrings,
} from "../domain/episode/compiler.js";
import {
	assertEnglishLocale,
	assertMediaContract,
	probeEpisodeMedia,
} from "../domain/episode/e2e_verifier.js";
import {
	buildCanonicalEpisode,
	runCanonicalEpisodeProduction,
	type CanonicalProductionDependencies,
	type EpisodeAsrRequest,
	type EpisodeTtsRequest,
} from "../domain/episode/production.js";
import { parseEpisode } from "../domain/episode/schema.js";
import type { AgentState } from "../domain/types.js";
import { AssetStore } from "../io/core.js";

function wavBuffer(durationSeconds: number, frequency: number): Buffer {
	const sampleRate = 24_000;
	const sampleCount = Math.max(1, Math.round(sampleRate * durationSeconds));
	const dataSize = sampleCount * 2;
	const buffer = Buffer.alloc(44 + dataSize);
	buffer.write("RIFF", 0);
	buffer.writeUInt32LE(36 + dataSize, 4);
	buffer.write("WAVE", 8);
	buffer.write("fmt ", 12);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(1, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(sampleRate * 2, 28);
	buffer.writeUInt16LE(2, 32);
	buffer.writeUInt16LE(16, 34);
	buffer.write("data", 36);
	buffer.writeUInt32LE(dataSize, 40);
	for (let index = 0; index < sampleCount; index++) {
		const value = Math.round(
			Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 7000,
		);
		buffer.writeInt16LE(value, 44 + index * 2);
	}
	return buffer;
}

function dialogueIndex(dialogueId: string): number {
	const match = dialogueId.match(/(\d+)$/);
	return match ? Number.parseInt(match[1] ?? "1", 10) - 1 : 0;
}

class SyntheticTts {
	calls: EpisodeTtsRequest[] = [];
	async synthesize(request: EpisodeTtsRequest): Promise<Buffer> {
		this.calls.push(request);
		const index = dialogueIndex(request.dialogueId);
		const durations = [0.3, 0.4, 0.5];
		return wavBuffer(durations[index % durations.length] ?? 0.3, 440 + index * 110);
	}
}

class DeterministicAsr {
	calls: EpisodeAsrRequest[] = [];
	async transcribe(request: EpisodeAsrRequest): Promise<string> {
		this.calls.push(request);
		await fs.ensureDir(request.evidenceDir);
		const forcedRepair =
			request.language === "ja" &&
			request.dialogueId === "line-002" &&
			request.attempt === 0;
		const transcript = forcedRepair ? "誤認識" : request.expectedText;
		await fs.writeJson(
			path.join(request.evidenceDir, "smoke-asr.json"),
			{ transcript, forcedRepair },
			{ spaces: 2 },
		);
		return transcript;
	}
}

class SyntheticThumbnail {
	async generate(_title: string, outputPath: string): Promise<string> {
		await fs.ensureDir(path.dirname(outputPath));
		await sharp({
			create: {
				width: 1280,
				height: 720,
				channels: 3,
				background: { r: 16, g: 55, b: 102 },
			},
		})
			.png()
			.toFile(outputPath);
		return outputPath;
	}
}

function englishValue(value: string): string {
	const translations: Record<string, string> = {
		正本動画: "Canonical Video",
		研究から動画まで: "From research to video",
		本編: "Main",
		レンダリング確認: "Render verification",
		本編の要点: "Main highlight",
		詳しく見る: "Watch the full story",
		一次情報: "Primary source",
	};
	const translated = translations[value];
	if (translated) return translated;
	if (/[\u3040-\u30ff\u3400-\u9fff]/u.test(value))
		throw new Error(`missing English fixture translation: ${value}`);
	return value;
}

async function copyEvidence(root: string, result: Awaited<ReturnType<typeof runCanonicalEpisodeProduction>>) {
	const evidence = path.join(root, "evidence");
	await fs.remove(evidence);
	await fs.ensureDir(evidence);
	const files = [
		result.episode_path,
		result.episode_manifest_path,
		result.asr_report_path,
		result.canonical_qa_path,
		result.video_path,
		result.short_video_path,
		result.thumbnail_path,
		...Object.values(result.locale_video_paths),
	];
	const enEpisode = path.join(path.dirname(result.episode_path), "episode.en.json");
	const enAsr = path.join(path.dirname(result.episode_path), "asr-report-en.json");
	if (fs.existsSync(enEpisode)) files.push(enEpisode);
	if (fs.existsSync(enAsr)) files.push(enAsr);
	for (const filePath of files) {
		if (!fs.existsSync(filePath)) throw new Error(`evidence file is missing: ${filePath}`);
		await fs.copy(filePath, path.join(evidence, path.basename(filePath)));
	}
}

export async function smokeCanonicalProduction(
	root = path.resolve(".artifacts/canonical-production-smoke"),
): Promise<void> {
	await fs.remove(root);
	await fs.ensureDir(root);
	const store = new AssetStore("byosan_money/canonical-production-smoke");
	store.runDir = path.join(root, "run");
	await fs.ensureDir(store.runDir);

	const state: AgentState = {
		run_id: "byosan_money/canonical-production-smoke",
		bucket: "byosan_money",
		news: [
			{
				title: "一次情報",
				summary: "Evidence-backed research summary",
				url: "https://example.com/primary",
			},
		],
		script: {
			title: "本編",
			description: "研究から動画まで",
			total_duration: 0,
			lines: [
				{ speaker: "春日部つむぎ", text: "レンダリング確認", duration: 0 },
				{ speaker: "ずんだもん", text: "本編の要点", duration: 0 },
				{ speaker: "玄野武宏", text: "詳しく見る", duration: 0 },
			],
		},
		metadata: {
			title: "正本動画",
			thumbnail_title: "正本動画",
			description: "研究から動画まで",
			tags: ["canonical", "episode"],
		},
	};
	const smokeScript = state.script;
	const smokeMetadata = state.metadata;
	if (!smokeScript || !smokeMetadata)
		throw new Error("canonical production smoke fixture is incomplete");

	const previewAudio = smokeScript.lines.map(
		(_, index) => `../media/audio/ja/${String(index).padStart(3, "0")}.wav`,
	);
	const previewEpisode = buildCanonicalEpisode({
		script: smokeScript,
		metadata: smokeMetadata,
		news: state.news ?? [],
		fps: store.cfg.steps.video.fps,
		audioPaths: previewAudio,
		locales: ["en"],
	});
	const sourceStrings = extractTranslatableStrings(previewEpisode);
	const localeDir = path.join(store.runDir, "locales");
	await fs.ensureDir(localeDir);
	const enPatchPath = path.join(localeDir, "en.json");
	await fs.writeJson(
		enPatchPath,
		{
			locale: "en",
			strings: Object.fromEntries(
				Object.entries(sourceStrings).map(([key, value]) => [key, englishValue(value)]),
			),
		},
		{ spaces: 2 },
	);

	const tts = new SyntheticTts();
	const asr = new DeterministicAsr();
	const dependencies: CanonicalProductionDependencies = {
		tts,
		asr,
		thumbnail: new SyntheticThumbnail(),
	};
	const result = await runCanonicalEpisodeProduction(store, state, {
		dependencies,
		localePatches: { en: enPatchPath },
		asrThreshold: 0.82,
		repairLimit: 1,
	});

	const episode = parseEpisode(await fs.readFile(result.episode_path, "utf8"));
	if (episode.sources.length !== 1 || episode.claims.length !== 1)
		throw new Error("Research/Evidence provenance was not preserved in canonical episode");
	if (episode.claims[0]?.source_ids[0] !== episode.sources[0]?.id)
		throw new Error("claim/source provenance is broken");
	const asrReport = fs.readJsonSync(result.asr_report_path) as {
		all_passed?: boolean;
		targeted_repairs?: string[];
	};
	if (!asrReport.all_passed) throw new Error("ASR report did not pass");
	if (JSON.stringify(asrReport.targeted_repairs) !== JSON.stringify(["line-002"]))
		throw new Error("targeted ASR repair did not isolate line-002");
	const repairedTtsCalls = tts.calls.filter(
		(call) => call.language === "ja" && call.dialogueId === "line-002",
	);
	if (repairedTtsCalls.length !== 2)
		throw new Error("TTS targeted repair did not regenerate exactly one dialogue");

	const timeline = fs.readJsonSync(
		path.join(store.runDir, "episode", "compiled", "ja", "timeline.json"),
	) as Array<{ startMs: number; endMs: number }>;
	const measuredDurations = new Set(
		timeline.map((item) => Math.round(item.endMs - item.startMs)),
	);
	if (measuredDurations.size !== 3)
		throw new Error("measured audio master timeline did not preserve 3 durations");
	const main = assertMediaContract(probeEpisodeMedia(result.video_path), {
		width: 1920,
		height: 1080,
	});
	const short = assertMediaContract(probeEpisodeMedia(result.short_video_path), {
		width: 1080,
		height: 1920,
	});
	if (main.driftMs > 100 || short.driftMs > 100)
		throw new Error("canonical production A/V drift exceeded gate");
	const enVideo = result.locale_video_paths.en;
	if (!enVideo) throw new Error("English production video was not generated");
	assertMediaContract(probeEpisodeMedia(enVideo), { width: 1920, height: 1080 });
	const enEpisode = parseEpisode(
		await fs.readFile(path.join(store.runDir, "episode", "episode.en.json"), "utf8"),
	);
	assertEnglishLocale(extractTranslatableStrings(enEpisode));
	const thumbnail = await sharp(result.thumbnail_path).metadata();
	if (thumbnail.width !== 1280 || thumbnail.height !== 720)
		throw new Error("canonical thumbnail has wrong dimensions");

	const workflowSource = await fs.readFile(path.resolve("src/workflow.ts"), "utf8");
	if (!workflowSource.includes("runCanonicalEpisodeProduction(store, state)"))
		throw new Error("sequential workflow is not wired to canonical production");
	if (workflowSource.includes("new VisualDirector"))
		throw new Error("legacy VisualDirector remains an implicit sequential production fallback");

	await copyEvidence(root, result);
	await fs.writeJson(
		path.join(root, "summary.json"),
		{
			status: "PASS",
			canonical_episode: result.episode_path,
			main_video: result.video_path,
			short_video: result.short_video_path,
			en_video: enVideo,
			thumbnail: result.thumbnail_path,
			targeted_repairs: asrReport.targeted_repairs,
			measured_audio_durations_ms: [...measuredDurations].sort((a, b) => a - b),
			workflow_uses_canonical_production: true,
			legacy_visual_director_fallback: false,
		},
		{ spaces: 2 },
	);
	console.log("CANONICAL_PRODUCTION_SMOKE: PASS");
}

if (import.meta.main) {
	try {
		await smokeCanonicalProduction();
	} catch (error) {
		console.error(error instanceof Error ? error.stack : String(error));
		process.exit(1);
	}
}
