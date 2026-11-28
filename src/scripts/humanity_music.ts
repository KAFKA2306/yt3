import path from "node:path";
import fs from "fs-extra";
import { google } from "googleapis";
import { z } from "zod";
import { syncRunIsolated } from "../domain/audio_syndication.js";
import {
	TitleFitSchema,
	TitleProposalSchema,
	TitleReviewSchema,
	titleFitPrompt,
	titleOnlyPrompt,
	titleProposalPrompt,
} from "../domain/creative_authoring.js";
import {
	fillTemplate,
	type GenerationRow,
	generations,
	HumanityJizuraPlanRecordSchema,
	HumanityJizuraPlanSchema,
	HumanityUseCaseIdSchema,
	type LedgerRow,
	loadMusicConfig,
	musicAudit,
	parseHumanityUseCases,
	parseLedger,
	playlistText,
	rankedSongs,
	scoresOf,
	YOUTUBE_PLAYLIST_URL,
	YOUTUBE_WATCH_URL,
} from "../domain/humanity_music.js";
import { sha256File } from "../domain/publication_state.js";
import {
	assertYouTubeChannelMatchesProfile,
	createYouTubeOAuthClient,
	YOUTUBE_PROFILES,
} from "../domain/youtube_profiles.js";
import { getCurrentDateString, ROOT } from "../io/core.js";
import { invokeCreativeStructured } from "../io/creative.js";

const config = loadMusicConfig(ROOT);
const outputDir = path.join(ROOT, config.output_dir);
const ledgerPath = path.join(outputDir, "ledger.jsonl");
const DraftSchema = z
	.object({
		title: z.string().min(1),
		use_case: HumanityUseCaseIdSchema,
		secondary_use_cases: z
			.array(HumanityUseCaseIdSchema)
			.max(1)
			.optional()
			.default([]),
		concept: z.string().min(1),
		story: z.string().min(1),
		relationship: z.string().min(1),
		featured_characters: z.array(z.string().min(1)).min(1),
		style: z.string().min(1),
		lyrics: z.string().min(1),
		thumbnail_prompt: z.string().min(1),
		visual_direction: z.string().min(1),
		jizura: HumanityJizuraPlanSchema.optional(),
	})
	.passthrough();

type PreviousStory = {
	id: string;
	title: string;
	concept: string;
	story: string;
	relationship: string;
};

function previousStories(): PreviousStory[] {
	if (!fs.existsSync(outputDir)) return [];
	return fs
		.readdirSync(outputDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => ({
			id: entry.name,
			file: path.join(outputDir, entry.name, "creative_authoring.json"),
		}))
		.filter(({ file }) => fs.existsSync(file))
		.map(({ id, file }) => {
			const record = fs.readJsonSync(file) as Record<string, unknown>;
			return {
				id,
				title: z.string().parse(record.title),
				concept: z.string().parse(record.concept),
				story: z.string().parse(record.story),
				relationship: z.string().parse(record.relationship),
			};
		})
		.sort((a, b) => b.id.localeCompare(a.id))
		.slice(0, 8)
		.reverse();
}

function readLedger(): LedgerRow[] {
	return fs.existsSync(ledgerPath)
		? parseLedger(fs.readFileSync(ledgerPath, "utf-8"))
		: [];
}

function append(row: LedgerRow): void {
	fs.ensureDirSync(outputDir);
	fs.appendFileSync(ledgerPath, `${JSON.stringify(row)}\n`);
}

function writePlaylist(): void {
	fs.writeFileSync(
		path.join(outputDir, config.playlist.file),
		playlistText(
			rankedSongs(readLedger()),
			outputDir,
			config.playlist.audio_file,
		),
	);
}

function run(
	command: string[],
	options: { cwd?: string; env?: Record<string, string> } = {},
): string {
	const result = Bun.spawnSync(command, {
		cwd: options.cwd,
		env: { ...process.env, ...options.env },
		stderr: "pipe",
	});
	if (result.exitCode !== 0)
		throw new Error(
			`${command[0]} failed (${result.exitCode}): ${result.stderr.toString().slice(-600)}`,
		);
	return `${result.stdout.toString()}${result.stderr.toString()}`;
}

function loadJizuraPlan(generationDir: string, generationId: string): string {
	const planPath = path.join(generationDir, "jizura.json");
	const plan = HumanityJizuraPlanRecordSchema.parse(fs.readJsonSync(planPath));
	if (
		!config.pv.theme_ids ||
		!config.pv.style_ids ||
		!config.pv.mood_ids ||
		!config.pv.motif_layout_ids
	)
		throw new Error("JIZURA renderer settings are incomplete for this run");
	if (
		!config.pv.theme_ids.includes(plan.theme_id) ||
		!config.pv.style_ids.includes(plan.style_id) ||
		!config.pv.mood_ids.includes(plan.mood_id) ||
		!config.pv.motif_layout_ids.includes(plan.visual_arc.motif_layout_id)
	)
		throw new Error(
			"JIZURA plan uses a theme, style, mood, or motif outside the configured set",
		);
	if (plan.generation_id !== generationId)
		throw new Error("JIZURA plan belongs to a different music generation");
	const authoring = fs.readJsonSync(
		path.join(generationDir, "creative_authoring.json"),
	) as { jizura_plan?: { path?: string; sha256?: string } };
	if (
		authoring.jizura_plan?.path !== "jizura.json" ||
		authoring.jizura_plan.sha256 !== sha256File(planPath)
	)
		throw new Error(
			"JIZURA plan reference or hash does not match its canonical record",
		);
	return planPath;
}

