import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { sha256File } from "../domain/publication_state.js";
import {
	type PoolEntry,
	type ReferenceCandidate,
	type ScriptDraft,
	ScriptDraftSchema,
	assertUnprivileged,
	buildDescription,
	buildTitle,
	loadPool,
	loadYawaConfig,
	pickEntry,
	preparationAction,
	referenceCandidateCall,
	segmentCall,
	selectReference,
	similarity,
	validateDraft,
	yawaAudit,
} from "../domain/yawa_daily.js";
import { ROOT } from "../io/core.js";

const config = loadYawaConfig(ROOT);
const bucketDir = path.join(ROOT, "runs", config.run.bucket);

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

function tailMeanDb(file: string, seconds: number): number {
	const output = run([
		"ffmpeg",
		"-hide_banner",
		"-ss",
		String(probeSeconds(file) - seconds),
		"-i",
		file,
		"-af",
		"volumedetect",
		"-f",
		"null",
		"-",
	]);
	return Number(/mean_volume: (-?[\d.]+) dB/.exec(output)?.[1]);
}

function preflight(): void {
	assertUnprivileged(process.getuid?.(), [
		config.tts.hf_home,
		path.join(ROOT, "runs"),
	]);
	const free = Number(
		run([
			"nvidia-smi",
			"--query-gpu=memory.free",
			"--format=csv,noheader,nounits",
		]).trim(),
	);
	const backend = config.tts.backends[config.tts.backend];
	const failures = [
		free >= config.tts.min_free_vram_mib
			? ""
			: `free VRAM ${free} MiB < ${config.tts.min_free_vram_mib} MiB`,
		Bun.spawnSync(["codex", "login", "status"]).exitCode === 0
			? ""
			: "codex is not logged in",
		Bun.which("codex-imagegen") ? "" : "codex-imagegen is not on PATH",
		Bun.which("ffmpeg") ? "" : "ffmpeg is not on PATH",
		Bun.which("uv") ? "" : "uv is not on PATH",
		backend && fs.existsSync(path.join(backend.dir, ".venv"))
			? ""
			: `TTS environment missing for backend '${config.tts.backend}'`,
		process.env.YOUTUBE_REFRESH_TOKEN ||
		fs.existsSync(path.join(ROOT, "config/.cache/youtube/yawa.json"))
			? ""
			: "yawa YouTube credentials are missing",
	].filter(Boolean);
	if (failures.length > 0)
		throw new Error(`preflight failed: ${failures.join("; ")}`);
}

function usedIds(excludeRun: string): string[] {
	if (!fs.existsSync(bucketDir)) return [];
	return fs
		.readdirSync(bucketDir)
		.filter((name) => name !== excludeRun)
		.map((name) => path.join(bucketDir, name, "selection.json"))
		.filter((file) => fs.existsSync(file))
		.map((file) => fs.readJsonSync(file).id as string);
}

function scriptPrompt(entry: PoolEntry, lastError?: string): string {
	return [
		`あなたは「夜話アーカイブ ASMR」の台本作家です。聞き手は${config.audience}。一人で夜に聴いて、疲れを下ろして眠る人です。`,
		"次の着想元の「状況」だけを参考に、日本語で完全に新しい台本を書いてください。原文の言い回し・構成・固有名詞は使わないでください。",
		`着想元の状況: ${entry.situation}（タグ: ${entry.tags.join("、")}）`,
		"条件:",
		"- 全年齢向けの癒やしと安眠の台本。性的な表現、暴力、恐怖は入れない。",
		"- 登場する話者は成人として設定する。年齢が分からない・若く見える設定は使わない。制服、学校、少女といった語も使わない。",
		"- 語り手は一人。聞き手を「あなた」と呼び、距離の近い囁きで、短い文と沈黙を使う。",
		`- segments は ${config.script.min_segments} から ${config.script.max_segments} 個。各要素は ${config.script.max_segment_chars} 文字以内の話し言葉で、1〜2文。`,
		"- 音声は TTS が読む。ト書き、括弧、記号、効果音の指示は書かない。読み仮名が要る語はひらがなで書く。",
		"- 声は固定の設定で読む（台本側で声の指定はしない）。語り手は成人の年上の女性として書く。",
		"- cover_scene は文字を含まない1枚絵の情景描写（夜、柔らかい光、人物は後ろ姿か影）。",
		"- adult_characters_confirmed は true にする。",
		'JSON だけを返す: {"title","hook","cover_scene","adult_characters_confirmed","segments":[...]}',
		lastError ? `前回の失敗: ${lastError}。直してください。` : "",
	]
		.filter(Boolean)
		.join("\n");
}

