import path from "node:path";
import fs from "fs-extra";
import * as yaml from "js-yaml";
import { z } from "zod";
import type { AuditCheck } from "./types.js";

const IrodoriBackendSchema = z.object({
	kind: z.literal("irodori"),
	dir: z.string().min(1),
	hf_checkpoint: z.string().min(1),
	num_steps: z.number().int().positive(),
});

const YawaConfigSchema = z.object({
	run: z.object({ bucket: z.string(), name_prefix: z.string() }),
	pool_file: z.string(),
	audience: z.string(),
	script: z.object({
		tool: z.literal("codex"),
		model: z.string(),
		sandbox: z.literal("read-only"),
		timeout_seconds: z.number().positive(),
		min_segments: z.number().int().positive(),
		max_segments: z.number().int().positive(),
		max_segment_chars: z.number().int().positive(),
		max_attempts: z.number().int().positive(),
	}),
	tts: z.object({
		backend: z.string(),
		backends: z.record(z.string(), IrodoriBackendSchema),
		hf_home: z.string(),
		seed: z.number().int(),
		gap_seconds: z.number().positive(),
		min_free_vram_mib: z.number().positive(),
	}),
	voice: z.object({ caption: z.string().min(10).max(300) }),
	reference: z.object({
		text: z.string().min(10),
		seeds: z.array(z.number().int()).min(1),
		min_asr_similarity: z.number(),
	}),
	mix: z.object({ room_tone_db: z.number(), target_lufs: z.number() }),
	asr: z.object({ model: z.string(), min_similarity: z.number() }),
	cover: z.object({ tool: z.string(), file: z.string(), size: z.string() }),
	video: z.object({
		file: z.string(),
		width: z.number(),
		height: z.number(),
		fps: z.number(),
		crf: z.number(),
		audio_bitrate: z.string(),
	}),
	thumbnail: z.object({
		file: z.string(),
		width: z.number(),
		height: z.number(),
		quality: z.number(),
	}),
	audit: z.object({
		min_seconds: z.number(),
		max_seconds: z.number(),
		max_tail_mean_db: z.number(),
		tail_seconds: z.number(),
		duration_tolerance_seconds: z.number(),
	}),
	safety: z.object({ banned_terms: z.array(z.string()) }),
	metadata: z.object({
		title_prefix: z.string(),
		title_suffix: z.string(),
		tags: z.array(z.string()),
		ai_disclosure: z.string(),
		rights_declaration: z.string(),
	}),
});
export type YawaConfig = z.infer<typeof YawaConfigSchema>;

const PoolSchema = z.object({
	entries: z.array(
		z.object({
			id: z.string(),
			title: z.string(),
			author: z.string().nullable(),
			url: z.string().url(),
			tags: z.array(z.string()),
			situation: z.string(),
			eligible: z.boolean(),
		}),
	),
});
export type PoolEntry = z.infer<typeof PoolSchema>["entries"][number];

export const ScriptDraftSchema = z.object({
	title: z.string().min(4).max(60),
	hook: z.string().min(10).max(160),
	cover_scene: z.string().min(20).max(400),
	adult_characters_confirmed: z.literal(true),
	segments: z.array(z.string().min(1)),
});
export type ScriptDraft = z.infer<typeof ScriptDraftSchema>;

export function loadYawaConfig(root: string): YawaConfig {
	return YawaConfigSchema.parse(
		yaml.load(
			fs.readFileSync(path.join(root, "config/yawa/daily.yaml"), "utf8"),
		),
	);
}

export function loadPool(root: string, config: YawaConfig): PoolEntry[] {
	return PoolSchema.parse(
		fs.readJsonSync(path.join(root, config.pool_file)),
	).entries.filter((entry) => entry.eligible);
}

