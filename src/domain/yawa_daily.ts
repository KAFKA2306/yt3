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

const RangeSchema = z.tuple([z.number().positive(), z.number().positive()]);

const GapSchema = z.tuple([z.number().nonnegative(), z.number().nonnegative()]);
const SignedRangeSchema = z.tuple([z.number(), z.number()]);

const BeatSchema = z.object({
	share: z.number().positive(),
	brief: z.string().min(1),
	style: z.string(),
	duration_scale: RangeSchema,
	cfg_scale_caption: z.number().positive(),
	gap_seconds: GapSchema,
	gain_db: z.number(),
});

const SituationPatternSchema = z.object({
	id: z.string().regex(/^[a-z0-9_-]{1,50}$/),
	weight: z.number().int().positive(),
	market_keywords: z.array(z.string().min(1)).min(1),
	premise: z.string().min(20),
	shapes: z.array(z.string().min(1)).min(1),
	axis_options: z
		.record(z.string(), z.array(z.string().min(1)).min(1))
		.optional(),
});

const NonverbalCueSchema = z.object({
	id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
	emoji: z.string().min(1),
	weight: z.number().int().positive(),
	chapters: z.array(z.string().min(1)).min(1),
	positions: z.array(z.enum(["prefix", "after_clause", "suffix"])).min(1),
	repetitions: z.array(z.number().int().min(1).max(3)).min(1),
});

const VoiceAxisOptionSchema = z.object({
	id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
	cue: z.string().min(1).max(240),
	preference_weight: z.number().int().positive(),
});

export type Chapter = {
	name: string;
	share: number;
	brief: string;
	style: string;
	duration_scale: number;
	cfg_scale_caption: number;
	gap_seconds: number;
	gain_db: number;
};

const YawaConfigSchema = z.object({
	run: z.object({ bucket: z.string(), name_prefix: z.string() }),
	pool_file: z.string(),
	audience: z.string(),
	script: z.object({
		tool: z.literal("codex"),
		model: z.string(),
		sandbox: z.literal("read-only"),
		// Legacy fields remain typed for old run fixtures; production does not enforce segment counts.
		min_segments: z.number().int().positive().default(1),
		max_segments: z.number().int().positive().default(Number.MAX_SAFE_INTEGER),
		max_segment_chars: z.number().int().positive(),
		max_attempts: z.number().int().positive(),
		variation_rules: z.array(z.string().min(1)).min(1),
	}),
	tts: z.object({
		backend: z.string(),
		device: z.enum(["cpu", "cuda"]),
		backends: z.record(z.string(), IrodoriBackendSchema),
		hf_home: z.string(),
		min_free_vram_mib: z.number().positive(),
	}),
	nonverbal_experiment: z.object({
		enabled: z.boolean(),
		cues: z.array(NonverbalCueSchema).min(1),
	}),
	arc: z.object({
		dynamic: z.object({
			duration_scale: RangeSchema,
			cfg_scale_caption: RangeSchema,
			gap_seconds: GapSchema,
			gain_db: SignedRangeSchema,
		}),
		beats: z.record(z.string(), BeatSchema).default({}),
		shapes: z.record(z.string(), z.array(z.string()).min(2)).default({}),
	}),
	axes: z.record(z.string(), z.array(z.string().min(1)).min(1)),
	situation_patterns: z.array(SituationPatternSchema).min(2),
	diversity: z.object({ recent_window: z.number().int().positive() }),
	voice: z.object({
		caption: z.string().min(1).max(600).optional(),
		axes: z.record(z.string(), z.array(VoiceAxisOptionSchema).min(2)),
	}),
	reference: z.object({
		text: z.string().min(10),
		candidate_range: z.tuple([z.number().int().positive(), z.number().int().positive()]),
	}),
	mix: z.object({
		room_tone_db: z.number(),
		target_lufs: z.number(),
		loudness_range: z.number().positive(),
	}),
	asr: z.object({ model: z.string() }),
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
		tail_seconds: z.number(),
		duration_tolerance_seconds: z.number(),
	}),
	safety: z.object({ banned_terms: z.array(z.string()) }),
	metadata: z.object({
		title_forms: z.array(z.string().min(1)).min(1).optional(),
		title_suffix: z.string(),
		tags_core: z.array(z.string()),
		tags_from_axes: z.array(z.string()),
		tags_max: z.number().int().positive(),
		description_lead: z.string(),
		ai_disclosure: z.string(),
		rights_declaration: z.string(),
	}),
});
export type YawaConfig = z.infer<typeof YawaConfigSchema>;
export type VoiceProfile = {
	id: string;
	axis: string;
	caption: string;
	selected_axes: Record<string, string>;
};

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