function parseJson(text: string): unknown {
	const body = text
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/```\s*$/, "");
	return JSON.parse(body);
}

function generateScript(entry: PoolEntry, outPath: string): ScriptDraft {
	let lastError: string | undefined;
	for (let attempt = 1; attempt <= config.script.max_attempts; attempt++) {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yawa-script-"));
		try {
			const answer = path.join(tmp, "answer.txt");
			run(
				[
					"codex",
					"exec",
					"--sandbox",
					config.script.sandbox,
					"--skip-git-repo-check",
					"--ephemeral",
					"-o",
					answer,
					scriptPrompt(entry, lastError),
				],
				{ cwd: tmp },
			);
			const draft = ScriptDraftSchema.parse(
				parseJson(fs.readFileSync(answer, "utf8")),
			);
			const failures = validateDraft(draft, config);
			if (failures.length > 0) throw new Error(failures.join("; "));
			fs.writeJsonSync(outPath, draft, { spaces: 2 });
			return draft;
		} catch (error) {
			lastError =
				error instanceof Error ? error.message.slice(0, 400) : String(error);
			console.error(`[yawa] script attempt ${attempt} rejected: ${lastError}`);
		} finally {
			fs.removeSync(tmp);
		}
	}
	throw new Error(`script generation failed: ${lastError}`);
}

function asrSimilarity(audio: string, expected: string): number {
	const out = run(
		[
			"uv",
			"run",
			"--no-project",
			"--with",
			"faster-whisper",
			"python",
			"-I",
			path.join(ROOT, "src/scripts/yawa_asr_qa.py"),
			audio,
			config.asr.model,
		],
		{ env: { HF_HOME: config.tts.hf_home } },
	);
	const line = out
		.trim()
		.split("\n")
		.filter((l) => l.startsWith("{"))
		.pop();
	if (!line) throw new Error("ASR produced no JSON");
	return similarity(JSON.parse(line).text as string, expected);
}

type ReferenceRecord = {
	selected: ReferenceCandidate;
	candidates: ReferenceCandidate[];
	sha256: string;
	text: string;
};

/**
 * 動画ごとの参照音声を作る。候補は参照なしで生成し、聞き取れて割れていないものを選ぶ。
 * 選んだ参照は、その動画のすべてのセグメントで使う。
 */
function generateReference(dir: string, draft: ScriptDraft): ReferenceRecord {
	const refPath = path.join(dir, "reference.wav");
	const recordPath = path.join(dir, "reference.json");
	if (fs.existsSync(recordPath) && fs.existsSync(refPath)) {
		const record = fs.readJsonSync(recordPath) as ReferenceRecord;
		if (record.sha256 === sha256File(refPath)) return record;
		throw new Error("reference.wav does not match reference.json");
	}
	const candidateDir = path.join(dir, "reference_candidates");
	fs.ensureDirSync(candidateDir);
	const candidates: ReferenceCandidate[] = config.reference.seeds.map(
		(seed) => {
			const file = path.join(candidateDir, `seed_${seed}.wav`);
			if (!fs.existsSync(file)) {
				const { cwd, command, env } = referenceCandidateCall(
					config,
					config.voice.caption,
					seed,
					file,
				);
				run(command, { cwd, env });
			}
			return {
				seed,
				file,
				asr_similarity: asrSimilarity(file, config.reference.text),
			};
		},
	);
	const selected = selectReference(candidates, config);
	fs.copyFileSync(selected.file, refPath);
	const record: ReferenceRecord = {
		selected,
		candidates,
		sha256: sha256File(refPath),
		text: config.reference.text,
	};
	fs.writeJsonSync(recordPath, record, { spaces: 2 });
	return record;
}

function synthesize(draft: ScriptDraft, dir: string, refWav: string): string {
	const ttsDir = path.join(dir, "tts");
	fs.ensureDirSync(ttsDir);
	const gap = path.join(ttsDir, "gap.wav");
	if (!fs.existsSync(gap))
		run([
			"ffmpeg",
			"-y",
			"-loglevel",
			"error",
			"-f",
			"lavfi",
			"-i",
			"anullsrc=r=48000:cl=mono",
			"-t",
			String(config.tts.gap_seconds),
			gap,
		]);
	const list: string[] = [];
	draft.segments.forEach((text, index) => {
		const wav = path.join(
			ttsDir,
			`seg_${String(index + 1).padStart(3, "0")}.wav`,
		);
		if (!fs.existsSync(wav)) {
			const { cwd, command, env } = segmentCall(
				config,
				text,
				config.voice.caption,
				refWav,
				wav,
			);
			run(command, { cwd, env });
		}
		list.push(`file '${wav}'`, `file '${gap}'`);
	});
	const listPath = path.join(ttsDir, "concat.txt");
	fs.writeFileSync(listPath, `${list.join("\n")}\n`);
	return listPath;
}

function mix(listPath: string, outPath: string): void {
	const raw = `${outPath}.raw.wav`;
	run([
		"ffmpeg",
		"-y",
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
		raw,
	]);
	const seconds = probeSeconds(raw);
	run([
		"ffmpeg",
		"-y",
		"-loglevel",
		"error",
		"-i",
		raw,
		"-f",
		"lavfi",
		"-i",
		`anoisesrc=color=brown:amplitude=0.4:sample_rate=48000:duration=${seconds + 4}`,
		"-filter_complex",
		`[1:a]lowpass=f=900,volume=${config.mix.room_tone_db}dB[tone];[0:a][tone]amix=inputs=2:duration=first:normalize=0,afade=t=in:d=1.5,afade=t=out:st=${Math.max(seconds - 4, 0)}:d=4,loudnorm=I=${config.mix.target_lufs}:TP=-2:LRA=7`,
		"-ar",
		"48000",
		"-ac",
		"1",
		outPath,
	]);
	fs.removeSync(raw);
}

async function prepare(date: string, slot?: string): Promise<void> {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
		throw new Error("DATE=YYYY-MM-DD is required");
	// 同じ日に 2 本目を作るときだけ SLOT（英数字）を付ける。省略時の名前は従来どおり。
	if (slot && !/^[a-z0-9]+$/.test(slot))
		throw new Error("SLOT must be lowercase letters or digits");
	const name = `${config.run.name_prefix}${date}${slot ? `-${slot}` : ""}`;
	const dir = path.join(bucketDir, name);
	const runId = `${config.run.bucket}/${name}`;
	const action = preparationAction({
		publishVerified:
			fs.existsSync(path.join(dir, "publish", "state.json")) &&
			fs.readJsonSync(path.join(dir, "publish", "state.json")).phase ===
				"VERIFIED",
		finalMixExists: fs.existsSync(path.join(dir, "final_mix.wav")),
		referenceExists: fs.existsSync(path.join(dir, "reference.json")),
	});
	if (action === "skip_verified") {
		console.log(
			`[yawa] ${runId} is already VERIFIED; artifacts are not regenerated`,
		);
		return;
	}
	if (action === "refuse_legacy")
		throw new Error(
			`${runId} was produced before the voice reference; refusing to add one to existing audio`,
		);
	preflight();
	fs.ensureDirSync(dir);

	const selectionPath = path.join(dir, "selection.json");
	const pool = loadPool(ROOT, config);
	const entry: PoolEntry = fs.existsSync(selectionPath)
		? (pool.find((e) => e.id === fs.readJsonSync(selectionPath).id) ??
			(() => {
				throw new Error("selection.json refers to an unknown pool entry");
			})())
		: pickEntry(pool, usedIds(name));
	fs.writeJsonSync(selectionPath, { id: entry.id }, { spaces: 2 });

	const scriptPath = path.join(dir, "script.json");
	const draft = fs.existsSync(scriptPath)
		? ScriptDraftSchema.parse(fs.readJsonSync(scriptPath))
		: generateScript(entry, scriptPath);

	const reference = generateReference(dir, draft);
	const refPath = path.join(dir, "reference.wav");

	const audioPath = path.join(dir, "final_mix.wav");
	if (!fs.existsSync(audioPath))
		mix(synthesize(draft, dir, refPath), audioPath);
	const backend = config.tts.backends[config.tts.backend];
	fs.writeJsonSync(
		path.join(dir, "tts.json"),
		{
			backend: config.tts.backend,
			checkpoint: backend?.hf_checkpoint,
			seed: config.tts.seed,
			voice_caption: config.voice.caption,
			reference_sha256: reference.sha256,
		},
		{ spaces: 2 },
	);

	const asrPath = path.join(dir, "asr.json");
	if (!fs.existsSync(asrPath))
		fs.writeJsonSync(asrPath, {
			similarity: asrSimilarity(audioPath, draft.segments.join("")),
		});

	const coverPath = path.join(dir, config.cover.file);
	const coverRecordPath = path.join(dir, "cover.json");
	if (!fs.existsSync(coverRecordPath)) {
		const prompt = `夜の静かな部屋の絵。${draft.cover_scene} 柔らかい暖色の光、落ち着いた配色、文字や記号は一切入れない、人物は後ろ姿か影のみ。16:9の構図。`;
		run([config.cover.tool, prompt, coverPath, "--size", config.cover.size]);
		fs.writeJsonSync(coverRecordPath, {
			tool: config.cover.tool,
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
			audioPath,
			"-vf",
			`scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=yuv420p`,
			"-c:v",
			"libx264",
			"-tune",
			"stillimage",
			"-crf",
			String(config.video.crf),
			"-c:a",
			"aac",
			"-b:a",
			config.video.audio_bitrate,
			"-t",
			String(probeSeconds(audioPath)),
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

	const audioSeconds = probeSeconds(audioPath);
	const title = buildTitle(draft, config);
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
				description: buildDescription(draft, entry, config, audioSeconds),
				tags: config.metadata.tags,
			},
		},
		{ spaces: 2 },
	);
	const audit = yawaAudit(
		{
			draft,
			entry,
			scriptGeneratedInRun: fs.existsSync(scriptPath),
			ttsRecord: fs.readJsonSync(path.join(dir, "tts.json")),
			referenceSha256: sha256File(refPath),
			audioSeconds,
			videoSeconds: probeSeconds(videoPath),
			tailMeanDb: tailMeanDb(audioPath, config.audit.tail_seconds),
			asrSimilarity: fs.readJsonSync(asrPath).similarity,
			cover: fs.readJsonSync(coverRecordPath),
			coverSha256: sha256File(coverPath),
		},
		config,
	);
	fs.outputJsonSync(path.join(dir, "audit", "result.json"), audit, {
		spaces: 2,
	});
	const failed = Object.values(audit).filter((c) => c.status !== "PASS");
	console.log(
		JSON.stringify({
			run_id: runId,
			entry: entry.id,
			seconds: audioSeconds,
			reference_seed: reference.selected.seed,
			audit: Object.fromEntries(
				Object.entries(audit).map(([n, c]) => [n, c.status]),
			),
		}),
	);
	if (failed.length > 0)
		throw new Error(
			`audit failed: ${failed.map((c) => `${c.name}: ${c.details}`).join(" | ")}`,
		);
}

const [command, date, slot] = process.argv.slice(2);
if (command === "preflight") preflight();
else if (command === "prepare" && date) await prepare(date, slot);
else throw new Error("usage: yawa_daily.ts preflight | prepare YYYY-MM-DD");
