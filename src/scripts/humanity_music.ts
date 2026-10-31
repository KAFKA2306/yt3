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
	rarestCell,
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
	title: z.string(),
	scene: z.string(),
	style_tail: z.string(),
	sections: z.array(z.array(z.string())),
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
	const free = Number(
		run([
			"nvidia-smi",
			"--query-gpu=memory.free",
			"--format=csv,noheader,nounits",
		]).trim(),
	);
	const snapshots = fs.existsSync(config.yue.snapshot_dir)
		? fs.readdirSync(config.yue.snapshot_dir)
		: [];
	const failures = [
		free >= config.yue.min_free_vram_mib
			? ""
			: `free VRAM ${free} MiB < ${config.yue.min_free_vram_mib} MiB (another GPU process is running)`,
		Bun.spawnSync(["codex", "login", "status"]).exitCode === 0
			? ""
			: "codex is not logged in",
		Bun.which("codex-imagegen") ? "" : "codex-imagegen is not on PATH",
		Bun.which("ffmpeg") ? "" : "ffmpeg is not on PATH",
		fs.existsSync(path.join(config.yue.dir, config.yue.python))
			? ""
			: "YuE2 python environment is missing",
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
	const cell = rarestCell(readLedger(), config.axes, Math.random);
	const draft = await invokeStructuredLlm({
		schema: DraftSchema,
		name: "humanity_music_draft",
		llmOptions: {
			temperature: config.temperature,
			extra: { tools: [{ googleSearchRetrieval: {} }] },
		},
		validate: (value) => {
			if (
				value.sections.length !== config.structure.length ||
				value.sections.some(
					(lines) => lines.length !== config.lines_per_section,
				)
			)
				throw new Error("sections do not match the configured structure");
			return value;
		},
		messages: () => [
			{
				role: "system",
				content: `あなたは人類観測所の作詞家です。${brief ? "指定された企画を題材にしてください。" : config.trend_rule} ${config.lyrics_rule} sectionsは${config.structure.join("、")}の順に${config.structure.length}個、各${config.lines_per_section}行。sceneには曲の題材を表す絵の場面を日本語で1文で書く。style_tailには曲調を英語で短く書く。`,
			},
			{
				role: "user",
				content: JSON.stringify({
					...cell,
					...(brief ? { brief } : {}),
					today: getCurrentDateString(),
					past_titles: generations(readLedger()).map((row) => row.title),
				}),
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
		style: `${fillTemplate(config.style_template, cell)}, ${draft.style_tail}`,
		lyrics: config.structure
			.map((tag, i) => `[${tag}]\n${draft.sections[i]?.join("\n")}`)
			.join("\n\n"),
		cot: "full",
		seed,
	});
	run(
		[
			path.join(config.yue.dir, config.yue.python),
			config.yue.script,
			"--request",
			requestPath,
			"--output",
			songDir,
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
		cell: { ...cell, scene: draft.scene },
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
	const byAxis = Object.fromEntries(
		Object.keys(config.axes).map((axis) => {
			const groups = new Map<string, number[]>();
			for (const song of songs) {
				const score = scores.get(song.id);
				const value = song.cell[axis];
				if (score !== undefined && value)
					groups.set(value, [...(groups.get(value) ?? []), score]);
			}
			return [
				axis,
				Object.fromEntries(
					[...groups].map(([value, list]) => [
						value,
						{
							n: list.length,
							mean: list.reduce((a, b) => a + b, 0) / list.length,
						},
					]),
				),
			];
		}),
	);
	console.log(
		JSON.stringify(
			{ songs: songs.length, rated: scores.size, by_axis: byAxis },
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
	if (brief) {
		const briefPath = path.join(path.dirname(songDir), "brief.json");
		if (!fs.existsSync(briefPath) || fs.readJsonSync(briefPath).brief !== brief)
			throw new Error("HUMANITY_BRIEF does not match the existing song");
	}
	const coverPath = path.join(dir, config.cover.file);
	const coverRecordPath = path.join(dir, "cover.json");
	if (!fs.existsSync(coverRecordPath)) {
		const prompt = fillTemplate(config.cover.prompt, song.cell);
		run(["codex-imagegen", prompt, coverPath, "--size", config.cover.size]);
		fs.writeJsonSync(coverRecordPath, {
			tool: "codex-imagegen",
			prompt,
			size: config.cover.size,
			sha256: sha256File(coverPath),
		});
	}
	const videoPath = path.join(dir, config.video.file);
	const { width, height } = config.video;
	if (!fs.existsSync(videoPath))
		run([
			"ffmpeg",
			"-y",
			"-loglevel",
			"error",
			"-loop",
			"1",
			"-framerate",
			String(config.video.fps),
			"-i",
			coverPath,
			"-i",
			song.audio,
			"-vf",
			`scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=yuv420p`,
			"-c:v",
			"libx264",
			"-tune",
			"stillimage",
			"-crf",
			String(config.video.crf),
			"-af",
			`afade=t=out:st=${probeSeconds(song.audio) - config.video.fade_seconds}:d=${config.video.fade_seconds}`,
			"-c:a",
			"aac",
			"-b:a",
			config.video.audio_bitrate,
			"-t",
			String(probeSeconds(song.audio)),
			"-movflags",
			"+faststart",
			videoPath,
		]);
	const thumbnailPath = path.join(dir, config.thumbnail.file);
	if (!fs.existsSync(thumbnailPath))
		run([
			"ffmpeg",
			"-y",
			"-loglevel",
			"error",
			"-i",
			coverPath,
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
			cover: fs.readJsonSync(coverRecordPath),
			coverSha256: sha256File(coverPath),
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
else if (command === "youtube-playlist")
	await youtubePlaylist(rest[0] ?? "", rest[1]);
else
	throw new Error(
		"usage: generate | rate <id> <score> [note] | report | playlist | preflight | full | prepare <date> [slot] | youtube-playlist <date> [slot]",
	);