export const ScriptMetaSchema = z.object({
	title: z.string().min(4).max(60),
	hook: z.string().min(10).max(160),
	cover_scene: z.string().min(20).max(400),
	adult_characters_confirmed: z.literal(true),
});
export type ScriptMeta = z.infer<typeof ScriptMetaSchema>;

export const ScriptDraftSchema = ScriptMetaSchema.extend({
	shape: z.string().min(1),
	chapters: z.array(
		z.object({ name: z.string().min(1), segments: z.array(z.string().min(1)).min(1) }),
	),
});
export type ScriptDraft = z.infer<typeof ScriptDraftSchema>;

export const SelectionSchema = z.object({
	id: z.string().min(1),
	shape: z.string().min(1),
	axes: z.record(z.string(), z.string().min(1)),
	title_form: z.number().int().nonnegative(),
	situation_pattern: SituationPatternSchema.optional(),
});
export type Selection = z.infer<typeof SelectionSchema>;
export type SelectionRecord = Partial<Selection> & { id: string };

function hash(text: string): number {
	let value = 2166136261;
	for (const char of text) {
		value ^= char.codePointAt(0) ?? 0;
		value = Math.imul(value, 16777619) >>> 0;
	}
	return value >>> 0;
}

/** 声の種は run 名から決める。動画ごとに変わり、同じ run を作り直せば同じになる。 */
export function runSeed(runName: string, label: string): number {
	return hash(`${runName}:${label}`);
}

/** 声の特徴軸を独立に選ぶ。好みの方向は重み付けするが、数値や一つの声像には固定しない。 */
export function voiceDesignForRun(
	config: YawaConfig,
	runName: string,
): VoiceProfile {
	const selected = Object.fromEntries(
		Object.entries(config.voice.axes).map(([axis, options]) => {
			const total = options.reduce(
				(sum, option) => sum + option.preference_weight,
				0,
			);
			let roll = hash(`${runName}:voice:${axis}`) % total;
			const option = options.find((candidate) => {
				roll -= candidate.preference_weight;
				return roll < 0;
			});
			if (!option) throw new Error(`no voice option for axis '${axis}'`);
			return [axis, option];
		}),
	);
	const selected_axes = Object.fromEntries(
		Object.entries(selected).map(([axis, option]) => [axis, option.id]),
	);
	const cues = Object.values(selected).map((option) => option.cue);
	const id = `axes-${hash(JSON.stringify(selected_axes)).toString(16)}`;
	return {
		id,
		axis: Object.entries(selected_axes)
			.map(([axis, value]) => `${axis}:${value}`)
			.join("+"),
		selected_axes,
		caption: `成人女性。今回の声の特徴を独立に組み合わせる: ${cues.join("。 ")}。場面の感情に合わせて自然に変化させ、特定の数値や語尾に固定しない。`,
	};
}

/** 使用回数が最も少ない選択肢を選ぶ。同数なら seed で決め、同じ入力には同じ結果を返す。 */
export function pickLeast(
	options: string[],
	used: string[],
	seed: string,
): string {
	const counts = options.map((o) => used.filter((u) => u === o).length);
	const least = Math.min(...counts);
	const candidates = options.filter((_, i) => counts[i] === least);
	return candidates.reduce((a, b) =>
		hash(`${seed}:${a}`) <= hash(`${seed}:${b}`) ? a : b,
	);
}

