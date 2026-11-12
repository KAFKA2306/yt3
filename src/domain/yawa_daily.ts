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
});

const VoiceProfileSchema = z.object({
	id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
	// This is a profile-family label; one caption may combine several voice traits.
	axis: z.string().regex(/^[a-z0-9_-]{1,80}$/),
	caption: z.string().min(10).max(300),
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
		min_segments: z.number().int().positive(),
		max_segments: z.number().int().positive(),
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
	arc: z.object({
		beats: z.record(z.string(), BeatSchema),
		shapes: z.record(z.string(), z.array(z.string()).min(2)),
	}),
	axes: z.record(z.string(), z.array(z.string().min(1)).min(1)),
	situation_patterns: z.array(SituationPatternSchema).min(2),
	diversity: z.object({ recent_window: z.number().int().positive() }),
	voice: z.object({
		caption: z.string().min(10).max(300),
		profiles: z.array(VoiceProfileSchema).min(2),
	}),
	reference: z.object({
		text: z.string().min(10),
		candidates: z.number().int().positive(),
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
		title_forms: z.array(z.string().min(1)).min(1),
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
export type VoiceProfile = z.infer<typeof VoiceProfileSchema> & {
	cycle_index: number;
	cycle_length: number;
};

const VOICE_CYCLE_START_UTC = Date.UTC(2026, 10, 11);
const UTC_DAY_MS = 24 * 60 * 60 * 1000;

/** 日付で固定した巡回。再実行は同じprofileになり、隣接日は別profileになる。 */
export function voiceProfileForDate(
	config: YawaConfig,
	date: string,
	requestedProfileId?: string,
): VoiceProfile {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
		throw new Error("DATE=YYYY-MM-DD is required");
	const timestamp = Date.parse(`${date}T00:00:00.000Z`);
	if (
		!Number.isFinite(timestamp) ||
		new Date(timestamp).toISOString().slice(0, 10) !== date
	)
		throw new Error(`invalid calendar date: ${date}`);
	const cycleLength = config.voice.profiles.length;
	if (cycleLength < 2)
		throw new Error("at least two voice profiles are required");
	const dayIndex = Math.floor((timestamp - VOICE_CYCLE_START_UTC) / UTC_DAY_MS);
	const cycleIndex = ((dayIndex % cycleLength) + cycleLength) % cycleLength;
	const selectedIndex = requestedProfileId
		? config.voice.profiles.findIndex(
				(profile) => profile.id === requestedProfileId,
			)
		: cycleIndex;
	if (selectedIndex < 0)
		throw new Error(`unknown voice profile: ${requestedProfileId}`);
	const profile = config.voice.profiles[selectedIndex];
	if (!profile) throw new Error(`no voice profile at index ${selectedIndex}`);
	return {
		...profile,
		cycle_index: selectedIndex,
		cycle_length: cycleLength,
	};
}

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
		z.object({ name: z.string(), segments: z.array(z.string().min(1)) }),
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

/** Market-derived patterns use frequency tiers while history keeps recent use near those proportions. */
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
	const situationPatternId = pickWeightedLeast(
		config.situation_patterns,
		history.flatMap((h) =>
			h.situation_pattern ? [h.situation_pattern.id] : [],
		),
		`${runName}:situation-pattern`,
	);
	const situationPattern = config.situation_patterns.find(
		(pattern) => pattern.id === situationPatternId,
	);
	if (!situationPattern)
		throw new Error(`unknown situation pattern: ${situationPatternId}`);
	const shape = pickLeast(
		situationPattern.shapes,
		history.flatMap((h) => (h.shape ? [h.shape] : [])),
		`${runName}:shape`,
	);
	const axes = Object.fromEntries(
		Object.entries(config.axes).map(([axis, options]) => [
			axis,
			pickLeast(
				options,
				history.flatMap((h) => (h.axes?.[axis] ? [h.axes[axis]] : [])),
				`${runName}:${axis}`,
			),
		]),
	);
	const title_form = Number(
		pickLeast(
			config.metadata.title_forms.map((_, i) => String(i)),
			history.flatMap((h) =>
				h.title_form === undefined ? [] : [String(h.title_form)],
			),
			`${runName}:form`,
		),
	);
	return {
		id,
		shape,
		axes,
		title_form,
		situation_pattern: situationPattern,
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
	const beat = config.arc.beats[name];
	if (!beat) throw new Error(`unknown beat: ${name}`);
	return {
		name,
		share: beat.share,
		brief: beat.brief,
		style: beat.style,
		duration_scale: between(beat.duration_scale, `${runName}:${name}:scale`),
		cfg_scale_caption: beat.cfg_scale_caption,
		gap_seconds: between(beat.gap_seconds, `${runName}:${name}:gap`),
		gain_db: beat.gain_db,
	};
}

export function shapeBeats(
	config: YawaConfig,
	shape: string,
	runName: string,
): Chapter[] {
	const names = config.arc.shapes[shape];
	if (!names) throw new Error(`unknown shape: ${shape}`);
	return names.map((name) => resolveBeat(config, name, runName));
}

export type Segment = { text: string; chapter: Chapter };

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

export function loadYawaConfig(root: string): YawaConfig {
	const config = YawaConfigSchema.parse(
		yaml.load(
			fs.readFileSync(path.join(root, "config/yawa/daily.yaml"), "utf8"),
		),
	);
	for (const [shape, names] of Object.entries(config.arc.shapes))
		for (const name of names)
			if (!config.arc.beats[name])
				throw new Error(`shape '${shape}' uses unknown beat '${name}'`);
	if (
		new Set(config.situation_patterns.map((pattern) => pattern.id)).size !==
		config.situation_patterns.length
	)
		throw new Error("situation pattern ids must be unique");
	for (const pattern of config.situation_patterns)
		for (const shape of pattern.shapes)
			if (!config.arc.shapes[shape])
				throw new Error(
					`situation pattern '${pattern.id}' uses unknown shape '${shape}'`,
				);
	for (const form of config.metadata.title_forms)
		for (const [, axis] of form.matchAll(/\{(\w+)\}/g))
			if (!config.axes[axis as string])
				throw new Error(`title form uses unknown axis '${axis}'`);
	for (const axis of config.metadata.tags_from_axes)
		if (!config.axes[axis]) throw new Error(`tags use unknown axis '${axis}'`);
	if (
		new Set(config.voice.profiles.map((profile) => profile.id)).size !==
		config.voice.profiles.length
	)
		throw new Error("voice profile ids must be unique");
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
	const { min_segments, max_segments, max_segment_chars } = config.script;
	const expected = (config.arc.shapes[draft.shape] ?? []).join(",");
	if (!expected) failures.push(`unknown shape: ${draft.shape}`);
	else if (draft.chapters.map((c) => c.name).join(",") !== expected)
		failures.push(`chapters must be exactly: ${expected}`);
	const texts = draft.chapters.flatMap((c) => c.segments);
	if (texts.length < min_segments || texts.length > max_segments)
		failures.push(
			`segments must be ${min_segments}-${max_segments}, got ${texts.length}`,
		);
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
		`${config.voice.caption}${chapter.style}`,
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
};

/**
 * 候補から参照音声を 1 つ選ぶ。基準は「聞き取れること」と「割れていないこと」。
 * 魅力の判定はしない。聴いた人の評価は別に行う。
 */
export function selectReference(
	candidates: ReferenceCandidate[],
): ReferenceCandidate {
	return [...candidates].sort(
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
			(failure) =>
				failure.startsWith("chapters") || failure.startsWith("unknown shape"),
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

function render(template: string, axes: Record<string, string>): string {
	return template.replace(/\{(\w+)\}/g, (_, axis: string) => {
		const value = axes[axis];
		if (value === undefined) throw new Error(`axis '${axis}' is not selected`);
		return value;
	});
}

/** 公開タイトル。新規投稿と既存動画の書き換えで、同じ規則を使う。 */
export function buildTitle(
	draft: ScriptMeta,
	config: YawaConfig,
	selection: Selection,
): string {
	const form = config.metadata.title_forms[selection.title_form];
	if (form === undefined) throw new Error("title_form is out of range");
	return `${render(form, selection.axes)}${draft.title}${config.metadata.title_suffix}`;
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
	].join("\n");
}
