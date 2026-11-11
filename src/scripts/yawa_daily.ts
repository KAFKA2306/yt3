import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { sha256File } from "../domain/publication_state.js";
import {
	assertUnprivileged,
	buildDescription,
	buildTags,
	buildTitle,
	chooseSelection,
	draftSegments,
	loadPool,
	loadYawaConfig,
	type PoolEntry,
	pickEntry,
	preparationAction,
	type ReferenceCandidate,
	referenceCandidateCall,
	runSeed,
	type ScriptDraft,
	ScriptDraftSchema,
	type Selection,
	type SelectionRecord,
	SelectionSchema,
	segmentCall,
	selectReference,
	shapeBeats,
	similarity,
	type VoiceProfile,
	validateDraft,
	voiceProfileForDate,
	yawaAudit,
} from "../domain/yawa_daily.js";
import { ROOT } from "../io/core.js";

const config = loadYawaConfig(ROOT);
const bucketDir = path.join(ROOT, "runs", config.run.bucket);
const VOICE_EVALUATOR_VERSION = "1.0.0";
type TtsDevice = "cpu" | "cuda";

function requestedTtsDevice(): TtsDevice | undefined {
	const raw = process.env.YAWA_TTS_DEVICE?.trim();
	if (!raw) return undefined;
	if (raw !== "cpu" && raw !== "cuda")
		throw new Error("YAWA_TTS_DEVICE must be cpu or cuda");
	return raw;
}

function requestedVoiceProfile(): string | undefined {
	const profileId = process.env.YAWA_VOICE_PROFILE?.trim();
	if (!profileId) return undefined;
	if (!/^[a-z0-9_-]{1,40}$/.test(profileId))
		throw new Error("YAWA_VOICE_PROFILE must be a configured profile id");
	return profileId;
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

function measureLoudness(file: string): { lufs: number; truePeakDb: number } {
	const output = run([
		"ffmpeg",
		"-hide_banner",
		"-nostats",
		"-i",
		file,
		"-af",
		"ebur128=peak=true",
		"-f",
		"null",
		"-",
	]).split("Summary:")[1];
	return {
		lufs: Number(/I:\s+(-?[\d.]+) LUFS/.exec(output ?? "")?.[1]),
		truePeakDb: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(output ?? "")?.[1]),
	};
}