function preflight(): void {
	const freeVram =
		config.yue.device === "cuda"
			? Number(
					run([
						"nvidia-smi",
						"--query-gpu=memory.free",
						"--format=csv,noheader,nounits",
					]).trim(),
				)
			: null;
	const availableRam = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(
		fs.readFileSync("/proc/meminfo", "utf-8"),
	);
	if (!availableRam)
		throw new Error("MemAvailable is missing from /proc/meminfo");
	const freeRam = Math.floor(Number(availableRam[1]) / 1024);
	const snapshots = fs.existsSync(config.yue.snapshot_dir)
		? fs.readdirSync(config.yue.snapshot_dir)
		: [];
	const failures = [
		config.yue.device === "cpu" ||
		(freeVram !== null && freeVram >= config.yue.min_free_vram_mib)
			? ""
			: `free VRAM ${freeVram} MiB < ${config.yue.min_free_vram_mib} MiB`,
		config.yue.device !== "cpu" || freeRam >= config.yue.min_free_ram_mib
			? ""
			: `free RAM ${freeRam} MiB < ${config.yue.min_free_ram_mib} MiB for CPU generation`,
		Bun.which("agy") ? "" : "agy CLI is not on PATH",
		Bun.which("uv") ? "" : "uv is not on PATH",
		Bun.which("ffmpeg") ? "" : "ffmpeg is not on PATH",
		fs.existsSync(path.join(config.yue.dir, config.yue.python))
			? ""
			: "YuE2 python environment is missing",
		fs.existsSync(path.join(config.yue.dir, config.yue.script))
			? ""
			: "YuE2 generation script is missing",
		snapshots.some((name) =>
			fs.existsSync(
				path.join(config.yue.snapshot_dir, name, "model.safetensors"),
			),
		)
			? ""
			: "YuE2-3B weights are not downloaded",
		fs.existsSync(path.join(ROOT, YOUTUBE_PROFILES.humanity.tokenPath))
			? ""
			: "humanity YouTube token is missing",
		fs.existsSync(config.yue.license_file) &&
		fs
			.readFileSync(config.yue.license_file, "utf-8")
			.includes(config.yue.license_clause)
			? ""
			: "MODEL_LICENSE individual creator clause is missing",
	].filter(Boolean);
	if (failures.length > 0)
		throw new Error(`preflight failed: ${failures.join("; ")}`);
}

