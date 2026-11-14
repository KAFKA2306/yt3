import path from "node:path";
import fs from "fs-extra";
import type { AuditCheck } from "../domain/types.js";
import {
	buildMetadata,
	draftSegments,
	loadYawaConfig,
	parseYawaJson,
	runtimePath,
	type ScriptDraft,
	ScriptDraftSchema,
	YAWA_BUCKET,
	YAWA_RUN_NAME,
} from "../domain/yawa_daily.js";
import { ROOT } from "../io/core.js";

const config = loadYawaConfig(ROOT);
const ttsDir = runtimePath(ROOT, config.tts.directory);
const ttsCache = runtimePath(ROOT, config.tts.cache);
const bucket = path.join(ROOT, "runs", YAWA_BUCKET);

function run(command: string[], options?: Parameters<typeof Bun.spawnSync>[1]) {
	const result = Bun.spawnSync(command, {
		stdout: "pipe",
		stderr: "pipe",
		...options,
	});
	if (result.exitCode !== 0)
		throw new Error(
			`${command[0]} failed (${result.exitCode}): ${String(result.stderr ?? "")
				.trim()
				.slice(-1200)}`,
		);
	return String(result.stdout ?? "");
}

function ffmpeg(...args: string[]) {
	run(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-y", ...args]);
}

function probe(file: string, stream: string, dimensions?: [number, number]) {
	const result = JSON.parse(
		run([
			"ffprobe",
			"-v",
			"error",
			"-show_entries",
			"format=duration:stream=codec_type,width,height",
			"-of",
			"json",
			file,
		]),
	) as {
		format?: { duration?: string };
		streams?: { codec_type: string; width?: number; height?: number }[];
	};
	const streams = result.streams ?? [];
	const found = streams.find((item) => item.codec_type === stream);
	if (
		!found ||
		(dimensions &&
			(found.width !== dimensions[0] || found.height !== dimensions[1]))
	)
		throw new Error(`Invalid ${stream} stream in ${file}`);
	return { seconds: Number(result.format?.duration), streams };
}

function preflight() {
	if (process.getuid?.() === 0)
		throw new Error("Yawa must run as an unprivileged user");
	const missing = [
		"codex",
		"uv",
		config.cover.tool,
		"ffmpeg",
		"ffprobe",
	].filter((tool) => !Bun.which(tool));
	if (!fs.existsSync(path.join(ttsDir, "irodori_tts", "inference_runtime.py")))
		missing.push(`Irodori checkout at ${ttsDir}`);
	if (!fs.existsSync(path.join(ttsDir, ".venv")))
		missing.push(`Irodori environment at ${ttsDir}/.venv`);
	if (missing.length)
		throw new Error(`Preflight missing: ${missing.join(", ")}`);
	run(["codex", "login", "status"]);
	run(
		[
			"uv",
			"run",
			"--no-sync",
			"python",
			"-c",
			"from irodori_tts.inference_runtime import InferenceRuntime, SamplingRequest; import torch; import sys; device = sys.argv[1]; assert device == 'cpu' or (torch.cuda.is_available() if device == 'cuda' else torch.backends.mps.is_available()), f'Irodori device unavailable: {device}'",
			config.tts.device,
		],
		{ cwd: ttsDir },
	);
	for (const dir of [bucket, ttsCache]) {
		fs.ensureDirSync(dir);
		fs.accessSync(dir, fs.constants.W_OK);
	}
}

function generateScript(dir: string, scratch: string): ScriptDraft {
	const answer = path.join(scratch, "script.json");
	const references = path.join(ROOT, "config/yawa/references");
	const availableReferences = fs.existsSync(references)
		? fs
				.readdirSync(references, { withFileTypes: true })
				.filter((entry) => entry.isFile() && /^[\w.-]+\.wav$/i.test(entry.name))
				.map((entry) => entry.name)
		: [];
	const prompt = [
		...Object.values(config.creative),
		`対象run ${path.basename(dir)}。日本語のオリジナル作品。全登場人物は成人。権利処理済み素材のみ。`,
		`使用可能なツール Irodori TTS（caption、参照の有無、任意の発話秒数）、${config.cover.tool}、FFmpeg。`,
		`既存の許諾済み参照WAV ${availableReferences.join(", ") || "なし"}。`,
		"JSONのみ。title、adult_characters_confirmed: true、rights_confirmed: true、voices、image、segments または chapters。",
		"voices は名前をキーとする {caption?, reference?}。reference は生成する {text} または許諾済みの {file}。省略可。",
		"segments は {text, voice?, direction?, seconds?, pause?, gain_db?} の列。章を使う場合は chapters を {name?, segments} の列にする。複数の声がある場合は各発話で voice を指定する。",
		'image は画像ツールへそのまま渡す作品固有の指示。description、tags、first ("audio" または "image")、zoom ([開始倍率, 終了倍率]) は任意。',
	].join("\n");
	run(
		[
			"codex",
			"exec",
			"-m",
			config.script.model,
			"--sandbox",
			"read-only",
			"--skip-git-repo-check",
			"--ephemeral",
			"-o",
			answer,
			"-",
		],
		{ cwd: scratch, stdin: Buffer.from(prompt) },
	);
	return ScriptDraftSchema.parse(
		parseYawaJson(fs.readFileSync(answer, "utf8")),
	);
}

function audio(draft: ScriptDraft, scratch: string) {
	type Request = {
		text: string;
		caption?: string;
		ref_wav?: string;
		no_ref: boolean;
		seconds?: number;
	};
	const jobs: { output: string; request: Request }[] = [];
	const references = new Map<string, string>();
	for (const [index, [name, voice]] of Object.entries(draft.voices).entries()) {
		if (voice.reference && "file" in voice.reference) {
			const ref = path.join(
				ROOT,
				"config/yawa/references",
				voice.reference.file,
			);
			if (!fs.statSync(ref, { throwIfNoEntry: false })?.isFile())
				throw new Error(`Reference WAV is missing: ${voice.reference.file}`);
			references.set(name, ref);
		} else if (voice.reference) {
			const output = path.join(scratch, `ref-${index + 1}.wav`);
			jobs.push({
				output,
				request: {
					text: voice.reference.text,
					caption: voice.caption,
					no_ref: true,
				},
			});
			references.set(name, output);
		}
	}
	const segments = draftSegments(draft).map((item, i) => {
		const name = item.voice ?? Object.keys(draft.voices)[0];
		const voice = name === undefined ? undefined : draft.voices[name];
		if (!name || !voice) throw new Error(`Invalid voice in segment ${i + 1}`);
		const output = path.join(scratch, `seg-${i + 1}.wav`);
		const ref = references.get(name);
		jobs.push({
			output,
			request: {
				text: item.text,
				caption: [voice.caption, item.direction].filter(Boolean).join("\n"),
				...(ref ? { ref_wav: ref } : {}),
				no_ref: !ref,
				...(item.seconds === undefined ? {} : { seconds: item.seconds }),
			},
		});
		return { output, pause: item.pause, gain: item.gain_db };
	});
	run(
		[
			"uv",
			"run",
			"--no-sync",
			"python",
			path.join(ROOT, "scripts/yawa_irodori.py"),
			config.tts.checkpoint,
			config.tts.device,
			config.tts.precision,
		],
		{
			cwd: ttsDir,
			env: { ...process.env, HF_HOME: ttsCache, PYTHONPATH: ttsDir },
			stdin: Buffer.from(JSON.stringify(jobs)),
			stdout: "inherit",
		},
	);
	const list: string[] = [];
	for (const [index, item] of segments.entries()) {
		const wav = `mix-${index + 1}.wav`;
		const filters = [
			item.gain === undefined ? "" : `volume=${item.gain}dB`,
			item.pause ? `apad=pad_dur=${item.pause}` : "",
		].filter(Boolean);
		const filter = filters.length ? ["-af", filters.join(",")] : [];
		ffmpeg(
			"-i",
			item.output,
			...filter,
			"-ar",
			"48000",
			"-ac",
			"1",
			path.join(scratch, wav),
		);
		list.push(`file '${wav}'`);
	}
	const manifest = path.join(scratch, "concat.txt");
	fs.writeFileSync(manifest, list.join("\n"));
	ffmpeg("-f", "concat", "-i", manifest, path.join(scratch, "final_mix.wav"));
}

function render(draft: ScriptDraft, dir: string) {
	const cover = path.join(dir, "cover.png");
	const audio = path.join(dir, "final_mix.wav");
	const video = path.join(dir, "video.mp4");
	const thumbnail = path.join(dir, "thumbnail.jpg");
	const duration = probe(audio, "audio").seconds;
	if (!(duration > 0) || !Number.isFinite(duration))
		throw new Error("Invalid audio duration");
	const fit = (width: number, height: number) =>
		`scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
	const frames = Math.max(1, Math.ceil(duration * 24) - 1);
	const motion = draft.zoom
		? `scale=3840:2160,zoompan=z='${draft.zoom[0]}+(${draft.zoom[1]}-${draft.zoom[0]})*min(on/${frames},1)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x1080:fps=24,`
		: "";
	ffmpeg(
		"-loop",
		"1",
		"-framerate",
		"24",
		"-i",
		cover,
		"-i",
		audio,
		"-map",
		"0:v:0",
		"-map",
		"1:a:0",
		"-vf",
		`${fit(1920, 1080)},${motion}format=yuv420p`,
		"-c:v",
		"libx264",
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		"-t",
		String(duration),
		"-movflags",
		"+faststart",
		video,
	);
	ffmpeg(
		"-i",
		cover,
		"-vf",
		fit(1280, 720),
		"-frames:v",
		"1",
		"-q:v",
		"3",
		thumbnail,
	);
	probe(thumbnail, "video", [1280, 720]);
	if (fs.statSync(thumbnail).size > 2 * 1024 * 1024)
		throw new Error("Thumbnail exceeds YouTube's 2 MiB limit");
	const output = probe(video, "video", [1920, 1080]);
	if (
		!output.streams.some((stream) => stream.codec_type === "audio") ||
		!Number.isFinite(output.seconds) ||
		Math.abs(output.seconds - duration) > 0.25
	)
		throw new Error(
			"Rendered video is missing audio or has a mismatched duration",
		);
	ffmpeg("-i", video, "-f", "null", "-");
}

function prepare(name: string) {
	if (!YAWA_RUN_NAME.test(name))
		throw new Error(
			"DATE must be YYYY-MM-DD and SLOT must be lowercase alphanumeric",
		);
	const dir = path.join(bucket, name);
	const script = path.join(dir, "script.json");
	const ready = path.join(dir, "state.json");
	const published = path.join(dir, "publish", "state.json");
	if (
		fs.existsSync(published) &&
		fs.readJsonSync(published).phase === "VERIFIED"
	)
		return;
	if (
		fs.existsSync(ready) &&
		fs.readJsonSync(ready).status === "READY" &&
		fs.existsSync(path.join(dir, "video.mp4"))
	)
		return;
	preflight();
	fs.ensureDirSync(dir);
	const lock = path.join(dir, ".prepare.lock");
	try {
		fs.mkdirSync(lock);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST")
			throw new Error(`Yawa run is already locked: ${name}`);
		throw error;
	}
	const runId = `${YAWA_BUCKET}/${name}`;
	let scratch: string | undefined;
	let stage = "script";
	try {
		if (fs.existsSync(ready)) {
			if (
				fs.readJsonSync(ready).status === "READY" &&
				fs.existsSync(path.join(dir, "video.mp4"))
			)
				return;
			throw new Error("Existing run state is not READY");
		}
		if (
			fs.existsSync(published) ||
			(!fs.existsSync(script) &&
				fs.readdirSync(dir).some((entry) => entry !== ".prepare.lock"))
		)
			throw new Error(
				"Existing run belongs to another preparation or publication",
			);
		scratch = fs.mkdtempSync(path.join(dir, ".prepare-"));
		const draft = fs.existsSync(script)
			? ScriptDraftSchema.parse(fs.readJsonSync(script))
			: generateScript(dir, scratch);
		const metadata = buildMetadata(draft);
		fs.writeJsonSync(path.join(scratch, "plan.json"), draft, { spaces: 2 });
		fs.renameSync(path.join(scratch, "plan.json"), script);
		const productionDir = scratch;
		const stages = {
			audio: () => audio(draft, productionDir),
			image: () =>
				run([
					config.cover.tool,
					draft.image,
					path.join(productionDir, "cover.png"),
					"--size",
					config.cover.size,
				]),
		};
		const first = draft.first ?? "audio";
		for (const step of [
			first,
			first === "audio" ? "image" : "audio",
		] as const) {
			stage = step;
			console.log(`[yawa] ${runId} ${stage}`);
			stages[step]();
		}
		stage = "render";
		render(draft, scratch);
		for (const file of fs.readdirSync(scratch)) {
			if (
				/^(ref|seg)-\d+\.wav$/.test(file) ||
				["cover.png", "final_mix.wav", "video.mp4", "thumbnail.jpg"].includes(
					file,
				)
			)
				fs.renameSync(path.join(scratch, file), path.join(dir, file));
		}
		const check: AuditCheck = {
			name: "media_integrity",
			description:
				"Rendered media and release metadata validated; adult characters and original/authorized materials attested in the production plan",
			status: "PASS",
			details: "ok",
			critical: true,
			type: "DETERMINISTIC",
		};
		fs.outputJsonSync(
			path.join(dir, "audit/result.json"),
			{ media_integrity: check },
			{ spaces: 2 },
		);
		fs.writeJsonSync(
			path.join(scratch, "state.json"),
			{
				run_id: runId,
				bucket: YAWA_BUCKET,
				status: "READY",
				video_path: path.join(dir, "video.mp4"),
				thumbnail_path: path.join(dir, "thumbnail.jpg"),
				contains_synthetic_media: true,
				metadata: { ...metadata, thumbnail_title: metadata.title },
			},
			{ spaces: 2 },
		);
		fs.renameSync(path.join(scratch, "state.json"), ready);
		console.log(`[yawa] ${runId} READY`);
	} catch (error) {
		throw new Error(
			`[yawa] ${runId} failed at ${stage}: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		if (scratch) fs.removeSync(scratch);
		fs.rmdirSync(lock);
	}
}

const [command, date, slot] = process.argv.slice(2);
if (command === "preflight") {
	preflight();
	console.log("[yawa] preflight READY");
} else if (command === "prepare" && date) {
	prepare(`yawa-${date}${slot ? `-${slot}` : ""}`);
} else {
	throw new Error("usage: yawa_daily.ts preflight | prepare YYYY-MM-DD [slot]");
}
