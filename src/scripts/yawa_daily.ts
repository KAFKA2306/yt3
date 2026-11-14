import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	assertUnprivileged,
	buildDescription,
	buildTags,
	buildTitle,
	capabilities,
	flattenPerformances,
	type IrodoriCall,
	irodoriCall,
	loadYawaConfig,
	type Performance,
	preparationAction,
	type ScriptDraft,
	ScriptDraftSchema,
	type VoiceDesign,
	validateDraft,
	yawaAudit,
} from "../domain/yawa_daily.js";
import { ROOT } from "../io/core.js";

const config = loadYawaConfig(ROOT);
const bucket = path.join(ROOT, "runs", config.run.bucket);
type Device = "cpu" | "cuda";

class StepFailure extends Error {
	constructor(
		readonly stage: string,
		message: string,
	) {
		super(`${stage}: ${message}`);
		this.name = "StepFailure";
	}
}

function run(
	stage: string,
	command: string[],
	options: { cwd?: string; env?: Record<string, string> } = {},
): string {
	const result = Bun.spawnSync(command, {
		cwd: options.cwd,
		env: { ...process.env, ...options.env },
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();
	if (result.exitCode !== 0)
		throw new StepFailure(
			stage,
			`${command[0]} exited ${result.exitCode}: ${stderr.slice(-1200)}`,
		);
	return `${stdout}${stderr}`;
}

function writeJsonAtomic(file: string, value: unknown): void {
	fs.ensureDirSync(path.dirname(file));
	const temp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
	fs.renameSync(temp, file);
}

function writeTextAtomic(file: string, value: string): void {
	const temp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(temp, value);
	fs.renameSync(temp, file);
}

function probeSeconds(file: string): number {
	const output = run("media-probe", [
		"ffprobe",
		"-v",
		"error",
		"-show_entries",
		"format=duration",
		"-of",
		"default=noprint_wrappers=1:nokey=1",
		file,
	]).trim();
	const seconds = Number(output);
	if (!Number.isFinite(seconds) || seconds <= 0)
		throw new StepFailure("media-probe", `${file} has no positive duration`);
	return seconds;
}

function probeImage(file: string): { width: number; height: number } {
	const output = run("image-probe", [
		"ffprobe",
		"-v",
		"error",
		"-select_streams",
		"v:0",
		"-show_entries",
		"stream=width,height",
		"-of",
		"json",
		file,
	]);
	const stream = (
		JSON.parse(output) as {
			streams?: Array<{ width?: number; height?: number }>;
		}
	).streams?.[0];
	if (!stream?.width || !stream.height)
		throw new StepFailure("image-probe", `${file} is not a readable image`);
	return { width: stream.width, height: stream.height };
}

function probeVideo(file: string): {
	seconds: number;
	width: number;
	height: number;
} {
	const output = run("video-probe", [
		"ffprobe",
		"-v",
		"error",
		"-show_entries",
		"format=duration:stream=codec_type,width,height",
		"-of",
		"json",
		file,
	]);
	const probe = JSON.parse(output) as {
		format?: { duration?: string };
		streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
	};
	const seconds = Number(probe.format?.duration);
	const video = probe.streams?.find((stream) => stream.codec_type === "video");
	const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
	if (
		!Number.isFinite(seconds) ||
		seconds <= 0 ||
		!video?.width ||
		!video.height ||
		!audio
	)
		throw new StepFailure(
			"video-probe",
			`${file} needs readable audio and video streams`,
		);
	return { seconds, width: video.width, height: video.height };
}

function assertPlayable(file: string): number {
	if (!fs.existsSync(file) || fs.statSync(file).size === 0)
		throw new StepFailure("artifact-check", `${file} is missing or empty`);
	return probeSeconds(file);
}

function availableTools(): { tts: string[]; images: string[] } {
	const configured = capabilities(config);
	return {
		tts: configured.tts.filter((id) => {
			const backend = config.tts.backends[id];
			return Boolean(
				backend &&
					Bun.which("uv") &&
					fs.existsSync(path.join(backend.dir, ".venv")),
			);
		}),
		images: configured.images.filter((id) => {
			const tool = config.image_tools[id];
			return Boolean(tool && Bun.which(tool.command));
		}),
	};
}

function preflight(
	tools: { tts: string[]; images: string[] },
	device: Device,
): void {
	assertUnprivileged(process.getuid?.(), [config.tts.hf_home, bucket]);
	const failures = [
		Bun.which("codex") ? "" : "codex is not on PATH",
		Bun.spawnSync(["codex", "login", "status"], {
			stdout: "ignore",
			stderr: "ignore",
		}).exitCode === 0
			? ""
			: "codex is not logged in",
		Bun.which("ffmpeg") ? "" : "ffmpeg is not on PATH",
		Bun.which("ffprobe") ? "" : "ffprobe is not on PATH",
		Bun.which("uv") ? "" : "uv is not on PATH",
		tools.tts.length > 0
			? ""
			: "no configured Irodori environment is available",
		tools.images.length > 0 ? "" : "no configured image tool is available",
		device === config.tts.device
			? ""
			: `requested TTS device '${device}' differs from runtime device '${config.tts.device}'`,
	].filter(Boolean);
	if (failures.length) throw new StepFailure("preflight", failures.join("; "));
}

function requestedDevice(): Device {
	const value = process.env.YAWA_TTS_DEVICE?.trim() || config.tts.device;
	if (value !== "cpu" && value !== "cuda")
		throw new Error("YAWA_TTS_DEVICE must be cpu or cuda");
	return value;
}

function scriptPrompt(
	tools: { tts: string[]; images: string[] },
	runId: string,
): string {
	return [
		"あなたは夜話アーカイブの制作AIです。次のYAMLは目的と参考情報です。",
		JSON.stringify(config.creative),
		`制作ID: ${runId}。このIDから題材を決めず、今回の作品を独立に考えてください。`,
		"この作品ならではの魅力を決め、成人人物の日本語台本を書いてください。状況、関係、展開、形式、尺、話者数、声、演技、画像を作品ごとに考えます。物語型、声質、画風を固定しません。",
		"声の好みは参考情報で、音響値や決まった声質の条件ではありません。声優像と画像表現は作品ごとに考案します。Captionには声の質感、各発話のactingにはその場の演技を書きます。参照文は必要な声にだけ任意で付け、Captionと矛盾しない台詞にしてください。",
		"使えるツール: " +
			JSON.stringify({
				tts: tools.tts,
				images: tools.images,
				video: ["ffmpeg"],
			}),
		"使えるTTS・画像ツールから選び、production.orderで実行順を決めます。画像サイズは提示された候補から作品に合わせて選びます。videoのwidth/heightは作品に合う偶数の画素数で任意に選べます。mixは音量補正が必要な作品だけ、motionは動きが合う作品だけ指定します。",
		"cover_prompt と thumbnail_prompt はそれぞれ今回の絵を直接指示してください。アダプターは共通の画風・色・構図を追加しません。画像生成ツールの入力サイズは " +
			JSON.stringify(
				Object.fromEntries(
					tools.images.map((id) => [
						id,
						{
							default: config.image_tools[id]?.size,
							choices: config.image_tools[id]?.sizes,
						},
					]),
				),
			),
		"YouTube技術上限: title 100文字、description 5000 UTF-8 bytes、tags合計500文字。title/descriptionに < > は使えません。",
		"JSONにはtitle、voices[{id,caption,reference_text?}]、cover_prompt、thumbnail_prompt、production{tts_backend,image_tool,order,video?,cover_size?,thumbnail_size?,mix?,motion?}とperformances[...]またはchapters[...]を入れます。description/tagsは任意。各発話のtextは台詞、acting・pause_after_seconds・duration_scaleは任意です。",
	].join("\n");
}

const tokenGuard = `
import json, sys
from pathlib import Path
from huggingface_hub import hf_hub_download
from safetensors import safe_open
from transformers import AutoTokenizer

checkpoint_repo, input_file = sys.argv[1:]
checkpoint = Path(hf_hub_download(checkpoint_repo, filename="model.safetensors"))
with safe_open(str(checkpoint), framework="pt", device="cpu") as handle:
    metadata = handle.metadata() or {}
config = json.loads(metadata["config_json"])
text_limit = config.get("max_text_len")
text_limit = text_limit if type(text_limit) is int and text_limit > 0 else 256
caption_limit = config.get("max_caption_len")
caption_limit = caption_limit if type(caption_limit) is int and caption_limit > 0 else text_limit
text_repo = config.get("text_tokenizer_repo") or "sbintuitions/sarashina2.2-0.5b"
caption_repo = config.get("caption_tokenizer_repo") or text_repo
text_bos = bool(config.get("text_add_bos", True))
caption_bos = config.get("caption_add_bos")
caption_bos = text_bos if caption_bos is None else bool(caption_bos)
caption_enabled = bool(config.get("use_caption_condition", False))

def load_tokenizer(repo):
    for candidate in (checkpoint.parent / "tokenizer", checkpoint.parent.parent / "tokenizer"):
        if (candidate / "tokenizer_config.json").is_file():
            return AutoTokenizer.from_pretrained(candidate, use_fast=True, trust_remote_code=False)
    return AutoTokenizer.from_pretrained(repo, use_fast=True, trust_remote_code=False)

text_tokenizer = load_tokenizer(text_repo)
caption_tokenizer = load_tokenizer(caption_repo) if caption_enabled else None
data = json.loads(Path(input_file).read_text(encoding="utf-8"))
failures = []

def inspect(kind, label, text, tokenizer, add_bos, limit):
    count = len(tokenizer.encode(text, add_special_tokens=False)) + int(add_bos)
    if count > limit:
        failures.append({"kind": kind, "label": label, "tokens": count, "limit": limit})

for item in data["texts"]:
    inspect("text", item["label"], item["text"], text_tokenizer, text_bos, text_limit)
if caption_tokenizer:
    for item in data["captions"]:
        inspect("caption", item["label"], item["text"], caption_tokenizer, caption_bos, caption_limit)
print(json.dumps({"failures": failures}, ensure_ascii=False))
`;

function validateTtsInputs(draft: ScriptDraft): void {
	const backend = config.tts.backends[draft.production.tts_backend];
	if (!backend) throw new StepFailure("tts-input-check", "unknown TTS backend");
	const voices = new Map(draft.voices.map((voice) => [voice.id, voice]));
	const performances = flattenPerformances(draft);
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), "yawa-token-check-"));
	const input = path.join(temp, "input.json");
	fs.writeJsonSync(input, {
		texts: [
			...draft.voices.flatMap((voice) =>
				voice.reference_text
					? [{ label: `reference ${voice.id}`, text: voice.reference_text }]
					: [],
			),
			...performances.map((item, index) => ({
				label: `performance ${index + 1}`,
				text: item.text,
			})),
		],
		captions: [
			...draft.voices.flatMap((voice) =>
				voice.reference_text
					? [{ label: `reference ${voice.id}`, text: voice.caption }]
					: [],
			),
			...performances.map((item, index) => {
				const voice = voices.get(item.voice_id);
				return {
					label: `performance ${index + 1}`,
					text: [voice?.caption, item.acting].filter(Boolean).join("\n"),
				};
			}),
		],
	});
	try {
		const result = Bun.spawnSync(
			[
				"uv",
				"run",
				"--frozen",
				"python",
				"-c",
				tokenGuard,
				backend.checkpoint,
				input,
			],
			{
				cwd: backend.dir,
				env: { ...process.env, HF_HOME: config.tts.hf_home },
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		if (result.exitCode !== 0)
			throw new StepFailure(
				"tts-input-check",
				`tokenizer exited ${result.exitCode}: ${result.stderr.toString().slice(-1000)}`,
			);
		const checked = JSON.parse(result.stdout.toString()) as {
			failures: Array<{
				kind: string;
				label: string;
				tokens: number;
				limit: number;
			}>;
		};
		if (checked.failures.length)
			throw new StepFailure(
				"tts-input-check",
				`Irodori would truncate inputs: ${checked.failures.map((item) => `${item.kind} ${item.label} (${item.tokens}/${item.limit} tokens)`).join(", ")}`,
			);
	} catch (error) {
		if (error instanceof StepFailure) throw error;
		throw new StepFailure(
			"tts-input-check",
			error instanceof Error ? error.message : String(error),
		);
	} finally {
		fs.removeSync(temp);
	}
}

function parseJson(text: string): unknown {
	return JSON.parse(
		text
			.trim()
			.replace(/^```(?:json)?\s*/i, "")
			.replace(/```\s*$/, ""),
	);
}

function generateScript(
	dir: string,
	tools: { tts: string[]; images: string[] },
	runId: string,
): ScriptDraft {
	const file = path.join(dir, "script.json");
	const existed = fs.existsSync(file);
	let draft: ScriptDraft;
	if (existed) {
		draft = ScriptDraftSchema.parse(fs.readJsonSync(file));
	} else {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yawa-script-"));
		try {
			const answer = path.join(tempDir, "answer.json");
			run(
				"script-generation",
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
					scriptPrompt(tools, runId),
				],
				{ cwd: tempDir },
			);
			draft = ScriptDraftSchema.parse(
				parseJson(fs.readFileSync(answer, "utf8")),
			);
		} finally {
			fs.removeSync(tempDir);
		}
	}
	const failures = validateDraft(draft, config, tools);
	if (failures.length)
		throw new StepFailure("script-validation", failures.join("; "));
	validateTtsInputs(draft);
	if (!existed) writeJsonAtomic(file, draft);
	return draft;
}