async function generate(brief?: string): Promise<GenerationRow> {
	preflight();
	const previous = previousStories();
	const context = {
		brief: brief ?? null,
		mission:
			"雨晴はうの人類観測所が制作するオリジナルAI音楽チャンネル。固定の舞台設定に縛られず、曲ごとのコンセプト・用途（作業・家事・ドライブ・夜更けなど）と感情に最も合うボーカル・ジャンル・音作りで、初聴きで単体でも刺さる一曲を作る。",
		preferences:
			"口ずさみやすいサビのフック、聴き手のテンションや感情を明確に動かす音作り。既存作品の歌詞・旋律・固有表現は一切借りず、完全オリジナルとして表現する。",
		history_use:
			"previous_storiesは過去作品であり、重複を避けるための参考です。毎日新しいコンセプトで届けるため、直近の過去作品とはジャンル・テンポ・用途（家事/作業/ドライブ/夜更け/感情など）・モチーフを明確に変え、同じ題材・小道具・感情の流れを反復しないでください。",
		use_case_playlists: config.use_case_playlists,
		previous_stories: previous,
	};
	const titleRules =
		"3〜15文字前後の短く口ずさみやすい日本語の曲名にする（例: 『余白のさみしい』『外れたチェーン』）。ラノベのあらすじ説明のような長い文章や、登場人物・状況の説明を曲名に入れない。物語の説明は概要欄に書く。";
	const titleProposal = invokeCreativeStructured({
		name: "humanity_title_proposal",
		kind: "title",
		schema: TitleProposalSchema,
		prompt: titleProposalPrompt({
			brand: "雨晴はうの人類観測所",
			rules: titleRules,
			context,
		}),
	});
	const titleReview = invokeCreativeStructured({
		name: "humanity_title_review",
		kind: "title",
		schema: TitleReviewSchema,
		prompt: titleOnlyPrompt({
			brand: "雨晴はうの人類観測所",
			title: titleProposal.value.title,
			rules: titleRules,
		}),
	});
	const authored = invokeCreativeStructured({
		name: "humanity_song_draft",
		kind: "draft",
		schema: DraftSchema,
		prompt: [
			"あなたは「雨晴はうの人類観測所」の作詞家・作曲家です。今回の歌が伝えるコンセプト、感情の動き、聴き手の体験をひとつにまとめ、歌詞と音楽とジャケット情景を一緒に設計してください。",
			"雨晴はうは全曲を単一の声で歌う歌手ではなくチャンネルのキュレーターです。今回の曲のテーマ・用途・感情に合うボーカル、テンポ、編曲、音色を自由に設計します。特定の架空の町や固定の登場人物設定に縛られず、初めて聴く人にも一曲単体で強く刺さる作品にしてください。",
			"聴き手の感情やテンションを明確に動かすことを大切にします。具体的な場面やリズム感のある言葉選びで、口ずさみたくなるサビを作ってください。",
			"既存作品の歌詞、語句、人物、場面、筋書き、旋律、固有フレーズは一切借りません。",
			"歌詞は新しく書きます。titleは3〜15文字前後の短い曲名、use_caseは4つの聴き手の場面（q1_action_boost / q2_focus_boost / q3_daily_flow / q4_night_reset）から最も合う主用途を1つ、secondary_use_casesは別の場面にもはっきり合う場合だけ最大1つ選び、なければ空配列にします。BPMだけで用途を決めず、曲のコンセプト・歌詞・完成音源がその場面に合うかで選びます。conceptは一文で伝わる今回の核、storyは概要欄に載せる2〜3文の曲の背景・聴きどころ、relationshipは曲の視点やテーマの軸、featured_charactersは視点やモチーフ名の配列（例: ['語り手']）、styleは音楽生成用の英語説明、lyricsは自由な行分けの歌詞全文、thumbnail_promptはYouTubeジャケットサムネイル用の英語画像生成プロンプト（曲の世界観とエネルギーに合う高品質なビジュアル・16:9・文字やロゴなし）、visual_directionは曲のためのレンダラー非依存の映像設計です。",
			`選んだタイトル: ${titleProposal.value.title}`,
			`タイトルだけの批評: ${JSON.stringify(titleReview.value)}`,
			"このタイトルの約束に沿う曲を作り、titleには選んだタイトルをそのまま入れてください。",
			"visual_directionには冒頭のフック、30秒以内の具体的な手掛かり、曲固有の視覚モチーフ、ブリッジまたは最後のサビでの変化・回収を記します。実音源に合わせ、クライマックスで同じモチーフを変化させて感情を一段動かし、その後は変化後の状態を保ちます。曲ごとに形式と見せ方を選び、全曲共通の物語テンプレートは使いません。現行の日次経路のJIZURAレンダーに合わせる場合は、jizuraとしてtheme_id、style_id、mood_id、palette、motif_layout_id、visual_arc、climax_palette、rationaleを含む形式もあわせて作成します。",
			`企画の手掛かり: ${JSON.stringify(context)}`,
		].join("\n\n"),
	});
	const draft = authored.value;
	const titleFit = invokeCreativeStructured({
		name: "humanity_title_body_review",
		kind: "title",
		schema: TitleFitSchema,
		prompt: titleFitPrompt({
			brand: "雨晴はうの人類観測所",
			rules: titleRules,
			initialTitle: titleProposal.value.title,
			titleReview: titleReview.value,
			body: `完成稿のタイトル: ${draft.title}\nコンセプト: ${draft.concept}\n物語: ${draft.story}\n人物関係: ${draft.relationship}\n登場人物: ${draft.featured_characters.join("・")}\n音楽方向: ${draft.style}\n\n完成歌詞:\n${draft.lyrics}`,
		}),
	});
	draft.title = titleFit.value.title;
	const stamp = new Date().toISOString().replaceAll(/[-:.]/g, "").slice(0, 15);
	const id = `${getCurrentDateString()}-${stamp}`;
	const musicSeed = Math.floor(Math.random() * 2 ** 31);
	const jizuraSeed = Math.floor(Math.random() * 2 ** 31);
	const runDir = path.join(outputDir, id);
	const songDir = path.join(runDir, "song");
	const requestPath = path.join(runDir, "request.json");
	fs.ensureDirSync(runDir);
	const jizuraPlanPath = path.join(runDir, "jizura.json");
	const jizuraPlan = draft.jizura
		? HumanityJizuraPlanRecordSchema.parse({
				...draft.jizura,
				version: 1,
				generation_id: id,
				title: draft.title,
				seed: jizuraSeed,
			})
		: undefined;
	if (jizuraPlan) fs.writeJsonSync(jizuraPlanPath, jizuraPlan, { spaces: 2 });
	fs.writeJsonSync(path.join(runDir, "creative_authoring.json"), {
		model_routes: {
			title_proposal: titleProposal.receipt,
			title_review: titleReview.receipt,
			draft: authored.receipt,
			title_fit: titleFit.receipt,
		},
		previous_stories: previous,
		use_case: draft.use_case,
		secondary_use_cases: draft.secondary_use_cases,
		concept: draft.concept,
		story: draft.story,
		relationship: draft.relationship,
		featured_characters: draft.featured_characters,
		thumbnail_prompt: draft.thumbnail_prompt,
		visual_direction: draft.visual_direction,
		...(jizuraPlan
			? {
					jizura_plan: {
						path: "jizura.json",
						sha256: sha256File(jizuraPlanPath),
						provider: authored.receipt.provider,
						model: authored.receipt.model,
						conversation_id: authored.receipt.conversation_id,
						usage: authored.receipt.usage,
					},
				}
			: {}),
		title: draft.title,
		title_proposal: titleProposal.value,
		title_proposal_usage: titleProposal.receipt.usage,
		title_proposal_conversation: titleProposal.receipt.conversation_id,
		title_review: titleReview.value,
		title_review_usage: titleReview.receipt.usage,
		title_review_conversation: titleReview.receipt.conversation_id,
		authoring_usage: authored.receipt.usage,
		authoring_conversation: authored.receipt.conversation_id,
		title_fit: titleFit.value,
		title_fit_usage: titleFit.receipt.usage,
		title_fit_conversation: titleFit.receipt.conversation_id,
	});
	if (brief) fs.writeJsonSync(path.join(runDir, "brief.json"), { brief });
	fs.writeJsonSync(requestPath, {
		id,
		style: draft.style,
		lyrics: draft.lyrics.trim(),
		cot: "full",
		seed: musicSeed,
	});
	run(
		[
			"uv",
			"run",
			"--offline",
			"--no-project",
			"--no-python-downloads",
			"--python",
			path.join(config.yue.dir, config.yue.python),
			config.yue.script,
			"generate",
			"--request",
			requestPath,
			"--output",
			songDir,
			"--device",
			config.yue.device,
			"--memory-budget-gib",
			String(config.yue.memory_budget_gib),
			"--offline",
		],
		{ cwd: config.yue.dir, env: { HF_HOME: config.yue.hf_home } },
	);
	run([
		"ffmpeg",
		"-y",
		"-loglevel",
		"error",
		"-i",
		path.join(songDir, "audio.flac"),
		"-b:a",
		config.playlist.bitrate,
		path.join(songDir, config.playlist.audio_file),
	]);
	const result = fs.readJsonSync(path.join(songDir, "result.json"));
	const row: GenerationRow = {
		kind: "generation",
		id,
		at: new Date().toISOString(),
		cell: { direction: draft.style },
		title: draft.title,
		seed: musicSeed,
		audio: path.join(songDir, "audio.flac"),
		audio_sha256: sha256File(path.join(songDir, "audio.flac")),
		seconds: result.audio_seconds,
		truncated: Object.values(result.truncated as Record<string, boolean>).some(
			Boolean,
		),
	};
	append(row);
	writePlaylist();
	return row;
}

