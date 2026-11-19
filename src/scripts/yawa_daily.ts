import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	TitleFitSchema,
	TitleProposalSchema,
	type TitleReview,
	TitleReviewSchema,
	titleFitPrompt,
	titleOnlyPrompt,
	titleProposalPrompt,
} from "../domain/creative_authoring.js";
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
import { AGY_CREATIVE_MODEL, invokeAgyStructured } from "../io/agy.js";
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

function fileHash(file: string): string {
	return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
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
		Bun.which("agy") ? "" : "agy CLI is not on PATH",
		Bun.which("ffmpeg") ? "" : "ffmpeg is not on PATH",
		Bun.which("ffprobe") ? "" : "ffprobe is not on PATH",
		Bun.which("uv") ? "" : "uv is not on PATH",
		fs.existsSync(path.join(ROOT, config.jizura.html))
			? ""
			: "vendored JIZURA is missing",
		fs.existsSync(path.join(ROOT, config.jizura.version_file))
			? ""
			: "JIZURA version file is missing",
		fs.existsSync(config.jizura.chrome)
			? ""
			: "Chrome is required for JIZURA MP4 export",
		tools.tts.length > 0
			? ""
			: "no configured Irodori environment is available",
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
	selectedTitle: string,
	titleReview: TitleReview,
): string {
	const imageTools =
		process.env.YAWA_GENERATE_IMAGES === "1" ? tools.images : [];
	return [
		"あなたは夜話アーカイブの制作AIです。次のYAMLは目的と参考情報です。",
		JSON.stringify(config.creative),
		"固有の魅力を持つ成人人物の日本語音声作品を創作してください。状況、人物、形式、尺、声、演技、画風は作品ごとに決め、既成の型を前提にしません。",
		"声の好みは聴き心地の参考です。今回の人物に合う声優像を新たに設計し、好みの音域・共鳴・息・話速・甘さを固定値にせず、別作品のcaptionや音声参照をそのまま引き継ぎません。作品内では人物の声を保ちながら、場面ごとのactingで自然に表情を変えます。voices.captionに質感を書き、reference_textは必要な声だけに任意で付けてcaptionと整合させます。",
		"句末に長く伸ばす吸気・吐息や擦れた息音を癖として足しません。親密さは声の距離・間・反応で表し、reference_textも息音を誇張しません。呼吸音は演技に意味がある場面だけ短く自然に使います。",
		"使えるツール: " +
			JSON.stringify({
				tts: tools.tts,
				images: imageTools,
				video: ["JIZURA"],
			}),
		`動画は必ずJIZURAで制作し、各performanceの台詞を実際の音声時刻に合わせた字幕として使います。JIZURAの見た目は作品ごとに選びます。任意のproduction.jizura_themeには次の値を指定できます: lyricpv, kinetic, wa, horror, pop, ballad。未指定ならJIZURAのおまかせを使います。FFmpegは元音声の合成と最終エンコードだけに使います。`,
		"音声を先に完成させます。画像生成は任意の添え物です。YAWA_GENERATE_IMAGES=1のときだけサムネイル画像を生成し、画像が作れなくてもJIZURA動画を制作して公開準備を続けます。mixは必要な場合のみ指定します。video.width/heightはJIZURAが対応する比率（16:9、9:16、4:3、3:4、1:1、4:5、21:9）にします。",
		"サムネイル画像を使う場合は作品固有のthumbnail_promptを指定します。共通の画風・色・構図は追加しません。対応サイズ: " +
			JSON.stringify(
				Object.fromEntries(
					imageTools.map((id) => [
						id,
						{
							default: config.image_tools[id]?.size,
							choices: config.image_tools[id]?.sizes,
						},
					]),
				),
			),
		`採用タイトル: ${selectedTitle}`,
		`本文前のタイトル批評: ${JSON.stringify(titleReview)}`,
		"titleには採用タイトルをそのまま使い、そのタイトルが予告する場面と人物の魅力を台本で実現してください。完成後、別工程で台本と照合して必要に応じて改題します。",
		"YouTube技術上限: title 100文字、description 5000 UTF-8 bytes、tags合計500文字。title/descriptionに < > は使えません。",
		"JSONのみ。title、voices[{id,caption,reference_text?}]、production{tts_backend,image_tool?,video?,jizura_theme?,thumbnail_size?,mix?}を含めます。thumbnail_promptは任意です。performances/chaptersは任意で単独・併用可。各performanceにはtextとvoice_idが必須です。voice_idは必ずvoices内のidをそのまま指定します。acting/pause_after_seconds/duration_scaleとdescription/tagsは任意です。",
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

function generateScript(
	dir: string,
	tools: { tts: string[]; images: string[] },
): ScriptDraft {
	const file = path.join(dir, "script.json");
	const existed = fs.existsSync(file);
	let draft: ScriptDraft;
	if (existed) {
		draft = ScriptDraftSchema.parse(fs.readJsonSync(file));
	} else {
		const titleProposal = invokeAgyStructured({
			name: "yawa_title_proposal",
			schema: TitleProposalSchema,
			prompt: titleProposalPrompt({
				brand: "夜話アーカイブ ASMR",
				context: config.creative,
			}),
		});
		const titleReview = invokeAgyStructured({
			name: "yawa_title_review",
			schema: TitleReviewSchema,
			prompt: titleOnlyPrompt({
				brand: "夜話アーカイブ ASMR",
				title: titleProposal.value.title,
			}),
		});
		const authored = invokeAgyStructured({
			name: "yawa_script",
			schema: ScriptDraftSchema,
			prompt: scriptPrompt(tools, titleProposal.value.title, titleReview.value),
		});
		draft = authored.value;
		const body = flattenPerformances(draft)
			.map((item, index) => `${index + 1}. ${item.text}`)
			.join("\n");
		const titleFit = invokeAgyStructured({
			name: "yawa_title_body_review",
			schema: TitleFitSchema,
			prompt: titleFitPrompt({
				brand: "夜話アーカイブ ASMR",
				initialTitle: titleProposal.value.title,
				titleReview: titleReview.value,
				body: `台本中のタイトル: ${draft.title}\n\n${body}`,
			}),
		});
		draft.title = titleFit.value.title;
		writeJsonAtomic(path.join(dir, "creative_authoring.json"), {
			model: AGY_CREATIVE_MODEL,
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
): {
	thumbnail?: string;
} {
	const thumbnailSource = path.join(dir, "thumbnail_source.png");
	const thumbnail = path.join(dir, config.thumbnail.file);
	const toolId = draft.production.image_tool;
	const imageSettings = toolId ? config.image_tools[toolId] : undefined;
	const enabled = process.env.YAWA_GENERATE_IMAGES === "1";
	const requested = Boolean(enabled && toolId && draft.thumbnail_prompt);
	const errors: string[] = [];
	const readable = (file: string) => {
		try {
			return fs.existsSync(file) && Boolean(probeImage(file));
		} catch {
			return false;
		}
	};
	const existing = readable(thumbnail) ? { thumbnail } : {};
	if (!enabled) return record(existing, "YAWA_GENERATE_IMAGES is not enabled");
	if (!requested)
		return record(existing, "no image tool or image prompt selected");
	if (requested && (!imageSettings || !Bun.which(imageSettings.command))) {
		errors.push(`image tool unavailable: ${toolId}`);
	} else if (requested && imageSettings && toolId && draft.thumbnail_prompt) {
		try {
			generateImage(
				toolId,
				draft.thumbnail_prompt,
				draft.production.thumbnail_size ?? imageSettings.size,
				thumbnailSource,
				"thumbnail-generation",
			);
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
		if (readable(thumbnailSource)) {
			if (!readable(thumbnail)) {
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
					fs.renameSync(temp, thumbnail);
				} catch (error) {
					errors.push(error instanceof Error ? error.message : String(error));
				} finally {
					if (fs.existsSync(temp)) fs.removeSync(temp);
				}
			}
			if (readable(thumbnail)) {
				const dimensions = probeImage(thumbnail);
				if (
					dimensions.width !== config.thumbnail.width ||
					dimensions.height !== config.thumbnail.height
				) {
					errors.push(
						"generated thumbnail dimensions differ from runtime settings",
					);
				} else {
					return record({ thumbnail });
				}
			}
		}
	}
	return record({
		...(readable(thumbnail) ? { thumbnail } : {}),
	});

	function record(outputs: { thumbnail?: string }, reason?: string) {
		const status = !requested
			? "omitted"
			: errors.length
				? outputs.thumbnail
					? "partial"
					: "failed"
				: "complete";
		const report = {
			status,
			...(reason ? { reason } : {}),
			...(errors.length ? { errors } : {}),
			at: new Date().toISOString(),
		};
		try {
			writeJsonAtomic(path.join(dir, "image_generation.json"), report);
		} catch (error) {
			console.warn(
				`[yawa] image status could not be recorded: ${String(error)}`,
			);
		}
		if (errors.length)
			console.warn(
				`[yawa] optional image generation ${status}; continuing to video and publication: ${errors.join("; ")}`,
			);
		return outputs;
	}
}

function renderVideo(draft: ScriptDraft, audio: string, dir: string): string {
	const output = path.join(dir, config.video.file);
	const audioSeconds = probeSeconds(audio);
	const { width, height } = draft.production.video ?? config.video;
	const record = path.join(dir, `${path.parse(output).name}.jizura.json`);
	const audioHash = fileHash(audio);
	if (fs.existsSync(output)) {
		if (!fs.existsSync(record))
			throw new StepFailure(
				"video-render",
				"existing video has no JIZURA provenance; use a fresh run ID",
			);
		const provenance = fs.readJsonSync(record) as {
			tool?: string;
			source_audio_sha256?: string;
			video_sha256?: string;
		};
		if (
			provenance.tool !== "JIZURA" ||
			provenance.source_audio_sha256 !== audioHash ||
			provenance.video_sha256 !== fileHash(output)
		)
			throw new StepFailure(
				"video-render",
				"existing JIZURA video provenance does not match its audio or file",
			);
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
	run("video-render", [
		"uv",
		"run",
		"--frozen",
		"--group",
		"pv",
		"python",
		"scripts/yawa_jizura.py",
		"--audio",
		audio,
		"--script",
		path.join(dir, "script.json"),
		"--tts-dir",
		path.join(dir, "tts"),
		"--output",
		output,
	]);
	if (!fs.existsSync(record))
		throw new StepFailure("video-render", "JIZURA provenance was not recorded");
	const provenance = fs.readJsonSync(record) as {
		tool?: string;
		source_audio_sha256?: string;
		video_sha256?: string;
	};
	if (
		provenance.tool !== "JIZURA" ||
		provenance.source_audio_sha256 !== audioHash ||
		provenance.video_sha256 !== fileHash(output)
	)
		throw new StepFailure(
			"video-render",
			"JIZURA provenance does not match its audio or file",
		);
	const rendered = probeVideo(output);
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
		const draft = generateScript(dir, tools);
		stage = "audio-production";
		const audio = renderAudio(draft, dir, device);
		stage = "image-production";
		const images = renderImages(draft, dir);
		stage = "video-render";
		const video = renderVideo(draft, audio, dir);
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
			...(images.thumbnail ? { thumbnail_path: images.thumbnail } : {}),
			contains_synthetic_media: true,
			metadata: { title, thumbnail_title: title, description, tags },
		});
		console.log(
			JSON.stringify({
				run_id: `${config.run.bucket}/${name}`,
				title,
				audio_seconds: audioSeconds,
				video_path: video,
				...(images.thumbnail ? { thumbnail_path: images.thumbnail } : {}),
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