function writeAudioCall(
	stage: string,
	call: IrodoriCall,
	target: string,
): void {
	if (fs.existsSync(target)) {
		assertPlayable(target);
		return;
	}
	const raw = path.join(
		path.dirname(target),
		`.${path.basename(target, ".wav")}.${process.pid}.tts.wav`,
	);
	const normalized = path.join(
		path.dirname(target),
		`.${path.basename(target, ".wav")}.${process.pid}.normalized.wav`,
	);
	try {
		const command = [...call.command];
		const outputIndex = command.indexOf("--output-wav");
		if (outputIndex < 0 || !command[outputIndex + 1])
			throw new StepFailure(stage, "Irodori call has no output path");
		command[outputIndex + 1] = raw;
		run(stage, command, { cwd: call.cwd, env: call.env });
		if (!fs.existsSync(raw))
			throw new StepFailure(stage, "TTS returned without an output file");
		assertPlayable(raw);
		run(`${stage}:format`, [
			"ffmpeg",
			"-y",
			"-loglevel",
			"error",
			"-i",
			raw,
			"-ar",
			"48000",
			"-ac",
			"1",
			"-c:a",
			"pcm_s16le",
			normalized,
		]);
		assertPlayable(normalized);
		fs.renameSync(normalized, target);
	} finally {
		if (fs.existsSync(raw)) fs.removeSync(raw);
		if (fs.existsSync(normalized)) fs.removeSync(normalized);
	}
}