function rate(id: string, score: number, note: string): void {
	if (!generations(readLedger()).some((row) => row.id === id))
		throw new Error(`unknown song id: ${id}`);
	if (score < config.rating.min || score > config.rating.max)
		throw new Error(`score must be ${config.rating.min}-${config.rating.max}`);
	append({ kind: "rating", id, at: new Date().toISOString(), score, note });
	writePlaylist();
}

function report(): void {
	const rows = readLedger();
	const scores = scoresOf(rows);
	const songs = generations(rows);
	console.log(
		JSON.stringify(
			{
				songs: songs.length,
				rated: scores.size,
				average_rating: scores.size
					? [...scores.values()].reduce((sum, score) => sum + score, 0) /
						scores.size
					: null,
			},
			null,
			2,
		),
	);
}

function runPaths(date: string, slot?: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
		throw new Error("DATE=YYYY-MM-DD is required");
	const name = `${config.run.name_prefix}${date}${slot ? `-${slot}` : ""}`;
	return {
		dir: path.join(ROOT, "runs", config.run.bucket, name),
		runId: `${config.run.bucket}/${name}`,
	};
}

function probeSeconds(file: string): number {
	return Number(
		run([
			"ffprobe",
			"-v",
			"error",
			"-show_entries",
			"format=duration",
			"-of",
			"csv=p=0",
			file,
		]).trim(),
	);
}

function probeAudio(file: string): {
	sample_rate: number;
	channels: number;
	channel_layout?: string;
	seconds: number;
} {
	const data = JSON.parse(
		run([
			"ffprobe",
			"-v",
			"error",
			"-select_streams",
			"a:0",
			"-show_entries",
			"stream=sample_rate,channels,channel_layout",
			"-show_entries",
			"format=duration",
			"-of",
			"json",
			file,
		]),
	) as {
		streams?: Array<{
			sample_rate?: string;
			channels?: number;
			channel_layout?: string;
		}>;
		format?: { duration?: string };
	};
	const stream = data.streams?.[0];
	if (!stream?.sample_rate || !stream.channels || !data.format?.duration)
		throw new Error(`audio metadata is missing: ${file}`);
	return {
		sample_rate: Number(stream.sample_rate),
		channels: stream.channels,
		channel_layout: stream.channel_layout,
		seconds: Number(data.format.duration),
	};
}

function songOfRun(dir: string): GenerationRow | undefined {
	return generations(readLedger()).find(
		(row) => row.id === fs.readJsonSync(path.join(dir, "song.json")).id,
	);
}