/** Configured exploration weights set the target use rate; recent history favors underused patterns. */
export function pickWeightedLeast(
	options: Array<{ id: string; weight: number }>,
	used: string[],
	seed: string,
): string {
	if (options.length === 0)
		throw new Error("at least one weighted option is required");
	const utilization = options.map((option) => ({
		id: option.id,
		ratio: used.filter((value) => value === option.id).length / option.weight,
	}));
	const least = Math.min(...utilization.map((option) => option.ratio));
	const candidates = utilization
		.filter((option) => option.ratio === least)
		.map((option) => option.id);
	return candidates.reduce((a, b) =>
		hash(`${seed}:${a}`) <= hash(`${seed}:${b}`) ? a : b,
	);
}

export function chooseSelection(
	config: YawaConfig,
	id: string,
	history: SelectionRecord[],
	runName: string,
): Selection {
	void history;
	const axes = Object.fromEntries(
		Object.entries(config.axes).map(([axis, options]) => {
			const index = hash(`${runName}:scene:${axis}`) % options.length;
			return [axis, options[index] as string];
		}),
	);
	return {
		id,
		shape: `original-${hash(`${runName}:story`).toString(16)}`,
		axes,
		title_form: 0,
	};
}

function between(range: [number, number], seed: string): number {
	const [low, high] = range;
	return Number((low + (high - low) * (hash(seed) / 4294967295)).toFixed(2));
}

/** 拍の値は範囲で持ち、run 名から決める。同じ run を作り直しても同じ値になる。 */
export function resolveBeat(
	config: YawaConfig,
	name: string,
	runName: string,
): Chapter {
	const dynamic = config.arc.dynamic;
	return {
		name,
		share: 1,
		brief: "",
		style: "",
		duration_scale: between(dynamic.duration_scale, `${runName}:${name}:scale`),
		cfg_scale_caption: between(
			dynamic.cfg_scale_caption,
			`${runName}:${name}:cfg`,
		),
		gap_seconds: between(dynamic.gap_seconds, `${runName}:${name}:gap`),
		gain_db: between(dynamic.gain_db, `${runName}:${name}:gain`),
	};
}

export function shapeBeats(
	config: YawaConfig,
	shape: string,
	runName: string,
): Chapter[] {
	const names = config.arc.shapes?.[shape];
	if (!names) throw new Error(`unknown shape: ${shape}`);
	return names.map((name) => resolveBeat(config, name, runName));
}

export type Segment = { text: string; chapter: Chapter };

export type NonverbalCuePlan = {
	cue_id: string;
	emoji: string;
	repetitions: number;
	position: "prefix" | "after_clause" | "suffix";
	segment_index: number;
	chapter: string;
	base_text: string;
	treatment_text: string;
};

export function draftSegments(
	draft: ScriptDraft,
	config: YawaConfig,
	runName: string,
): Segment[] {
	return draft.chapters.flatMap((entry) => {
		const chapter = resolveBeat(config, entry.name, runName);
		return entry.segments.map((text) => ({ text, chapter }));
	});
}

function seededIndex(runName: string, label: string, length: number): number {
	if (length < 1) throw new Error("cannot select from an empty option list");
	return runSeed(runName, label) % length;
}

function insertEmoji(
	text: string,
	emoji: string,
	repetitions: number,
	position: NonverbalCuePlan["position"],
): string {
	const marker = emoji.repeat(repetitions);
	if (position === "prefix") return `${marker}${text}`;
	if (position === "suffix") return `${text}${marker}`;
	const punctuation = /[、。！？!?]/u.exec(text);
	if (!punctuation || punctuation.index === undefined)
		return `${text}${marker}`;
	const insertionPoint = punctuation.index + punctuation[0].length;
	return `${text.slice(0, insertionPoint)}${marker}${text.slice(insertionPoint)}`;
}