function voiceMap(draft: ScriptDraft): Map<string, VoiceDesign> {
	return new Map(draft.voices.map((voice) => [voice.id, voice]));
}

function callForPerformance(
	draft: ScriptDraft,
	performance: Performance,
	output: string,
	device: Device,
	ref?: string,
): IrodoriCall {
	const voice = voiceMap(draft).get(performance.voice_id);
	if (!voice)
		throw new StepFailure(
			"voice-resolution",
			`unknown voice '${performance.voice_id}'`,
		);
	const caption = [voice.caption, performance.acting]
		.filter(Boolean)
		.join("\n");
	return irodoriCall(config, {
		backendId: draft.production.tts_backend,
		text: performance.text,
		caption,
		referenceWav: ref,
		durationScale: performance.duration_scale,
		outputWav: output,
		device,
	});
}

function generateReference(
	draft: ScriptDraft,
	voice: VoiceDesign,
	index: number,
	device: Device,
	dir: string,
): string | undefined {
	if (!voice.reference_text) return undefined;
	const refsDir = path.join(dir, "tts", "references");
	fs.ensureDirSync(refsDir);
	const output = path.join(
		refsDir,
		`voice_${String(index + 1).padStart(3, "0")}.wav`,
	);
	const refCall = irodoriCall(config, {
		backendId: draft.production.tts_backend,
		text: voice.reference_text,
		caption: voice.caption,
		outputWav: output,
		device,
	});
	writeAudioCall(`reference:${voice.id}`, refCall, output);
	return output;
}

