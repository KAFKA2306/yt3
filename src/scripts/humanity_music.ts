import path from "node:path";
import fs from "fs-extra";
import { google } from "googleapis";
import { z } from "zod";
import {
	fillTemplate,
	type GenerationRow,
	generations,
	type LedgerRow,
	loadMusicConfig,
	musicAudit,
	parseLedger,
	playlistText,
	publishedSeconds,
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
import { getCurrentDateString, invokeStructuredLlm, ROOT } from "../io/core.js";

const config = loadMusicConfig(ROOT);
const outputDir = path.join(ROOT, config.output_dir);
const ledgerPath = path.join(outputDir, "ledger.jsonl");
const DraftSchema = z.object({
	title: z.string().min(1),
	style: z.string().min(1),
	lyrics: z.string().min(1),
});

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
		Bun.spawnSync(["codex", "login", "status"]).exitCode === 0
			? ""
			: "codex is not logged in",
		fs.existsSync(config.pv.chrome) ? "" : "pv chrome is missing",
		fs.existsSync(path.join(ROOT, config.pv.jizura_html))
			? ""
			: "JIZURA html is missing",
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
	const draft = await invokeStructuredLlm({
		schema: DraftSchema,
		name: "humanity_music_draft",
		llmOptions: {
			domainId: "humanity_observatory",
			temperature: config.temperature,
		},
		messages: () => [
			{
				role: "system",
				content: `あなたは人類観測所の作詞家・作曲家です。${brief ? "渡された企画を手掛かりにし、" : "今回の歌の核を自分で見つけ、"}その歌に固有の世界と感情を、言葉と音楽を合わせて作ります。人間への温かい関心を保ち、題材、人物、関係、視点、展開、語調、尺、歌詞の形は今回に合わせて自由に選びます。

言葉と旋律の響きや歌い心地を考えます。世界観の入口、物語の作り方、語彙、反復、韻、比喩、感情の見せ方は固定しません。今回に合う表現だけを選び、不要な説明や決まり文句を避けます。

ユーザーはDECO*27の「ラブパラ」の世界観づくりと歌詞づくりを好みます。曲の核から世界と言葉を一緒に組み立てる発想を参考にし、特定曲の歌詞、語句、人物、場面、筋書きは借りません。

ユーザーはIMOJISTのチャンネル（https://www.youtube.com/@IMOJIST）の曲調と音作りを好みます。その好みを参考にできる場面では活かしつつ、特定の曲やチャンネルの型に固定しません。曲に合う音楽方向、テンポ、編曲、音色、歌声を自分で設計し、既存曲の旋律や固有のフレーズを写しません。

歌詞は新しく書き、既存の歌詞や固有の言い回しは流用しません。titleは曲名、styleはこの曲に合わせた音楽生成用の英語説明、lyricsは自由な行分けの歌詞全文です。`,
			},
			{
				role: "user",
				content: JSON.stringify(brief ? { brief } : {}),
			},
		],
	});
	const stamp = new Date().toISOString().replaceAll(/[-:.]/g, "").slice(0, 15);
	const id = `${getCurrentDateString()}-${stamp}`;
	const seed = Math.floor(Math.random() * 2 ** 31);
	const runDir = path.join(outputDir, id);
	const songDir = path.join(runDir, "song");
	const requestPath = path.join(runDir, "request.json");
	fs.ensureDirSync(runDir);
	if (brief) fs.writeJsonSync(path.join(runDir, "brief.json"), { brief });
	fs.writeJsonSync(requestPath, {
		id,
		style: draft.style,
		lyrics: draft.lyrics.trim(),
		cot: "full",
		seed,
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
		seed,
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

async function prepare(date: string, slot?: string): Promise<void> {
	const { dir, runId } = runPaths(date, slot);
	preflight();
	fs.ensureDirSync(dir);
	const songRef = path.join(dir, "song.json");
	const brief = process.env.HUMANITY_BRIEF?.trim() || undefined;
	const song = fs.existsSync(songRef) ? songOfRun(dir) : await generate(brief);
	if (!song) throw new Error("song.json refers to an unknown song");
	fs.writeJsonSync(songRef, { id: song.id });
	const songDir = path.dirname(song.audio);
	const request = fs.readJsonSync(
		path.join(path.dirname(songDir), "request.json"),
	);
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
		run(
			[
				"uv",
				"run",
				"--group",
				"pv",
				"python",
				"scripts/humanity_pv.py",
				song.audio,
				lyricsPath,
				dir,
			],
			{ cwd: ROOT },
		);
	const thumbnailPath = path.join(dir, config.thumbnail.file);
	if (!fs.existsSync(thumbnailPath))
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
	const title = `${song.title}${config.metadata.title_suffix}`;
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
				description: fillTemplate(config.metadata.description, {
					...song.cell,
					title,
					lyrics: request.lyrics,
					ai_disclosure: config.metadata.ai_disclosure,
					credit: config.metadata.credit,
				}),
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
	const request = fs.readJsonSync(requestPath) as { lyrics?: string };
	if (!request.lyrics) throw new Error("source song lyrics are missing");
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
		const pvRecordPath = path.join(stageDir, config.pv.record);
		run(
			[
				"uv",
				"run",
				"--group",
				"pv",
				"python",
				"scripts/humanity_pv.py",
				outputAudio,
				lyricsPath,
				stageDir,
			],
			{ cwd: ROOT },
		);
		if (!fs.existsSync(pvRecordPath))
			throw new Error("JIZURA render did not write its PV record");
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
				video_path: videoPath,
				thumbnail_path: thumbnailPath,
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
	const listItems = async (): Promise<string[]> => {
		const ids: string[] = [];
		let pageToken: string | undefined;
		do {
			const page = await youtube.playlistItems.list({
				part: ["contentDetails"],
				playlistId,
				maxResults: 50,
				pageToken,
			});
			ids.push(
				...(page.data.items ?? []).flatMap((item) =>
					item.contentDetails?.videoId ? [item.contentDetails.videoId] : [],
				),
			);
			pageToken = page.data.nextPageToken ?? undefined;
		} while (pageToken);
		return ids;
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
	if (!(await listItems()).includes(videoId))
		await youtube.playlistItems.insert({
			part: ["snippet"],
			requestBody: {
				snippet: {
					playlistId,
					resourceId: { kind: "youtube#video", videoId },
				},
			},
		});
	for (
		let attempt = 0;
		attempt < config.youtube_playlist.ready_attempts &&
		!(await listItems()).includes(videoId);
		attempt++
	)
		await new Promise((resolve) =>
			setTimeout(resolve, config.youtube_playlist.ready_interval_ms),
		);
	if (!(await listItems()).includes(videoId))
		throw new Error(`playlist read-back does not contain ${videoId}`);
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
		JSON.stringify({ video_url: videoUrl, playlist_url: playlistUrl }),
	);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "generate") console.log(JSON.stringify(await generate()));
else if (command === "rate")
	rate(rest[0] ?? "", Number(rest[1]), rest[2] ?? "");
else if (command === "report") report();
else if (command === "playlist") writePlaylist();
else if (command === "preflight") preflight();
else if (command === "full")
	process.exit(
		publishedSeconds(readLedger()) >=
			config.youtube_playlist.target_minutes * 60
			? 0
			: 1,
	);
else if (command === "prepare") await prepare(rest[0] ?? "", rest[1]);
else if (command === "prepare-binaural")
	prepareBinaural(rest[0] ?? "", rest[1] ?? "", rest[2] ?? "");
else if (command === "youtube-playlist")
	await youtubePlaylist(rest[0] ?? "", rest[1]);
else
	throw new Error(
		"usage: generate | rate <id> <score> [note] | report | playlist | preflight | full | prepare <date> [slot] | prepare-binaural <source-id> <date> <slot> | youtube-playlist <date> [slot]",
	);