/** Pick one reproducible, context-matched cue. No eligible chapter means no cue, not a failed run. */
export function chooseNonverbalCue(
	config: YawaConfig,
	draft: ScriptDraft,
	runName: string,
): NonverbalCuePlan | undefined {
	if (!config.nonverbal_experiment.enabled) return undefined;
	const segments = draftSegments(draft, config, runName);
	const eligible = config.nonverbal_experiment.cues.flatMap((cue) => {
		const choices = segments.map((_, index) => index);
		return choices.length > 0 ? [{ cue, choices }] : [];
	});
	if (eligible.length === 0) return undefined;
	const totalWeight = eligible.reduce((sum, item) => sum + item.cue.weight, 0);
	const cueRoll =
		(runSeed(runName, "nonverbal:cue") / 0x1_0000_0000) * totalWeight;
	let cumulativeWeight = 0;
	const selected =
		eligible.find((item) => {
			cumulativeWeight += item.cue.weight;
			return cueRoll < cumulativeWeight;
		}) ?? eligible[eligible.length - 1];
	if (!selected) throw new Error("no eligible nonverbal cue could be selected");
	const segmentIndex =
		selected.choices[
			seededIndex(
				runName,
				`nonverbal:${selected.cue.id}:segment`,
				selected.choices.length,
			)
		];
	if (segmentIndex === undefined)
		throw new Error("selected nonverbal cue has no matching segment");
	const segment = segments[segmentIndex];
	if (!segment)
		throw new Error("selected nonverbal cue has no matching segment");
	const position =
		selected.cue.positions[
			seededIndex(
				runName,
				`nonverbal:${selected.cue.id}:position`,
				selected.cue.positions.length,
			)
		];
	const repetitions =
		selected.cue.repetitions[
			seededIndex(
				runName,
				`nonverbal:${selected.cue.id}:repetitions`,
				selected.cue.repetitions.length,
			)
		];
	if (position === undefined || repetitions === undefined)
		throw new Error(
			"selected nonverbal cue is missing a position or repetition",
		);
	return {
		cue_id: selected.cue.id,
		emoji: selected.cue.emoji,
		repetitions,
		position,
		segment_index: segmentIndex,
		chapter: segment.chapter.name,
		base_text: segment.text,
		treatment_text: insertEmoji(
			segment.text,
			selected.cue.emoji,
			repetitions,
			position,
		),
	};
}

export function loadYawaConfig(root: string): YawaConfig {
	const config = YawaConfigSchema.parse(
		yaml.load(
			fs.readFileSync(path.join(root, "config/yawa/daily.yaml"), "utf8"),
		),
	);
	for (const [shape, names] of Object.entries(config.arc.shapes ?? {}))
		for (const name of names)
			if (!config.arc.beats?.[name])
				throw new Error(`shape '${shape}' uses unknown beat '${name}'`);
	if (
		new Set(config.situation_patterns.map((pattern) => pattern.id)).size !==
		config.situation_patterns.length
	)
		throw new Error("situation pattern ids must be unique");
	for (const form of config.metadata.title_forms ?? [])
		for (const [, axis] of form.matchAll(/\{(\w+)\}/g))
			if (!config.axes[axis as string])
				throw new Error(`title form uses unknown axis '${axis}'`);
	for (const axis of config.metadata.tags_from_axes)
		if (!config.axes[axis]) throw new Error(`tags use unknown axis '${axis}'`);
	for (const [axis, options] of Object.entries(config.voice.axes))
		if (new Set(options.map((option) => option.id)).size !== options.length)
			throw new Error(`voice axis '${axis}' ids must be unique`);
	if (
		new Set(config.nonverbal_experiment.cues.map((cue) => cue.id)).size !==
		config.nonverbal_experiment.cues.length
	)
		throw new Error("nonverbal cue ids must be unique");
	return config;
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
	const { max_segment_chars } = config.script;
	if (draft.chapters.length === 0) failures.push("script must contain chapters");
	const texts = draft.chapters.flatMap((c) => c.segments);
	texts.forEach((text, index) => {
		if (text.length > max_segment_chars)
			failures.push(`segment ${index + 1} exceeds ${max_segment_chars} chars`);
	});
	const everything = [
		draft.title,
		draft.hook,
		draft.cover_scene,
		...texts,
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
	extra: string[] = [],
	device?: "cpu" | "cuda",
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
			...(device ? ["--model-device", device, "--codec-device", device] : []),
			...extra,
		],
		env: { HF_HOME: config.tts.hf_home },
	};
}