function concatEntry(file: string): string {
	return `file '${file.replace(/'/g, "'\\''")}'`;
}

function renderAudio(draft: ScriptDraft, dir: string, device: Device): string {
	const ttsDir = path.join(dir, "tts");
	fs.ensureDirSync(ttsDir);
	const references = new Map<string, string | undefined>();
	draft.voices.forEach((voice, index) => {
		references.set(
			voice.id,
			generateReference(draft, voice, index, device, dir),
		);
	});
	const performances = flattenPerformances(draft);
	const files: string[] = [];
	performances.forEach((performance, index) => {
		const basename = `performance_${String(index + 1).padStart(5, "0")}.wav`;
		const output = path.join(ttsDir, basename);
		const call = callForPerformance(
			draft,
			performance,
			output,
			device,
			references.get(performance.voice_id),
		);
		writeAudioCall(`tts:${index + 1}`, call, output);
		files.push(concatEntry(output));
		if ((performance.pause_after_seconds ?? 0) > 0) {
			const pause = path.join(
				ttsDir,
				`pause_${String(index + 1).padStart(5, "0")}.wav`,
			);
			if (!fs.existsSync(pause)) {
				const temp = `${pause}.${process.pid}.tmp.wav`;
				try {
					run(`pause:${index + 1}`, [
						"ffmpeg",
						"-y",
						"-loglevel",
						"error",
						"-f",
						"lavfi",
						"-i",
						"anullsrc=r=48000:cl=mono",
						"-t",
						String(performance.pause_after_seconds),
						temp,
					]);
					assertPlayable(temp);
					fs.renameSync(temp, pause);
				} finally {
					if (fs.existsSync(temp)) fs.removeSync(temp);
				}
			} else assertPlayable(pause);
			files.push(concatEntry(pause));
		}
	});
	const list = path.join(ttsDir, "concat.txt");
	writeTextAtomic(list, `${files.join("\n")}\n`);
	const raw = path.join(ttsDir, "joined.wav");
	if (!fs.existsSync(raw)) {
		const temp = path.join(ttsDir, `.joined.${process.pid}.tmp.wav`);
		try {
			run("audio-concat", [
				"ffmpeg",
				"-y",
				"-loglevel",
				"error",
				"-f",
				"concat",
				"-safe",
				"0",
				"-i",
				list,
				"-ar",
				"48000",
				"-ac",
				"1",
				temp,
			]);
			assertPlayable(temp);
			fs.renameSync(temp, raw);
		} finally {
			if (fs.existsSync(temp)) fs.removeSync(temp);
		}
	} else assertPlayable(raw);
	const output = path.join(dir, "final_mix.wav");
	if (fs.existsSync(output)) {
		assertPlayable(output);
		return output;
	}
	const mix = draft.production.mix;
	if (!mix) {
		fs.copyFileSync(raw, output);
		assertPlayable(output);
		return output;
	}
	const temp = path.join(dir, `.final_mix.${process.pid}.tmp.wav`);
	try {
		run("audio-mix", [
			"ffmpeg",
			"-y",
			"-loglevel",
			"error",
			"-i",
			raw,
			"-af",
			`loudnorm=I=${mix.target_lufs}:TP=${mix.true_peak_db}:LRA=${mix.loudness_range}`,
			"-ar",
			"48000",
			"-ac",
			"1",
			temp,
		]);
		assertPlayable(temp);
		fs.renameSync(temp, output);
	} finally {
		if (fs.existsSync(temp)) fs.removeSync(temp);
	}
	return output;
}