/** 未使用の着想元を先頭から選ぶ。全て使い終えたら最初から回す。 */
export function pickEntry(pool: PoolEntry[], usedIds: string[]): PoolEntry {
	if (pool.length === 0) throw new Error("script pool has no eligible entry");
	const counts = new Map(pool.map((entry) => [entry.id, 0]));
	for (const id of usedIds)
		if (counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
	const least = Math.min(...counts.values());
	const picked = pool.find((entry) => counts.get(entry.id) === least);
	if (!picked) throw new Error("no pool entry could be picked");
	return picked;
}

export function validateDraft(
	draft: ScriptDraft,
	config: YawaConfig,
): string[] {
	const failures: string[] = [];
	const { min_segments, max_segments, max_segment_chars } = config.script;
	if (
		draft.segments.length < min_segments ||
		draft.segments.length > max_segments
	)
		failures.push(
			`segments must be ${min_segments}-${max_segments}, got ${draft.segments.length}`,
		);
	draft.segments.forEach((text, index) => {
		if (text.length > max_segment_chars)
			failures.push(`segment ${index + 1} exceeds ${max_segment_chars} chars`);
	});
	const everything = [
		draft.title,
		draft.hook,
		draft.cover_scene,
		...draft.segments,
	].join("\n");
	for (const term of config.safety.banned_terms)
		if (everything.includes(term)) failures.push(`banned term: ${term}`);
	return failures;
}

/** root で動かさない。root 所有のファイルにも依存させない。 */
export function assertUnprivileged(
	uid: number | undefined,
	writableDirs: string[],
): void {
	if (uid === 0)
		throw new Error("yawa daily must not run as root; use the kafka user");
	for (const dir of writableDirs) {
		fs.ensureDirSync(dir);
		fs.accessSync(dir, fs.constants.W_OK);
		const owner = fs.statSync(dir).uid;
		if (uid !== undefined && owner !== uid)
			throw new Error(`${dir} is owned by uid ${owner}, expected ${uid}`);
	}
}

export type IrodoriCall = {
	cwd: string;
	command: string[];
	env: Record<string, string>;
};

function irodoriCall(
	config: YawaConfig,
	speaker: string[],
	text: string,
	caption: string,
	seed: number,
	outputWav: string,
): IrodoriCall {
	const backend = config.tts.backends[config.tts.backend];
	if (!backend)
		throw new Error(
			`unknown tts backend '${config.tts.backend}' in daily.yaml`,
		);
	return {
		cwd: backend.dir,
		command: [
			"uv",
			"run",
			"--frozen",
			"python",
			"infer.py",
			"--hf-checkpoint",
			backend.hf_checkpoint,
			...speaker,
			"--text",
			text,
			"--caption",
			caption,
			"--seed",
			String(seed),
			"--num-steps",
			String(backend.num_steps),
			"--output-wav",
			outputWav,
		],
		env: { HF_HOME: config.tts.hf_home },
	};
}

/** 動画内の全セグメントを、同じ参照音声で生成する。声の同一性はこの参照が決める。 */
export function segmentCall(
	config: YawaConfig,
	text: string,
	caption: string,
	refWav: string,
	outputWav: string,
): IrodoriCall {
	return irodoriCall(
		config,
		["--ref-wavs", refWav],
		text,
		caption,
		config.tts.seed,
		outputWav,
	);
}

/** 参照音声の候補だけを、参照なしで生成する。動画間の声は固定しない。 */
export function referenceCandidateCall(
	config: YawaConfig,
	caption: string,
	seed: number,
	outputWav: string,
): IrodoriCall {
	return irodoriCall(
		config,
		["--no-ref"],
		config.reference.text,
		caption,
		seed,
		outputWav,
	);
}

export type PreparationAction = "prepare" | "skip_verified" | "refuse_legacy";

/**
 * 既存の run に対して何をするかを決める。
 * 公開済みの run は再生成しない。参照の導入前に作られた音声に、後から参照を付けない。
 */
export function preparationAction(input: {
	publishVerified: boolean;
	finalMixExists: boolean;
	referenceExists: boolean;
}): PreparationAction {
	if (input.publishVerified) return "skip_verified";
	if (input.finalMixExists && !input.referenceExists) return "refuse_legacy";
	return "prepare";
}

export type ReferenceCandidate = {
	seed: number;
	file: string;
	asr_similarity: number;
};

/**
 * 候補から参照音声を 1 つ選ぶ。基準は「聞き取れること」と「割れていないこと」。
 * 魅力の判定はしない。聴いた人の評価は別に行う。
 */
export function selectReference(
	candidates: ReferenceCandidate[],
	config: YawaConfig,
): ReferenceCandidate {
	const eligible = candidates.filter(
		(c) => c.asr_similarity >= config.reference.min_asr_similarity,
	);
	if (eligible.length === 0)
		throw new Error(
			`no reference candidate passed (min_asr ${config.reference.min_asr_similarity})`,
		);
	return [...eligible].sort(
		(a, b) => b.asr_similarity - a.asr_similarity || a.seed - b.seed,
	)[0] as ReferenceCandidate;
}

function bigrams(text: string): Map<string, number> {
	const normalized = text.replace(/[\s、。，．,.!?！？「」『』…ー〜~]/g, "");
	const grams = new Map<string, number>();
	for (let i = 0; i < normalized.length - 1; i++) {
		const gram = normalized.slice(i, i + 2);
		grams.set(gram, (grams.get(gram) ?? 0) + 1);
	}
	return grams;
}

export function similarity(a: string, b: string): number {
	const left = bigrams(a);
	const right = bigrams(b);
	let overlap = 0;
	let total = 0;
	for (const count of left.values()) total += count;
	for (const count of right.values()) total += count;
	for (const [gram, count] of left)
		overlap += Math.min(count, right.get(gram) ?? 0);
	return total === 0 ? 0 : (2 * overlap) / total;
}

function check(
	name: string,
	description: string,
	failures: string[],
): AuditCheck {
	return {
		name,
		description,
		status: failures.length === 0 ? "PASS" : "QUALITY_FAIL",
		details: failures.length === 0 ? "ok" : failures.join("; "),
		critical: true,
		type: "DETERMINISTIC",
	};
}

export type YawaAuditInput = {
	draft: ScriptDraft;
	entry: PoolEntry;
	scriptGeneratedInRun: boolean;
	ttsRecord:
		| {
				backend: string;
				checkpoint: string;
				seed: number;
				reference_sha256: string;
		  }
		| undefined;
	referenceSha256: string | undefined;
	audioSeconds: number;
	videoSeconds: number;
	tailMeanDb: number;
	asrSimilarity: number | undefined;
	cover: { tool?: string; prompt?: string; sha256?: string } | undefined;
	coverSha256: string;
};

export function yawaAudit(
	input: YawaAuditInput,
	config: YawaConfig,
): Record<string, AuditCheck> {
	const { audit } = config;
	const provenance = [
		input.ttsRecord?.backend ? "" : "tts backend not recorded",
		input.ttsRecord?.checkpoint ? "" : "tts checkpoint not recorded",
		input.ttsRecord?.seed === config.tts.seed ? "" : "tts seed mismatch",
		input.scriptGeneratedInRun ? "" : "script was not generated in this run",
	];
	const voice = [
		input.referenceSha256 ? "" : "reference audio is missing",
		input.ttsRecord?.reference_sha256 &&
		input.ttsRecord.reference_sha256 === input.referenceSha256
			? ""
			: "segments were not generated from the recorded reference",
	];
	const integrity = [
		input.audioSeconds >= audit.min_seconds
			? ""
			: `shorter than ${audit.min_seconds}s`,
		input.audioSeconds <= audit.max_seconds
			? ""
			: `longer than ${audit.max_seconds}s`,
		input.tailMeanDb <= audit.max_tail_mean_db
			? ""
			: `ending is not faded (${input.tailMeanDb} dB)`,
		Math.abs(input.videoSeconds - input.audioSeconds) <=
		audit.duration_tolerance_seconds
			? ""
			: "video and audio durations differ",
		input.asrSimilarity !== undefined &&
		input.asrSimilarity >= config.asr.min_similarity
			? ""
			: `ASR similarity ${input.asrSimilarity ?? "missing"} < ${config.asr.min_similarity}`,
	];
	const visual = [
		input.cover?.tool ? "" : "cover tool missing",
		input.cover?.prompt ? "" : "cover prompt missing",
		input.cover?.sha256 && input.cover.sha256 === input.coverSha256
			? ""
			: "cover sha256 mismatch",
	];
	const safety = validateDraft(input.draft, config).filter((failure) =>
		failure.startsWith("banned term"),
	);
	return {
		tts_provenance: check(
			"tts_provenance",
			"TTS backend, checkpoint and seed are recorded for this run",
			provenance.filter(Boolean),
		),
		voice_reference: check(
			"voice_reference",
			"All segments were generated from one recorded reference clip",
			voice.filter(Boolean),
		),
		audio_integrity: check(
			"audio_integrity",
			"Length, ending, video duration and ASR round trip",
			integrity.filter(Boolean),
		),
		visual_provenance: check(
			"visual_provenance",
			"Cover image tool, prompt and hash are recorded",
			visual.filter(Boolean),
		),
		content_safety: check(
			"content_safety",
			"Adult-only characters confirmed and no banned terms",
			[
				...safety,
				input.draft.adult_characters_confirmed
					? ""
					: "adult characters not confirmed",
			].filter(Boolean),
		),
		rights: check(
			"rights",
			"Original script and declaration recorded",
			[
				config.metadata.rights_declaration ? "" : "rights declaration missing",
			].filter(Boolean),
		),
	};
}

/** 公開タイトル。新規投稿と既存動画の書き換えで、同じ規則を使う。 */
export function buildTitle(draft: ScriptDraft, config: YawaConfig): string {
	return `${config.metadata.title_prefix}${draft.title}${config.metadata.title_suffix}`;
}

export function buildDescription(
	draft: ScriptDraft,
	entry: PoolEntry,
	config: YawaConfig,
	seconds: number,
): string {
	const minutes = Math.round(seconds / 60);
	const inspired = `${entry.author ? `着想: ${entry.title} / ${entry.author}` : `着想: ${entry.title}`}\n\n${entry.url}\n`;
	return [
		draft.hook,
		"年上の成人の女性が、耳元で甘く囁く癒しと安眠のASMRです。",
		"",
		`再生時間: 約${minutes}分。イヤホンでお聴きください。`,
		"",
		config.metadata.ai_disclosure,
		config.metadata.rights_declaration,
		"",
		inspired,
	].join("\n");
}