/** 動画内の全セグメントを、同じ参照音声で生成する。声の同一性はこの参照が決め、章は話し方だけを変える。 */
export function segmentCall(
	config: YawaConfig,
	segment: Segment,
	refWav: string,
	outputWav: string,
	seed: number,
	device?: "cpu" | "cuda",
): IrodoriCall {
	const { chapter } = segment;
	return irodoriCall(
		config,
		["--ref-wavs", refWav],
		segment.text,
		`${config.voice.caption ?? ""}${chapter.style}`,
		seed,
		outputWav,
		[
			"--duration-scale",
			String(chapter.duration_scale),
			"--cfg-scale-caption",
			String(chapter.cfg_scale_caption),
		],
		device,
	);
}

/** 参照音声の候補だけを、参照なしで生成する。動画間の声は固定しない。 */
export function referenceCandidateCall(
	config: YawaConfig,
	caption: string,
	seed: number,
	outputWav: string,
	device?: "cpu" | "cuda",
): IrodoriCall {
	return irodoriCall(
		config,
		["--no-ref"],
		config.reference.text,
		caption,
		seed,
		outputWav,
		[],
		device,
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
	acoustic_measurement?: Record<string, unknown>;
};

/**
 * ASRと音響特徴は記録するだけ。参照候補はrun-seedで選び、好みは本人の聴取評価で決める。
 */
export function selectReference(
	candidates: ReferenceCandidate[],
	selectionSeed: number,
): ReferenceCandidate {
	if (candidates.length === 0)
		throw new Error("Cannot select a reference from an empty candidate list");
	return candidates[(selectionSeed >>> 0) % candidates.length] as ReferenceCandidate;
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
	runName: string;
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
	selection: Selection;
	metadata: { title: string; tags: string[] };
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
		input.ttsRecord?.seed === runSeed(input.runName, "tts")
			? ""
			: "tts seed mismatch",
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
		Math.abs(input.videoSeconds - input.audioSeconds) <=
		audit.duration_tolerance_seconds
			? ""
			: "video and audio durations differ",
	];
	const arc = [
		input.draft.shape === input.selection.shape
			? ""
			: "script shape differs from the recorded selection",
		...validateDraft(input.draft, config).filter(
			(failure) => failure.startsWith("chapters") || failure.startsWith("script"),
		),
		input.metadata.title === buildTitle(input.draft, config, input.selection)
			? ""
			: "title does not match the selection",
		input.metadata.tags.join("\n") ===
		buildTags(config, input.selection).join("\n")
			? ""
			: "tags do not match the selection",
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
			"Video and audio durations match",
			integrity.filter(Boolean),
		),
		arc_consistency: check(
			"arc_consistency",
			"Script shape, chapters, title and tags match the recorded selection",
			arc.filter(Boolean),
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
export function buildTitle(
	draft: ScriptMeta,
	config: YawaConfig,
	_selection: Selection,
): string {
	return `${draft.title}${config.metadata.title_suffix}`;
}

export function buildTags(config: YawaConfig, selection: Selection): string[] {
	return [
		...new Set([
			...config.metadata.tags_core,
			...config.metadata.tags_from_axes.map((axis) => {
				const value = selection.axes[axis];
				if (value === undefined)
					throw new Error(`axis '${axis}' is not selected`);
				return value;
			}),
		]),
	].slice(0, config.metadata.tags_max);
}

export function buildDescription(
	draft: ScriptMeta,
	entry: PoolEntry,
	config: YawaConfig,
	seconds: number,
): string {
	const minutes = Math.round(seconds / 60);
	const inspired = `${entry.author ? `着想: ${entry.title} / ${entry.author}` : `着想: ${entry.title}`}\n\n${entry.url}\n`;
	return [
		draft.hook,
		config.metadata.description_lead,
		"",
		`再生時間: 約${minutes}分。イヤホンでお聴きください。`,
		"",
		config.metadata.ai_disclosure,
		config.metadata.rights_declaration,
		"",
		inspired,
	].filter(Boolean).join("\n");
}