function generateImage(
	toolId: string,
	prompt: string,
	size: string,
	target: string,
	stage: string,
): void {
	if (fs.existsSync(target)) {
		probeImage(target);
		return;
	}
	const tool = config.image_tools[toolId];
	if (!tool) throw new StepFailure(stage, `unknown image tool '${toolId}'`);
	const temp = path.join(
		path.dirname(target),
		`.${path.basename(target, ".png")}.${process.pid}.tmp.png`,
	);
	try {
		run(stage, [tool.command, prompt, temp, "--size", size]);
		probeImage(temp);
		fs.renameSync(temp, target);
	} finally {
		if (fs.existsSync(temp)) fs.removeSync(temp);
	}
}

function renderImages(
	draft: ScriptDraft,
	dir: string,
): { cover: string; thumbnail: string } {
	const cover = path.join(dir, "cover.png");
	const thumbnailSource = path.join(dir, "thumbnail_source.png");
	const thumbnail = path.join(dir, config.thumbnail.file);
	const imageSettings = config.image_tools[draft.production.image_tool];
	if (!imageSettings)
		throw new StepFailure(
			"image-generation",
			`unknown image tool '${draft.production.image_tool}'`,
		);
	generateImage(
		draft.production.image_tool,
		draft.cover_prompt,
		draft.production.cover_size ?? imageSettings.size,
		cover,
		"cover-generation",
	);
	generateImage(
		draft.production.image_tool,
		draft.thumbnail_prompt,
		draft.production.thumbnail_size ?? imageSettings.size,
		thumbnailSource,
		"thumbnail-generation",
	);
	if (!fs.existsSync(thumbnail)) {
		const temp = path.join(dir, `.thumbnail.${process.pid}.tmp.jpg`);
		try {
			run("thumbnail-render", [
				"ffmpeg",
				"-y",
				"-loglevel",
				"error",
				"-i",
				thumbnailSource,
				"-vf",
				`scale=${config.thumbnail.width}:${config.thumbnail.height}:force_original_aspect_ratio=increase,crop=${config.thumbnail.width}:${config.thumbnail.height}`,
				"-q:v",
				String(config.thumbnail.quality),
				temp,
			]);
			const dimensions = probeImage(temp);
			if (
				dimensions.width !== config.thumbnail.width ||
				dimensions.height !== config.thumbnail.height
			)
				throw new StepFailure(
					"thumbnail-check",
					`expected ${config.thumbnail.width}x${config.thumbnail.height}, got ${dimensions.width}x${dimensions.height}`,
				);
			fs.renameSync(temp, thumbnail);
		} finally {
			if (fs.existsSync(temp)) fs.removeSync(temp);
		}
	} else {
		const dimensions = probeImage(thumbnail);
		if (
			dimensions.width !== config.thumbnail.width ||
			dimensions.height !== config.thumbnail.height
		)
			throw new StepFailure(
				"thumbnail-check",
				"existing thumbnail dimensions differ from runtime settings",
			);
	}
	return { cover, thumbnail };
}