function renderJizura(
	audio: string,
	lyrics: string,
	visualPlan: string,
	outputDir: string,
): void {
	if (
		!config.pv.chrome ||
		!config.pv.jizura_html ||
		!config.pv.jizura_version ||
		!fs.existsSync(config.pv.chrome) ||
		!fs.existsSync(path.join(ROOT, config.pv.jizura_html)) ||
		!fs.existsSync(path.join(ROOT, config.pv.jizura_version))
	)
		throw new Error("JIZURA renderer settings or runtime files are missing");
	const recordPath = path.join(outputDir, config.pv.record);
	const startedAt = Date.now();
	run(
		[
			"uv",
			"run",
			"--group",
			"pv",
			"python",
			"scripts/humanity_pv.py",
			audio,
			lyrics,
			visualPlan,
			outputDir,
		],
		{ cwd: ROOT },
	);
	if (!fs.existsSync(recordPath))
		throw new Error("JIZURA render did not write its PV record");
	const record = fs.readJsonSync(recordPath) as {
		timings_ms?: Record<string, number>;
	};
	fs.writeJsonSync(
		recordPath,
		{
			...record,
			timings_ms: {
				...record.timings_ms,
				typescript_jizura_call: Date.now() - startedAt,
			},
		},
		{ spaces: 2 },
	);
}

async function prepare(date: string, slot?: string): Promise<void> {
	const { dir, runId } = runPaths(date, slot);
	fs.ensureDirSync(dir);
	const songRef = path.join(dir, "song.json");
	const brief = process.env.HUMANITY_BRIEF?.trim() || undefined;
	const song = fs.existsSync(songRef) ? songOfRun(dir) : await generate(brief);
	if (!song) throw new Error("song.json refers to an unknown song");
	fs.writeJsonSync(songRef, { id: song.id });
	const songDir = path.dirname(song.audio);
	const generationDir = path.dirname(songDir);
	const request = fs.readJsonSync(path.join(generationDir, "request.json"));
	const visualPlanPath = loadJizuraPlan(generationDir, request.id);
	const lyricsPath = path.join(dir, "lyrics.txt");
	fs.writeFileSync(lyricsPath, request.lyrics);
	if (brief) {
		const briefPath = path.join(path.dirname(songDir), "brief.json");
		if (!fs.existsSync(briefPath) || fs.readJsonSync(briefPath).brief !== brief)
			throw new Error("HUMANITY_BRIEF does not match the existing song");
	}
	const videoPath = path.join(dir, config.pv.file);
	const pvRecordPath = path.join(dir, config.pv.record);
	if (!fs.existsSync(pvRecordPath))
		renderJizura(song.audio, lyricsPath, visualPlanPath, dir);
	const videoAudio = probeAudio(videoPath);
	const authoringPath = path.join(generationDir, "creative_authoring.json");
	const authoring = fs.existsSync(authoringPath)
		? (fs.readJsonSync(authoringPath) as {
				concept?: string;
				story?: string;
				featured_characters?: string[];
				thumbnail_prompt?: string;
			})
		: {};
	const thumbnailPath = path.join(dir, config.thumbnail.file);
	if (!fs.existsSync(thumbnailPath)) {
		const imageTool = config.thumbnail.image_tool;
		const generatedArt =
			imageTool && authoring.thumbnail_prompt && Bun.which(imageTool.command);
		if (generatedArt && imageTool && authoring.thumbnail_prompt) {
			const artSource = path.join(dir, "thumbnail_source.png");
			run([
				imageTool.command,
				authoring.thumbnail_prompt,
				artSource,
				"--size",
				imageTool.size,
			]);
			run([
				"ffmpeg",
				"-y",
				"-loglevel",
				"error",
				"-i",
				artSource,
				"-vf",
				`scale=${config.thumbnail.width}:${config.thumbnail.height}:force_original_aspect_ratio=increase,crop=${config.thumbnail.width}:${config.thumbnail.height}`,
				"-q:v",
				String(config.thumbnail.quality),
				thumbnailPath,
			]);
			fs.writeJsonSync(
				path.join(dir, "thumbnail.json"),
				{
					source: "image_tool",
					tool: imageTool.command,
					size: imageTool.size,
					prompt: authoring.thumbnail_prompt,
					sha256: sha256File(thumbnailPath),
				},
				{ spaces: 2 },
			);
		} else {
			run([
				"ffmpeg",
				"-y",
				"-loglevel",
				"error",
				"-ss",
				String(config.thumbnail.at_seconds),
				"-i",
				videoPath,
				"-frames:v",
				"1",
				"-vf",
				`scale=${config.thumbnail.width}:${config.thumbnail.height}:force_original_aspect_ratio=increase,crop=${config.thumbnail.width}:${config.thumbnail.height}`,
				"-q:v",
				String(config.thumbnail.quality),
				thumbnailPath,
			]);
			fs.writeJsonSync(
				path.join(dir, "thumbnail.json"),
				{
					source: "video_frame",
					at_seconds: config.thumbnail.at_seconds,
					sha256: sha256File(thumbnailPath),
				},
				{ spaces: 2 },
			);
		}
	}
	const title = `${song.title}${config.metadata.title_suffix}`;
	const description = fillTemplate(config.metadata.description, {
		...song.cell,
		title,
		concept: authoring.concept ?? "",
		story: authoring.story ?? "",
		characters: authoring.featured_characters?.join("・") ?? "雨晴 はう",
		lyrics: request.lyrics,
		ai_disclosure: config.metadata.ai_disclosure,
		credit: config.metadata.credit,
	}).replaceAll(/\n{3,}/g, "\n\n");
	fs.writeJsonSync(
		path.join(dir, "state.json"),
		{
			run_id: runId,
			bucket: config.run.bucket,
			status: "READY",
			video_path: videoPath,
			thumbnail_path: thumbnailPath,
			contains_synthetic_media: true,
			metadata: {
				title,
				thumbnail_title: title,
				description,
				tags: config.metadata.tags,
			},
		},
		{ spaces: 2 },
	);
	const audit = musicAudit(
		{
			result: fs.readJsonSync(path.join(songDir, "result.json")),
			requestSeed: request.seed,
			song,
			actualAudioSha256: sha256File(song.audio),
			videoAudio,
			videoSeconds: probeSeconds(videoPath),
			licenseText: fs.readFileSync(config.yue.license_file, "utf-8"),
			pv: fs.readJsonSync(pvRecordPath),
			videoSha256: sha256File(videoPath),
			lyricsGenerated: Boolean(request.lyrics),
		},
		config,
	);
	fs.outputJsonSync(path.join(dir, "audit", "result.json"), audit, {
		spaces: 2,
	});
	await syncRunIsolated("humanity", path.basename(dir));
	console.log(
		JSON.stringify({
			run_id: runId,
			song: song.id,
			audit: Object.fromEntries(
				Object.entries(audit).map(([name, c]) => [name, c.status]),
			),
		}),
	);
}