function meanVolumeDb(file: string, start: number, seconds: number): number {
	const output = run([
		"ffmpeg",
		"-hide_banner",
		"-ss",
		String(start),
		"-t",
		String(seconds),
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

function observeArc(
	draft: ScriptDraft,
	name: string,
	dir: string,
	audioPath: string,
	recent: Recent,
): void {
	const segments = draftSegments(draft, config, name);
	const raw = segments.map((_, i) =>
		probeSeconds(
			path.join(dir, "tts", `seg_${String(i + 1).padStart(3, "0")}.wav`),
		),
	);
	const total = segments.reduce(
		(sum, segment, i) => sum + (raw[i] ?? 0) + segment.chapter.gap_seconds,
		0,
	);
	const scale = probeSeconds(audioPath) / total;
	let cursor = 0;
	let index = 0;
	const chapters = draft.chapters.map((chapter) => {
		const start = cursor;
		let chars = 0;
		let speech = 0;
		for (const text of chapter.segments) {
			chars += text.length;
			speech += raw[index] ?? 0;
			cursor += (raw[index] ?? 0) + (segments[index]?.chapter.gap_seconds ?? 0);
			index += 1;
		}
		const from = start * scale;
		const length = cursor * scale - from;
		return {
			name: chapter.name,
			segments: chapter.segments.length,
			chars,
			chars_per_second: Number((chars / speech).toFixed(2)),
			start_seconds: Number(from.toFixed(1)),
			seconds: Number(length.toFixed(1)),
			mean_volume_db: meanVolumeDb(audioPath, from, length),
		};
	});
	const first = segments[0]?.text ?? "";
	const last = segments[segments.length - 1]?.text ?? "";
	const worst = (current: string, past: string[]): number =>
		Number(Math.max(0, ...past.map((x) => similarity(current, x))).toFixed(3));
	fs.outputJsonSync(
		path.join(dir, "audit", "arc_observation.json"),
		{
			shape: draft.shape,
			chapters,
			overlap_with_recent: {
				title: worst(draft.title, recent.titles),
				opening: worst(first, recent.openings),
				closing: worst(last, recent.closings),
			},
		},
		{ spaces: 2 },
	);
}

function preflight(device?: TtsDevice): void {
	assertUnprivileged(process.getuid?.(), [
		config.tts.hf_home,
		path.join(ROOT, "runs"),
	]);
	const free =
		device === "cpu"
			? null
			: Number(
					run([
						"nvidia-smi",
						"--query-gpu=memory.free",
						"--format=csv,noheader,nounits",
					]).trim(),
				);
	const backend = config.tts.backends[config.tts.backend];
	const failures = [
		device === "cpu" || (free !== null && free >= config.tts.min_free_vram_mib)
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

function selectionHistory(excludeRun: string): SelectionRecord[] {
	if (!fs.existsSync(bucketDir)) return [];
	return fs
		.readdirSync(bucketDir)
		.filter((name) => name !== excludeRun)
		.map((name) => path.join(bucketDir, name, "selection.json"))
		.filter((file) => fs.existsSync(file))
		.map((file) => fs.readJsonSync(file) as SelectionRecord);
}

type Recent = { titles: string[]; openings: string[]; closings: string[] };

function recentScripts(excludeRun: string): Recent {
	const names = fs.existsSync(bucketDir)
		? fs
				.readdirSync(bucketDir)
				.filter((name) => name !== excludeRun)
				.filter((name) =>
					fs.existsSync(path.join(bucketDir, name, "script.json")),
				)
				.sort()
				.slice(-config.diversity.recent_window)
		: [];
	const scripts = names.map((name) => {
		const draft = fs.readJsonSync(path.join(bucketDir, name, "script.json"));
		const texts: string[] =
			draft.segments ??
			draft.chapters.flatMap((c: { segments: string[] }) => c.segments);
		return {
			title: draft.title as string,
			opening: texts[0] ?? "",
			closing: texts[texts.length - 1] ?? "",
		};
	});
	return {
		titles: scripts.map((x) => x.title),
		openings: scripts.map((x) => x.opening),
		closings: scripts.map((x) => x.closing),
	};
}

function scriptPrompt(
	entry: PoolEntry,
	selection: Selection,
	recent: Recent,
	runName: string,
	lastError?: string,
): string {
	const beats = shapeBeats(config, selection.shape, runName);
	const total = beats.reduce((sum, beat) => sum + beat.share, 0);
	return [
		`あなたは「夜話アーカイブ ASMR」の台本作家です。聞き手は${config.audience}。一人で夜に聴いて、疲れを下ろして眠る人です。`,
		"次の着想元の「状況」だけを参考に、日本語で完全に新しい台本を書いてください。原文の言い回し・構成・固有名詞は使わないでください。",
		`着想元の状況: ${entry.situation}（タグ: ${entry.tags.join("、")}）`,
		`今回の設定: ${Object.entries(selection.axes)
			.map(([axis, value]) => `${axis}=${value}`)
			.join("、")}。この設定を、場面の中で自然に使う。`,
		"条件:",
		"- 全年齢向けの癒やしと安眠の台本。性的な表現、暴力、恐怖は入れない。",
		"- 登場する話者は成人として設定する。年齢が分からない・若く見える設定は使わない。制服、学校、少女といった語も使わない。",
		"- 語り手は一人。聞き手を「あなた」と呼び、距離の近い囁きで、短い文と沈黙を使う。",
		`- chapters は次の ${beats.length} 章を、この順に必ず出す。全体の segments は ${config.script.min_segments} から ${config.script.max_segments} 個で、割合は segment 数の目安。各 segment は ${config.script.max_segment_chars} 文字以内の話し言葉で、1〜2文。`,
		...beats.map(
			(beat) =>
				`  - ${beat.name}（segment 数の約${Math.round((beat.share / total) * 100)}%）: ${beat.brief}`,
		),
		`- 直近の台本と、題名の語、冒頭の文、最後の文を重ねない。直近の題名: ${recent.titles.join(" / ")}`,
		`  直近の冒頭の文: ${recent.openings.join(" / ")}`,
		`  直近の最後の文: ${recent.closings.join(" / ")}`,
		"- 音声は TTS が読む。ト書き、括弧、記号、効果音の指示は書かない。読み仮名が要る語はひらがなで書く。",
		"- 声は固定の設定で読む（台本側で声の指定はしない）。語り手は成人の年上の女性として書く。",
		"- cover_scene は文字を含まない1枚絵の情景描写（夜、柔らかい光、人物は後ろ姿か影）。",
		"- adult_characters_confirmed は true にする。",
		'JSON だけを返す: {"title","hook","cover_scene","adult_characters_confirmed","chapters":[{"name","segments":[...]}]}',
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

function generateScript(
	entry: PoolEntry,
	selection: Selection,
	runName: string,
	outPath: string,
): ScriptDraft {
	const recent = recentScripts(runName);
	let lastError: string | undefined;
	for (let attempt = 1; attempt <= config.script.max_attempts; attempt++) {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yawa-script-"));
		try {
			const answer = path.join(tmp, "answer.txt");
			run(
				[
					"codex",
					"exec",
					"-m",
					config.script.model,
					"--sandbox",
					config.script.sandbox,
					"--skip-git-repo-check",
					"--ephemeral",
					"-o",
					answer,
					scriptPrompt(entry, selection, recent, runName, lastError),
				],
				{ cwd: tmp },
			);
			const draft = ScriptDraftSchema.parse({
				...(parseJson(fs.readFileSync(answer, "utf8")) as object),
				shape: selection.shape,
			});
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
	profile_id: string;
	selected: ReferenceCandidate;
	candidates: ReferenceCandidate[];
	sha256: string;
	text: string;
};

/**
 * 動画ごとの参照音声を作る。候補は参照なしで生成し、聞き取れて割れていないものを選ぶ。
 * 選んだ参照は、その動画のすべてのセグメントで使う。
 */
function generateReference(
	dir: string,
	name: string,
	voiceProfile: VoiceProfile,
	device?: TtsDevice,
): ReferenceRecord {
	const refPath = path.join(dir, "reference.wav");
	const recordPath = path.join(dir, "reference.json");
	if (fs.existsSync(recordPath) && fs.existsSync(refPath)) {
		const record = fs.readJsonSync(recordPath) as ReferenceRecord;
		if (record.profile_id !== voiceProfile.id)
			throw new Error("stored voice reference uses a different daily profile");
		if (record.sha256 === sha256File(refPath)) return record;
		throw new Error("reference.wav does not match reference.json");
	}
	const candidateDir = path.join(dir, "reference_candidates");
	fs.ensureDirSync(candidateDir);
	const seeds = Array.from({ length: config.reference.candidates }, (_, i) =>
		runSeed(name, `reference:${i}`),
	);
	const candidates: ReferenceCandidate[] = seeds.map((seed) => {
		const file = path.join(candidateDir, `${voiceProfile.id}_seed_${seed}.wav`);
		if (!fs.existsSync(file)) {
			const { cwd, command, env } = referenceCandidateCall(
				config,
				voiceProfile.caption,
				seed,
				file,
				device,
			);
			run(command, { cwd, env });
		}
		return {
			seed,
			file,
			asr_similarity: asrSimilarity(file, config.reference.text),
		};
	});
	const selected = selectReference(candidates);
	fs.copyFileSync(selected.file, refPath);
	const record: ReferenceRecord = {
		profile_id: voiceProfile.id,
		selected,
		candidates,
		sha256: sha256File(refPath),
		text: config.reference.text,
	};
	fs.writeJsonSync(recordPath, record, { spaces: 2 });
	return record;
}

function measureReferenceVoice(
	dir: string,
	referencePath: string,
	referenceSha256: string,
):
	| { status: "MEASURED"; features: Record<string, unknown> }
	| {
			status: "UNAVAILABLE";
			error: string;
	  } {
	const outputPath = path.join(dir, "voice_features.json");
	if (fs.existsSync(outputPath)) {
		const previous = fs.readJsonSync(outputPath);
		if (
			previous.reference_sha256 === referenceSha256 &&
			previous.status === "MEASURED" &&
			previous.evaluator_version === VOICE_EVALUATOR_VERSION &&
			previous.features
		)
			return { status: "MEASURED", features: previous.features };
	}
	try {
		run(
			[
				"uv",
				"run",
				"--offline",
				"--frozen",
				"--no-sync",
				"--quiet",
				"python",
				"voice_physics.py",
				"extract",
				referencePath,
				"--output",
				outputPath,
			],
			{ cwd: path.join(ROOT, "tools/yawa-voice-eval") },
		);
		const extracted = fs.readJsonSync(outputPath);
		if (!extracted.features || Object.keys(extracted.features).length === 0)
			throw new Error("voice evaluator returned no acoustic features");
		if (extracted.evaluator_version !== VOICE_EVALUATOR_VERSION)
			throw new Error("voice evaluator version mismatch");
		const result = {
			status: "MEASURED" as const,
			reference_sha256: referenceSha256,
			evaluator_version: extracted.evaluator_version as string,
			features: extracted.features as Record<string, unknown>,
		};
		fs.writeJsonSync(outputPath, result, { spaces: 2 });
		return result;
	} catch (error) {
		const result = {
			status: "UNAVAILABLE" as const,
			reference_sha256: referenceSha256,
			error: error instanceof Error ? error.message : String(error),
		};
		fs.writeJsonSync(outputPath, result, { spaces: 2 });
		return result;
	}
}

function synthesize(
	draft: ScriptDraft,
	dir: string,
	refWav: string,
	voiceProfile: VoiceProfile,
	device?: TtsDevice,
): string {
	const ttsDir = path.join(dir, "tts");
	fs.ensureDirSync(ttsDir);
	const gapFile = (seconds: number): string => {
		const gap = path.join(ttsDir, `gap_${seconds}.wav`);
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
				String(seconds),
				gap,
			]);
		return gap;
	};
	const list: string[] = [];
	const runConfig = {
		...config,
		voice: { ...config.voice, caption: voiceProfile.caption },
	};
	draftSegments(draft, config, path.basename(dir)).forEach((segment, index) => {
		const name = String(index + 1).padStart(3, "0");
		const wav = path.join(ttsDir, `seg_${name}.wav`);
		if (!fs.existsSync(wav)) {
			const { cwd, command, env } = segmentCall(
				runConfig,
				segment,
				refWav,
				wav,
				runSeed(path.basename(dir), "tts"),
				device,
			);
			run(command, { cwd, env });
		}
		const leveled = path.join(ttsDir, `seg_${name}.leveled.wav`);
		run([
			"ffmpeg",
			"-y",
			"-loglevel",
			"error",
			"-i",
			wav,
			"-af",
			`volume=${segment.chapter.gain_db}dB`,
			"-ar",
			"48000",
			"-ac",
			"1",
			leveled,
		]);
		list.push(`file '${leveled}'`);
		if (segment.chapter.gap_seconds > 0)
			list.push(`file '${gapFile(segment.chapter.gap_seconds)}'`);
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
		`[1:a]lowpass=f=900,volume=${config.mix.room_tone_db}dB[tone];[0:a][tone]amix=inputs=2:duration=first:normalize=0,afade=t=in:d=1.5,afade=t=out:st=${Math.max(seconds - 4, 0)}:d=4,loudnorm=I=${config.mix.target_lufs}:TP=-2:LRA=${config.mix.loudness_range}`,
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
	const profileId = requestedVoiceProfile();
	const ttsDevice = requestedTtsDevice();
	const voiceProfile = voiceProfileForDate(config, date, profileId);
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
	preflight(ttsDevice);
	fs.ensureDirSync(dir);

	const selectionPath = path.join(dir, "selection.json");
	const pool = loadPool(ROOT, config);
	const history = selectionHistory(name);
	const selection: Selection = fs.existsSync(selectionPath)
		? SelectionSchema.parse(fs.readJsonSync(selectionPath))
		: chooseSelection(
				config,
				pickEntry(
					pool,
					history.map((h) => h.id),
				).id,
				history,
				name,
			);
	const entry: PoolEntry =
		pool.find((e) => e.id === selection.id) ??
		(() => {
			throw new Error("selection.json refers to an unknown pool entry");
		})();
	fs.writeJsonSync(selectionPath, selection, { spaces: 2 });

	const scriptPath = path.join(dir, "script.json");
	const draft = fs.existsSync(scriptPath)
		? ScriptDraftSchema.parse(fs.readJsonSync(scriptPath))
		: generateScript(entry, selection, name, scriptPath);

	const reference = generateReference(dir, name, voiceProfile, ttsDevice);
	const refPath = path.join(dir, "reference.wav");
	const voiceFeatures = measureReferenceVoice(dir, refPath, reference.sha256);

	const audioPath = path.join(dir, "final_mix.wav");
	if (!fs.existsSync(audioPath))
		mix(synthesize(draft, dir, refPath, voiceProfile, ttsDevice), audioPath);
	const backend = config.tts.backends[config.tts.backend];
	fs.writeJsonSync(
		path.join(dir, "tts.json"),
		{
			backend: config.tts.backend,
			checkpoint: backend?.hf_checkpoint,
			seed: runSeed(name, "tts"),
			voice_caption: voiceProfile.caption,
			voice_profile_id: voiceProfile.id,
			tts_device: ttsDevice ?? "default",
			reference_sha256: reference.sha256,
		},
		{ spaces: 2 },
	);
	fs.writeJsonSync(
		path.join(dir, "voice_experiment.json"),
		{
			schema_version: 1,
			date,
			run_id: runId,
			profile_id: voiceProfile.id,
			profile_selection: profileId ? "explicit" : "date_rotation",
			axis: voiceProfile.axis,
			cycle_index: voiceProfile.cycle_index,
			cycle_length: voiceProfile.cycle_length,
			caption: voiceProfile.caption,
			model_id: backend?.hf_checkpoint,
			tts_device: ttsDevice ?? "default",
			tts_seed: runSeed(name, "tts"),
			reference_seed: reference.selected.seed,
			reference_sha256: reference.sha256,
			candidate_asr_similarity: reference.candidates.map((candidate) => ({
				seed: candidate.seed,
				similarity: candidate.asr_similarity,
			})),
			acoustic_measurement: voiceFeatures,
			feedback_status: "awaiting_owner_feedback",
		},
		{ spaces: 2 },
	);

	const asrPath = path.join(dir, "asr.json");
	if (!fs.existsSync(asrPath))
		fs.writeJsonSync(asrPath, {
			similarity: asrSimilarity(
				audioPath,
				draftSegments(draft, config, name)
					.map((x) => x.text)
					.join(""),
			),
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
	const title = buildTitle(draft, config, selection);
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
				tags: buildTags(config, selection),
			},
		},
		{ spaces: 2 },
	);
	const loudness = measureLoudness(audioPath);
	fs.outputJsonSync(
		path.join(dir, "audit", "measurements.json"),
		{
			audio_seconds: probeSeconds(audioPath),
			tail_mean_db: tailMeanDb(audioPath, config.audit.tail_seconds),
			asr_similarity: fs.readJsonSync(asrPath).similarity,
			integrated_lufs: loudness.lufs,
			true_peak_db: loudness.truePeakDb,
		},
		{ spaces: 2 },
	);
	const audit = yawaAudit(
		{
			runName: name,
			draft,
			entry,
			scriptGeneratedInRun: fs.existsSync(scriptPath),
			ttsRecord: fs.readJsonSync(path.join(dir, "tts.json")),
			referenceSha256: sha256File(refPath),
			audioSeconds,
			videoSeconds: probeSeconds(videoPath),
			selection,
			metadata: { title, tags: buildTags(config, selection) },
			cover: fs.readJsonSync(coverRecordPath),
			coverSha256: sha256File(coverPath),
		},
		config,
	);
	observeArc(draft, name, dir, audioPath, recentScripts(name));
	fs.outputJsonSync(path.join(dir, "audit", "result.json"), audit, {
		spaces: 2,
	});
	const failed = Object.values(audit).filter((c) => c.status !== "PASS");
	console.log(
		JSON.stringify({
			run_id: runId,
			entry: entry.id,
			seconds: audioSeconds,
			voice_profile: voiceProfile.id,
			voice_axis: voiceProfile.axis,
			voice_feature_status: voiceFeatures.status,
			voice_feature_error:
				voiceFeatures.status === "UNAVAILABLE" ? voiceFeatures.error : null,
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
if (command === "preflight") preflight(requestedTtsDevice());
else if (command === "prepare" && date) await prepare(date, slot);
else throw new Error("usage: yawa_daily.ts preflight | prepare YYYY-MM-DD");