function renderVideo(
	draft: ScriptDraft,
	audio: string,
	cover: string,
	dir: string,
): string {
	const output = path.join(dir, config.video.file);
	const audioSeconds = probeSeconds(audio);
	const { width, height } = draft.production.video ?? config.video;
	const { fps } = config.video;
	if (fs.existsSync(output)) {
		const existing = probeVideo(output);
		if (
			Math.abs(existing.seconds - audioSeconds) >
				config.audit.duration_tolerance_seconds ||
			existing.width !== width ||
			existing.height !== height
		)
			throw new StepFailure(
				"video-check",
				"existing video duration differs from the audio",
			);
		return output;
	}
	const move = draft.production.motion;
	const motionFilter = move
		? (() => {
				const frames = Math.max(1, Math.ceil(audioSeconds * fps));
				const interpolate = (start: number, end: number) =>
					`(${start}+(${end}-${start})*on/${frames})`;
				return `zoompan=z='${interpolate(move.zoom_start, move.zoom_end)}':x='(iw-iw/zoom)*${interpolate(move.x_start, move.x_end)}':y='(ih-ih/zoom)*${interpolate(move.y_start, move.y_end)}':d=1:s=${width}x${height}:fps=${fps}`;
			})()
		: undefined;
	const filter = [
		`scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase`,
		`crop=${width * 2}:${height * 2}`,
		...(motionFilter ? [motionFilter] : []),
		"format=yuv420p",
	].join(",");
	const temp = path.join(dir, `.video.${process.pid}.tmp.mp4`);
	try {
		run("video-render", [
			"ffmpeg",
			"-y",
			"-loglevel",
			"error",
			"-loop",
			"1",
			"-framerate",
			String(fps),
			"-i",
			cover,
			"-i",
			audio,
			"-vf",
			filter,
			"-t",
			String(audioSeconds),
			"-c:v",
			"libx264",
			"-crf",
			String(config.video.crf),
			"-c:a",
			"aac",
			"-b:a",
			config.video.audio_bitrate,
			"-shortest",
			"-movflags",
			"+faststart",
			temp,
		]);
		const rendered = probeVideo(temp);
		if (
			Math.abs(rendered.seconds - audioSeconds) >
				config.audit.duration_tolerance_seconds ||
			rendered.width !== width ||
			rendered.height !== height
		)
			throw new StepFailure(
				"video-check",
				`video ${rendered.width}x${rendered.height} ${rendered.seconds.toFixed(2)}s differs from expected output`,
			);
		fs.renameSync(temp, output);
	} finally {
		if (fs.existsSync(temp)) fs.removeSync(temp);
	}
	return output;
}

function acquireLock(dir: string): string {
	const lock = path.join(dir, ".prepare.lock");
	let fd: number;
	try {
		fd = fs.openSync(lock, "wx");
	} catch {
		throw new StepFailure("run-lock", `another prepare may be active: ${lock}`);
	}
	fs.writeFileSync(
		fd,
		JSON.stringify({
			pid: process.pid,
			host: os.hostname(),
			started_at: new Date().toISOString(),
		}),
	);
	fs.closeSync(fd);
	return lock;
}

