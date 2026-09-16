import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import fs from "fs-extra";
import {
	type EpisodeShortPlan,
	type EpisodeTimelineItem,
	auditEpisode,
	extractTranslatableStrings,
} from "../domain/episode/compiler.js";
import {
	assertDeterministicFontContract,
	assertEnglishLocale,
	assertMediaContract,
	assertShortContract,
	assertTemplateCoverage,
	assertTimelineContract,
	buildRepresentativeFrameCommand,
	probeEpisodeMedia,
} from "../domain/episode/e2e_verifier.js";
import {
	type RemotionRenderInput,
	buildRemotionWorkspaceFiles,
} from "../domain/episode/remotion_workspace.js";
import { type Episode, parseEpisode } from "../domain/episode/schema.js";
import { compileEpisode } from "./compile_episode.js";
import { renderEpisode } from "./render_episode.js";

async function run(command: string[]): Promise<void> {
	const child = Bun.spawn(command, {
		stdin: "ignore",
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await child.exited;
	if (exitCode !== 0)
		throw new Error(`command failed (${exitCode}): ${command.join(" ")}`);
}

async function readJson<T>(filePath: string): Promise<T> {
	return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function makeTone(
	filePath: string,
	frequency: number,
	durationSeconds: number,
): Promise<void> {
	await run([
		"ffmpeg",
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-f",
		"lavfi",
		"-i",
		`sine=frequency=${frequency}:duration=${durationSeconds}`,
		"-c:a",
		"pcm_s16le",
		filePath,
	]);
}

function translateFixtureValue(value: string): string {
	const translations: Record<string, string> = {
		実動画E2E: "Real video E2E",
		正本JSONから実動画を生成する: "Render a real video from canonical JSON",
		本編: "Main",
		フック: "Hook: canonical JSON",
		比較: "Highlight: compare paths",
		本編を見る: "CTA: watch the full video",
		工程: "Timeline",
		数値: "Number highlight",
		引用: "Quote",
		出典: "Source card",
		画像: "Image template",
		端末: "Terminal",
		GitHub: "GitHub card",
		JSONから動画: "JSON to video",
		日本語字幕確認: "English subtitle check",
		レンダリング確認: "Render check",
		左: "Left",
		右: "Right",
		方式A: "Method A",
		方式B: "Method B",
		実フレームで比較: "Compare using real frames",
		テンプレート工程: "Template timeline",
		"10テンプレート": "10 templates",
		実フレームで確認: "Verified with real frames",
		出典カード: "Source card",
		画像テンプレート: "Image template",
		GitHubカード: "GitHub card",
		実動画で閉じる: "Close with real video evidence",
		日本語E2E: "English E2E",
	};
	const translated = translations[value];
	if (translated) return translated;
	if (!/[\u3040-\u30ff\u3400-\u9fff]/u.test(value)) return value;
	throw new Error(
		`missing deterministic English fixture translation: ${value}`,
	);
}

function buildEpisodeFixture(audioNames: [string, string, string]) {
	const [audio300, audio400, audio500] = audioNames;
	const visualDefinitions = [
		{
			id: "visual-title",
			type: "title",
			props: { title: "JSONから動画", subtitle: "日本語字幕確認" },
		},
		{
			id: "visual-two-column",
			type: "two-column",
			props: {
				leftTitle: "左",
				rightTitle: "右",
				left: ["A", "B"],
				right: ["C", "D"],
			},
		},
		{
			id: "visual-comparison",
			type: "comparison",
			props: {
				title: "実フレームで比較",
				leftTitle: "方式A",
				rightTitle: "方式B",
				left: ["JSON"],
				right: ["Video"],
			},
		},
		{
			id: "visual-timeline",
			type: "timeline",
			props: { title: "テンプレート工程", items: ["1", "2", "3"] },
		},
		{
			id: "visual-number",
			type: "number-highlight",
			props: { number: "10", title: "10テンプレート" },
		},
		{
			id: "visual-quote",
			type: "quote",
			props: { quote: "実フレームで確認", author: "yt3" },
		},
		{
			id: "visual-source",
			type: "source-card",
			props: { title: "出典カード", url: "https://example.com/source" },
		},
		{
			id: "visual-image",
			type: "image",
			props: { title: "画像テンプレート" },
		},
		{
			id: "visual-terminal",
			type: "terminal",
			props: { code: "bun test && ffmpeg -version" },
		},
		{
			id: "visual-github",
			type: "github",
			props: {
				title: "GitHubカード",
				repo: "KAFKA2306/yt3",
				body: "実動画で閉じる",
			},
		},
	] as const;
	const dialogueTexts = [
		"フック",
		"比較",
		"本編を見る",
		"工程",
		"数値",
		"引用",
		"出典",
		"画像",
		"端末",
		"GitHub",
	] as const;
	const audioPaths = [
		audio300,
		audio400,
		audio500,
		audio300,
		audio400,
		audio500,
		audio300,
		audio400,
		audio500,
		audio300,
	];
	return {
		schema_version: 1,
		metadata: {
			title: "実動画E2E",
			description: "正本JSONから実動画を生成する",
			tags: ["e2e", "remotion"],
			language: "ja",
		},
		fps: 10,
		sources: [{ id: "source1", url: "https://example.com", title: "Source" }],
		claims: [{ id: "claim1", text: "E2E claim", source_ids: ["source1"] }],
		assets: [],
		visuals: visualDefinitions.map((visual) => ({
			...visual,
			elements: [],
			source_ref: "source1",
		})),
		sections: [
			{
				id: "main",
				title: "本編",
				dialogue: dialogueTexts.map((text, index) => ({
					id: `line-${index + 1}`,
					speaker: "KAFKA",
					text,
					subtitle: index === 0 ? "レンダリング確認" : text,
					visual_ref: visualDefinitions[index]?.id,
					audio: { path: audioPaths[index] },
				})),
			},
		],
		thumbnail: { lines: ["日本語E2E"], layout: {} },
		shorts: { enabled: true, max_seconds: 1.2 },
		locales: ["en"],
	} as const;
}

function assertAuditCode(
	episode: Episode,
	code: string,
	mutate: (candidate: Episode) => void,
): void {
	const candidate = structuredClone(episode);
	mutate(candidate);
	if (!auditEpisode(candidate).some((issue) => issue.code === code))
		throw new Error(`negative QA fixture did not detect ${code}`);
}

async function extractFrame(
	videoPath: string,
	outputPath: string,
	seconds: number,
): Promise<void> {
	await run(buildRepresentativeFrameCommand(videoPath, outputPath, seconds));
	if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0)
		throw new Error(`representative frame is missing: ${outputPath}`);
}

export async function smokeEpisodePipeline(
	root = path.resolve(".artifacts/episode-render-smoke"),
): Promise<void> {
	await fs.remove(root);
	await fs.ensureDir(root);
	const framesDir = path.join(root, "frames");
	const evidenceDir = path.join(root, "evidence");
	await fs.ensureDir(framesDir);
	await fs.ensureDir(evidenceDir);

	const audio300 = path.join(root, "tone-300.wav");
	const audio400 = path.join(root, "tone-400.wav");
	const audio500 = path.join(root, "tone-500.wav");
	await makeTone(audio300, 440, 0.3);
	await makeTone(audio400, 550, 0.4);
	await makeTone(audio500, 660, 0.5);

	const episodeObject = buildEpisodeFixture([
		path.basename(audio300),
		path.basename(audio400),
		path.basename(audio500),
	]);
	const episode = parseEpisode(JSON.stringify(episodeObject));
	const baseAudit = auditEpisode(episode);
	if (baseAudit.length > 0) throw new Error(JSON.stringify(baseAudit, null, 2));
	assertDeterministicFontContract(buildRemotionWorkspaceFiles());

	assertAuditCode(episode, "subtitle_overflow", (candidate) => {
		const dialogue = candidate.sections[0]?.dialogue[0];
		if (dialogue) dialogue.subtitle = "長".repeat(85);
	});
	assertAuditCode(episode, "unsafe_area_violation", (candidate) => {
		const visual = candidate.visuals[0];
		if (visual)
			visual.elements = [
				{ id: "unsafe", x: 0.01, y: 0.1, width: 0.1, height: 0.1 },
			];
	});
	assertAuditCode(episode, "element_overlap", (candidate) => {
		const visual = candidate.visuals[0];
		if (visual)
			visual.elements = [
				{ id: "a", x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
				{ id: "b", x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
			];
	});
	assertAuditCode(episode, "broken_source_ref", (candidate) => {
		const visual = candidate.visuals[0];
		if (visual) visual.source_ref = "missing-source";
	});
	await writeJson(path.join(evidenceDir, "negative-qa.json"), {
		subtitle_overflow: true,
		unsafe_area_violation: true,
		element_overlap: true,
		broken_source_ref: true,
	});

	const episodePath = path.join(root, "episode.json");
	await writeJson(episodePath, episodeObject);
	const jaDir = path.join(root, "ja");
	await compileEpisode({
		episode: episodePath,
		out: jaDir,
		ffprobe: "ffprobe",
	});
	const jaTimeline = await readJson<EpisodeTimelineItem[]>(
		path.join(jaDir, "timeline.json"),
	);
	const jaMainInput = await readJson<RemotionRenderInput>(
		path.join(jaDir, "render-input-main.json"),
	);
	const jaShortInput = await readJson<RemotionRenderInput>(
		path.join(jaDir, "render-input-short.json"),
	);
	const shortPlan = await readJson<EpisodeShortPlan>(
		path.join(jaDir, "short.json"),
	);
	assertTimelineContract(jaTimeline, episode.fps);
	assertTemplateCoverage(jaMainInput);
	assertShortContract(shortPlan, jaShortInput);

	const jaMain = path.join(root, "ja-main.mp4");
	const jaShort = path.join(root, "ja-short.mp4");
	await renderEpisode({
		compiled: jaDir,
		kind: "main",
		output: jaMain,
		dryRun: false,
	});
	await renderEpisode({
		compiled: jaDir,
		kind: "short",
		output: jaShort,
		dryRun: false,
	});

	const sourceStrings = extractTranslatableStrings(episode);
	const localePath = path.join(root, "en.json");
	await writeJson(localePath, {
		locale: "en",
		strings: Object.fromEntries(
			Object.entries(sourceStrings).map(([key, value]) => [
				key,
				translateFixtureValue(value),
			]),
		),
	});
	const enDir = path.join(root, "en");
	await compileEpisode({
		episode: episodePath,
		out: enDir,
		localePatch: localePath,
		ffprobe: "ffprobe",
	});
	const enEpisode = parseEpisode(
		await readFile(path.join(enDir, "episode.resolved.json"), "utf8"),
	);
	assertEnglishLocale(extractTranslatableStrings(enEpisode));
	const enMain = path.join(root, "en-main.mp4");
	await renderEpisode({
		compiled: enDir,
		kind: "main",
		output: enMain,
		dryRun: false,
	});

	const probes = {
		jaMain: probeEpisodeMedia(jaMain),
		jaShort: probeEpisodeMedia(jaShort),
		enMain: probeEpisodeMedia(enMain),
	};
	const contracts = {
		jaMain: assertMediaContract(probes.jaMain, { width: 1920, height: 1080 }),
		jaShort: assertMediaContract(probes.jaShort, {
			width: 1080,
			height: 1920,
		}),
		enMain: assertMediaContract(probes.enMain, { width: 1920, height: 1080 }),
	};
	await writeJson(path.join(evidenceDir, "media-probes.json"), {
		probes,
		contracts,
	});

	const visualTypeByDialogue = new Map(
		episode.sections[0]?.dialogue.map((dialogue) => [
			dialogue.id,
			episode.visuals.find((visual) => visual.id === dialogue.visual_ref)
				?.type ?? "unknown",
		]) ?? [],
	);
	const frameEvidence: Array<{
		kind: string;
		dialogueId: string;
		template: string;
		seconds: number;
		file: string;
	}> = [];
	for (const item of jaTimeline) {
		const frame = Math.max(item.startFrame, item.endFrame - 1);
		const seconds = frame / episode.fps;
		const template = visualTypeByDialogue.get(item.dialogueId) ?? "unknown";
		const file = `ja-${String(item.startFrame).padStart(3, "0")}-${template}.png`;
		await extractFrame(jaMain, path.join(framesDir, file), seconds);
		frameEvidence.push({
			kind: "ja-main",
			dialogueId: item.dialogueId,
			template,
			seconds,
			file,
		});
	}
	for (const item of jaShortInput.items) {
		const frame = Math.max(item.startFrame, item.endFrame - 1);
		const seconds = frame / jaShortInput.fps;
		const role = item.shortRole ?? "UNKNOWN";
		const file = `short-${role.toLowerCase()}.png`;
		await extractFrame(jaShort, path.join(framesDir, file), seconds);
		frameEvidence.push({
			kind: "ja-short",
			dialogueId: item.id,
			template: role,
			seconds,
			file,
		});
	}
	const enFirst = jaTimeline[0];
	if (!enFirst)
		throw new Error("English representative frame has no timeline item");
	const enSeconds =
		Math.max(enFirst.startFrame, enFirst.endFrame - 1) / episode.fps;
	await extractFrame(enMain, path.join(framesDir, "en-title.png"), enSeconds);
	frameEvidence.push({
		kind: "en-main",
		dialogueId: enFirst.dialogueId,
		template: "title",
		seconds: enSeconds,
		file: "en-title.png",
	});
	await writeJson(
		path.join(evidenceDir, "representative-frames.json"),
		frameEvidence,
	);

	for (const [prefix, directory] of [
		["ja", jaDir],
		["en", enDir],
	] as const) {
		for (const name of [
			"episode.resolved.json",
			"timeline.json",
			"episode.manifest.json",
			"short.json",
			"render-input-main.json",
			"render-input-short.json",
		]) {
			const source = path.join(directory, name);
			if (fs.existsSync(source))
				await fs.copy(source, path.join(evidenceDir, `${prefix}-${name}`));
		}
	}
	await fs.copy(localePath, path.join(evidenceDir, "en-locale.json"));
	await writeJson(path.join(evidenceDir, "summary.json"), {
		status: "PASS",
		templates: jaMainInput.items.map((item) => item.visual.type),
		shortRoles: jaShortInput.items.map((item) => item.shortRole),
		distinctAudioDurationsMs: [
			...new Set(jaTimeline.map((item) => item.endMs - item.startMs)),
		],
		font: "@fontsource-variable/noto-sans-jp@5.3.0",
		outputs: ["ja-main.mp4", "ja-short.mp4", "en-main.mp4"],
	});

	console.log(
		JSON.stringify({
			status: "PASS",
			templates: jaMainInput.items.length,
			frames: frameEvidence.length,
			probes,
		}),
	);
}

if (import.meta.main) {
	try {
		await smokeEpisodePipeline();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