function prepareBinaural(sourceId: string, date: string, slot: string): void {
	if (
		!sourceId ||
		!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
		!/^[A-Za-z0-9]+$/.test(slot)
	)
		throw new Error("SOURCE and alphanumeric SLOT are required");
	const source = generations(readLedger()).find((row) => row.id === sourceId);
	if (!source) throw new Error(`unknown source song id: ${sourceId}`);
	if (source.truncated) throw new Error("source song is truncated");
	if (!fs.existsSync(source.audio))
		throw new Error(`source audio is missing: ${source.audio}`);
	const sourceHash = sha256File(source.audio);
	if (sourceHash !== source.audio_sha256)
		throw new Error("source audio hash differs from the generation ledger");
	if (!fs.existsSync(config.spatial.checkpoint_dir))
		throw new Error("Stereo2Spatial checkpoint is missing");
	if (!Bun.which("uv") || !Bun.which("ffmpeg") || !Bun.which("ffprobe"))
		throw new Error("uv, ffmpeg and ffprobe must be available on PATH");
	const { dir, runId } = runPaths(date, slot);
	if (fs.existsSync(dir))
		throw new Error(`binaural run already exists: ${runId}`);
	const sourceAudio = probeAudio(source.audio);
	if (sourceAudio.channels !== 2)
		throw new Error("Stereo2Spatial requires a stereo source audio file");
	const requestPath = path.join(
		path.dirname(path.dirname(source.audio)),
		"request.json",
	);
	const request = fs.readJsonSync(requestPath) as {
		id?: string;
		lyrics?: string;
	};
	if (!request.lyrics) throw new Error("source song lyrics are missing");
	if (request.id !== source.id)
		throw new Error(
			"source song request ID differs from its generation ledger ID",
		);
	const visualPlanPath = loadJizuraPlan(path.dirname(requestPath), source.id);
	const stageDir = fs.mkdtempSync(
		path.join(path.dirname(dir), `.music-${date}-${slot}-`),
	);
	try {
		const lyricsPath = path.join(stageDir, "lyrics.txt");
		fs.writeFileSync(lyricsPath, request.lyrics);
		const outputAudio = path.join(stageDir, "binaural.wav");
		const reportPath = path.join(stageDir, "spatial-report.json");
		run(
			[
				"uv",
				"run",
				"--project",
				"tools/spatial-audio",
				"--locked",
				"--offline",
				"stereo2spatial-infer",
				"--checkpoint",
				config.spatial.checkpoint_dir,
				"--input-audio",
				source.audio,
				"--output-audio",
				outputAudio,
				"--device",
				config.spatial.device,
				"--report-json",
				reportPath,
			],
			{ cwd: ROOT },
		);
		const binauralAudio = probeAudio(outputAudio);
		if (
			binauralAudio.sample_rate !== config.spatial.output_sample_rate ||
			binauralAudio.channels !== 2
		)
			throw new Error("Stereo2Spatial did not create 48 kHz two-channel audio");
		if (
			Math.abs(binauralAudio.seconds - sourceAudio.seconds) >
			config.audit.duration_tolerance_seconds
		)
			throw new Error("binaural audio duration differs from the source");
		fs.writeJsonSync(
			path.join(stageDir, "song.json"),
			{ id: source.id },
			{ spaces: 2 },
		);
		fs.writeJsonSync(
			path.join(stageDir, "spatial.json"),
			{
				source_generation_id: source.id,
				source_audio_sha256: sourceHash,
				lyrics_sha256: sha256File(lyricsPath),
				model_id: config.spatial.model_id,
				model_revision: config.spatial.model_revision,
				repository: config.spatial.repository,
				repo_commit: config.spatial.repo_commit,
				device: config.spatial.device,
				output_audio_sha256: sha256File(outputAudio),
				output_audio: binauralAudio,
				manual_listening: "UNVERIFIED",
			},
			{ spaces: 2 },
		);
		const videoPath = path.join(stageDir, config.pv.file);
		renderJizura(outputAudio, lyricsPath, visualPlanPath, stageDir);
		const thumbnailPath = path.join(stageDir, config.thumbnail.file);
		run([
			"ffmpeg",
			"-y",
			"-loglevel",
			"error",
			"-ss",
			String(config.thumbnail.at_seconds),
			"-i",
			videoPath,
			"-frames:v",
			"1",
			"-vf",
			`scale=${config.thumbnail.width}:${config.thumbnail.height}:force_original_aspect_ratio=increase,crop=${config.thumbnail.width}:${config.thumbnail.height}`,
			"-q:v",
			String(config.thumbnail.quality),
			thumbnailPath,
		]);
		const title = `${source.title} [バイノーラル版]${config.metadata.title_suffix}`;
		fs.writeJsonSync(
			path.join(stageDir, "state.json"),
			{
				run_id: runId,
				bucket: config.run.bucket,
				status: "READY",
				video_path: path.join(dir, config.pv.file),
				thumbnail_path: path.join(dir, config.thumbnail.file),
				contains_synthetic_media: true,
				metadata: {
					title,
					thumbnail_title: title,
					description: `${fillTemplate(config.metadata.description, {
						...source.cell,
						title,
						lyrics: request.lyrics,
						ai_disclosure: config.metadata.ai_disclosure,
						credit: `${config.metadata.credit} / Spatial audio: Stereo2Spatial`,
					})}\n\nヘッドホン向けのバイノーラル版です。`,
					tags: config.metadata.tags,
				},
			},
			{ spaces: 2 },
		);
		fs.outputJsonSync(
			path.join(stageDir, "audit", "spatial-audio.json"),
			{
				checks: {
					source_audio_matches_ledger: sourceHash === source.audio_sha256,
					binaural_audio_is_48k_stereo:
						binauralAudio.sample_rate === config.spatial.output_sample_rate &&
						binauralAudio.channels === 2,
					duration_matches_source:
						Math.abs(binauralAudio.seconds - sourceAudio.seconds) <=
						config.audit.duration_tolerance_seconds,
					video_matches_audio:
						Math.abs(probeSeconds(videoPath) - binauralAudio.seconds) <=
						config.audit.duration_tolerance_seconds,
				},
				manual_listening: "UNVERIFIED",
				model: {
					id: config.spatial.model_id,
					revision: config.spatial.model_revision,
					repository_commit: config.spatial.repo_commit,
					device: config.spatial.device,
				},
			},
			{ spaces: 2 },
		);
		if (fs.existsSync(dir))
			throw new Error(`binaural run was created concurrently: ${runId}`);
		fs.renameSync(stageDir, dir);
		console.log(
			JSON.stringify({
				run_id: runId,
				source: source.id,
				binaural_audio: binauralAudio,
			}),
		);
	} finally {
		if (fs.existsSync(stageDir)) fs.removeSync(stageDir);
	}
}