function assertDate(date: string): void {
	const parsed = new Date(`${date}T00:00:00.000Z`);
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
		!Number.isFinite(parsed.valueOf()) ||
		parsed.toISOString().slice(0, 10) !== date
	)
		throw new Error("DATE must be a real YYYY-MM-DD date");
}

async function prepare(date: string, slot?: string): Promise<void> {
	assertDate(date);
	if (slot && !/^[a-z0-9]+$/.test(slot))
		throw new Error("SLOT must be lowercase letters or digits");
	if (process.getuid?.() === 0)
		throw new Error("yawa daily must not run as root; use the kafka user");
	const name = `${config.run.name_prefix}${date}${slot ? `-${slot}` : ""}`;
	const dir = path.join(bucket, name);
	fs.ensureDirSync(dir);
	const lock = acquireLock(dir);
	let stage = "preflight";
	try {
		const existingState = path.join(dir, "publish", "state.json");
		const action = preparationAction({
			publishVerified:
				fs.existsSync(existingState) &&
				fs.readJsonSync(existingState).phase === "VERIFIED",
		});
		if (action === "skip_verified") {
			console.log(
				`[yawa] ${name} is VERIFIED; existing artifacts are left untouched`,
			);
			return;
		}
		const device = requestedDevice();
		const tools = availableTools();
		preflight(tools, device);
		stage = "script-generation";
		const draft = generateScript(dir, tools, name);
		let audio: string | undefined;
		let images: { cover: string; thumbnail: string } | undefined;
		for (const task of draft.production.order) {
			stage = task === "audio" ? "audio-production" : "image-production";
			if (task === "audio") audio = renderAudio(draft, dir, device);
			else images = renderImages(draft, dir);
		}
		if (!audio || !images)
			throw new StepFailure(
				"production-plan",
				"audio or image output is missing",
			);
		stage = "video-render";
		const video = renderVideo(draft, audio, images.cover, dir);
		const audioSeconds = probeSeconds(audio);
		const videoSeconds = probeVideo(video).seconds;
		const title = buildTitle(draft);
		const description = buildDescription(draft, config);
		const tags = buildTags(draft);
		stage = "technical-audit";
		const report = yawaAudit(
			{
				audioSeconds,
				videoSeconds,
				coverReadable: Boolean(probeImage(images.cover)),
				thumbnailReadable: Boolean(probeImage(images.thumbnail)),
				metadataValid: true,
			},
			config,
		);
		writeJsonAtomic(path.join(dir, "audit", "result.json"), report);
		const failures = Object.entries(report).filter(
			([, item]) => item.status !== "PASS",
		);
		if (failures.length)
			throw new StepFailure(
				"technical-audit",
				failures.map(([key]) => key).join(", "),
			);
		writeJsonAtomic(path.join(dir, "state.json"), {
			run_id: `${config.run.bucket}/${name}`,
			bucket: config.run.bucket,
			status: "READY",
			video_path: video,
			thumbnail_path: images.thumbnail,
			contains_synthetic_media: true,
			metadata: { title, thumbnail_title: title, description, tags },
		});
		console.log(
			JSON.stringify({
				run_id: `${config.run.bucket}/${name}`,
				title,
				audio_seconds: audioSeconds,
				video_path: video,
				thumbnail_path: images.thumbnail,
			}),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		try {
			writeJsonAtomic(path.join(dir, "failure.json"), {
				run_id: `${config.run.bucket}/${name}`,
				stage: error instanceof StepFailure ? error.stage : stage,
				message,
				at: new Date().toISOString(),
			});
		} catch (recordError) {
			console.error(
				`[yawa] could not write failure record: ${String(recordError)}`,
			);
		}
		throw error;
	} finally {
		fs.removeSync(lock);
	}
}

const [command, date, slot] = process.argv.slice(2);
if (command === "preflight") {
	const tools = availableTools();
	preflight(tools, requestedDevice());
	console.log(JSON.stringify({ status: "READY", tools }));
} else if (command === "prepare" && date) {
	await prepare(date, slot);
} else {
	throw new Error("usage: yawa_daily.ts preflight | prepare YYYY-MM-DD [slot]");
}