async function youtubePlaylist(date: string, slot?: string): Promise<void> {
	const { dir } = runPaths(date, slot);
	const song = songOfRun(dir);
	if (!song) throw new Error("song.json refers to an unknown song");
	const videoId: string = fs.readJsonSync(
		path.join(dir, "publish", "receipt.json"),
	).youtube.video_id;
	const profile = YOUTUBE_PROFILES.humanity;
	const { auth } = await createYouTubeOAuthClient(profile.profileName);
	await assertYouTubeChannelMatchesProfile(auth, profile);
	const youtube = google.youtube({ version: "v3", auth });
	const current = (
		await youtube.videos.list({ part: ["status"], id: [videoId] })
	).data.items?.[0]?.status;
	const labeled = await youtube.videos.update({
		part: ["status"],
		requestBody: {
			id: videoId,
			status: {
				privacyStatus: current?.privacyStatus,
				selfDeclaredMadeForKids: current?.selfDeclaredMadeForKids ?? false,
				embeddable: current?.embeddable,
				license: current?.license,
				publicStatsViewable: current?.publicStatsViewable,
				containsSyntheticMedia: true,
			},
		},
	});
	if (labeled.data.status?.containsSyntheticMedia !== true)
		throw new Error(`synthetic media label was not applied to ${videoId}`);
	const stored = readLedger().find((row) => row.kind === "playlist");
	const playlistId =
		stored?.kind === "playlist"
			? stored.playlist_id
			: (
					await youtube.playlists.insert({
						part: ["snippet", "status"],
						requestBody: {
							snippet: {
								title: config.youtube_playlist.title,
								description: config.youtube_playlist.description,
							},
							status: { privacyStatus: config.youtube_playlist.privacy },
						},
					})
				).data.id;
	if (!playlistId) throw new Error("playlist id is missing");
	const playlistUrl = `${YOUTUBE_PLAYLIST_URL}${playlistId}`;
	if (!stored)
		append({
			kind: "playlist",
			at: new Date().toISOString(),
			playlist_id: playlistId,
			playlist_url: playlistUrl,
		});
	const playlistContainsVideo = async (
		targetPlaylistId: string,
	): Promise<boolean> => {
		const page = await youtube.playlistItems.list({
			part: ["contentDetails"],
			playlistId: targetPlaylistId,
			videoId,
			maxResults: 1,
		});
		return (page.data.items ?? []).some(
			(item) => item.contentDetails?.videoId === videoId,
		);
	};
	for (
		let attempt = 0;
		attempt < config.youtube_playlist.ready_attempts;
		attempt++
	) {
		const status = (
			await youtube.videos.list({ part: ["status"], id: [videoId] })
		).data.items?.[0]?.status?.uploadStatus;
		if (status === "processed") break;
		await new Promise((resolve) =>
			setTimeout(resolve, config.youtube_playlist.ready_interval_ms),
		);
	}
	if (!(await playlistContainsVideo(playlistId)))
		await youtube.playlistItems.insert({
			part: ["snippet"],
			requestBody: {
				snippet: {
					playlistId,
					position: 0,
					resourceId: { kind: "youtube#video", videoId },
				},
			},
		});
	let verifiedInMainPlaylist = await playlistContainsVideo(playlistId);
	for (
		let attempt = 0;
		attempt < config.youtube_playlist.ready_attempts && !verifiedInMainPlaylist;
		attempt++
	) {
		await new Promise((resolve) =>
			setTimeout(resolve, config.youtube_playlist.ready_interval_ms),
		);
		verifiedInMainPlaylist = await playlistContainsVideo(playlistId);
	}
	if (!verifiedInMainPlaylist)
		throw new Error(`playlist read-back does not contain ${videoId}`);
	const useCasePlaylistUrls: Partial<Record<string, string>> = {};
	const creativePath = path.join(outputDir, song.id, "creative_authoring.json");
	if (fs.existsSync(creativePath)) {
		const useCases = parseHumanityUseCases(fs.readJsonSync(creativePath));
		if (useCases.length > 0) {
			const ucStatePath = path.join(
				ROOT,
				"data",
				"state",
				"humanity",
				"use_case_playlists.json",
			);
			const ucState: Record<string, string> = fs.existsSync(ucStatePath)
				? (fs.readJsonSync(ucStatePath) as Record<string, string>)
				: {};
			for (const ucId of useCases) {
				const ucMeta = config.use_case_playlists[ucId];
				let ucPlaylistId = ucState[ucId];
				if (!ucPlaylistId) {
					const created = await youtube.playlists.insert({
						part: ["snippet", "status"],
						requestBody: {
							snippet: {
								title: ucMeta.title,
								description: ucMeta.description,
							},
							status: { privacyStatus: config.youtube_playlist.privacy },
						},
					});
					if (created.data.id) {
						ucPlaylistId = created.data.id;
						ucState[ucId] = ucPlaylistId;
						fs.ensureDirSync(path.dirname(ucStatePath));
						fs.writeJsonSync(ucStatePath, ucState, { spaces: 2 });
					}
				}
				if (ucPlaylistId) {
					const alreadyPresent = await playlistContainsVideo(ucPlaylistId);
					if (!alreadyPresent)
						await youtube.playlistItems.insert({
							part: ["snippet"],
							requestBody: {
								snippet: {
									playlistId: ucPlaylistId,
									position: 0,
									resourceId: { kind: "youtube#video", videoId },
								},
							},
						});
					useCasePlaylistUrls[ucId] = `${YOUTUBE_PLAYLIST_URL}${ucPlaylistId}`;
				}
			}
		}
	}
	const videoUrl = `${YOUTUBE_WATCH_URL}${videoId}`;
	if (
		!readLedger().some(
			(row) => row.kind === "publication" && row.video_id === videoId,
		)
	)
		append({
			kind: "publication",
			id: song.id,
			at: new Date().toISOString(),
			video_id: videoId,
			video_url: videoUrl,
			playlist_url: playlistUrl,
		});
	console.log(
		JSON.stringify({
			video_url: videoUrl,
			playlist_url: playlistUrl,
			use_case_playlist_urls: useCasePlaylistUrls,
		}),
	);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "generate") console.log(JSON.stringify(await generate()));
else if (command === "rate")
	rate(rest[0] ?? "", Number(rest[1]), rest[2] ?? "");
else if (command === "report") report();
else if (command === "playlist") writePlaylist();
else if (command === "preflight") preflight();
else if (command === "prepare") await prepare(rest[0] ?? "", rest[1]);
else if (command === "prepare-binaural")
	prepareBinaural(rest[0] ?? "", rest[1] ?? "", rest[2] ?? "");
else if (command === "youtube-playlist")
	await youtubePlaylist(rest[0] ?? "", rest[1]);
else
	throw new Error(
		"usage: generate | rate <id> <score> [note] | report | playlist | preflight | prepare <date> [slot] | prepare-binaural <source-id> <date> <slot> | youtube-playlist <date> [slot]",
	);
