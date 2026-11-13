import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { sha256File } from "../domain/publication_state.js";
import {
	loadYawaConfig,
	type Selection,
	SelectionSchema,
} from "../domain/yawa_daily.js";
import { ROOT } from "../io/core.js";

const config = loadYawaConfig(ROOT);
const bucketDir = path.join(ROOT, "runs", config.run.bucket);
const reportWindow = config.diversity.recent_window;

const ScriptSnapshotSchema = z.object({
	title: z.string().optional(),
	hook: z.string().optional(),
	segments: z.array(z.string()).optional(),
	chapters: z
		.array(z.object({ segments: z.array(z.string()) }).passthrough())
		.optional(),
});

type Observation = {
	run_id: string;
	selection: Selection;
	title: string;
	hook: string;
	text: string;
	words: string[];
	voice_profile_id: string | null;
	nonverbal_cue_id: string | null;
	voice_features: Record<string, unknown> | null;
};

type Distribution = {
	sample_count: number;
	missing_count: number;
	configured_options: number;
	observed_options: number;
	coverage_ratio: number | null;
	normalized_entropy: number | null;
	counts: Record<string, number>;
};

const segmenter = new Intl.Segmenter("ja", { granularity: "word" });
const lexicalStopWords = new Set([
	"って",
	"てい",
	"ます",
	"した",
	"いる",
	"しょう",
	"んで",
	"から",
	"まで",
	"こと",
	"ここ",
	"なく",
	"です",
	"ない",
	"いい",
	"たら",
	"だけ",
	"もう",
	"して",
	"する",
	"ある",
	"よう",
	"ので",
	"でも",
	"また",
	"しま",
	"さい",
	"くだ",
	"この",
	"その",
	"これ",
	"それ",
	"あなた",
]);

function tokenize(text: string): string[] {
	return [...segmenter.segment(text.normalize("NFKC"))]
		.filter((part) => part.isWordLike && part.segment.length >= 2)
		.map((part) => part.segment.toLowerCase())
		.filter((word) => !lexicalStopWords.has(word));
}

function readOptionalJson(file: string): unknown | undefined {
	if (!fs.existsSync(file)) return undefined;
	return fs.readJsonSync(file);
}

function readObservations(): {
	observations: Observation[];
	excluded: string[];
	missingArtifactRuns: string[];
	windowRunCount: number;
} {
	if (!fs.existsSync(bucketDir))
		return {
			observations: [],
			excluded: [],
			missingArtifactRuns: [],
			windowRunCount: 0,
		};
	const observations: Observation[] = [];
	const excluded: string[] = [];
	const missingArtifactRuns: string[] = [];
	const runNames = fs
		.readdirSync(bucketDir)
		.filter((name) => fs.statSync(path.join(bucketDir, name)).isDirectory())
		.sort()
		.slice(-reportWindow);

	for (const runName of runNames) {
		const runDir = path.join(bucketDir, runName);
		const selectionFile = path.join(runDir, "selection.json");
		const scriptFile = path.join(runDir, "script.json");
		const missingFiles = [selectionFile, scriptFile]
			.filter((file) => !fs.existsSync(file))
			.map((file) => path.basename(file));
		if (missingFiles.length > 0) {
			missingArtifactRuns.push(
				`${runName}: missing ${missingFiles.join(", ")}`,
			);
			continue;
		}
		try {
			const selection = SelectionSchema.parse(fs.readJsonSync(selectionFile));
			const script = ScriptSnapshotSchema.parse(fs.readJsonSync(scriptFile));
			const segments =
				script.segments ??
				script.chapters?.flatMap((chapter) => chapter.segments) ??
				[];
			const text = segments.join(" ");
			if (!text.trim()) throw new Error("script contains no segment text");
			const voiceExperiment = readOptionalJson(
				path.join(runDir, "voice_experiment.json"),
			);
			const voiceProfileId =
				typeof voiceExperiment === "object" &&
				voiceExperiment !== null &&
				"profile_id" in voiceExperiment &&
				typeof voiceExperiment.profile_id === "string"
					? voiceExperiment.profile_id
					: null;
			const nonverbalExperiment = readOptionalJson(
				path.join(runDir, "nonverbal_experiment.json"),
			);
			const nonverbalCueId =
				typeof nonverbalExperiment === "object" &&
				nonverbalExperiment !== null &&
				"cue" in nonverbalExperiment &&
				typeof nonverbalExperiment.cue === "object" &&
				nonverbalExperiment.cue !== null &&
				"id" in nonverbalExperiment.cue &&
				typeof nonverbalExperiment.cue.id === "string"
					? nonverbalExperiment.cue.id
					: null;
			const voiceFeaturesValue = readOptionalJson(
				path.join(runDir, "voice_features.json"),
			);
			const rawVoiceFeatures =
				typeof voiceFeaturesValue === "object" &&
				voiceFeaturesValue !== null &&
				"features" in voiceFeaturesValue &&
				typeof voiceFeaturesValue.features === "object" &&
				voiceFeaturesValue.features !== null
					? (voiceFeaturesValue.features as Record<string, unknown>)
					: null;
			const nestedFormants = rawVoiceFeatures?.formant_estimates_unsegmented;
			const formantRecord =
				typeof nestedFormants === "object" && nestedFormants !== null
					? (nestedFormants as Record<string, unknown>)
					: null;
			const voiceFeatures = rawVoiceFeatures
				? {
						...rawVoiceFeatures,
						...(formantRecord
							? {
									f1_median_hz: formantRecord.f1_median_hz,
									f1_bandwidth_median_hz: formantRecord.f1_bandwidth_median_hz,
									f2_median_hz: formantRecord.f2_median_hz,
									f3_median_hz: formantRecord.f3_median_hz,
								}
							: {}),
					}
				: null;
			observations.push({
				run_id: runName,
				selection,
				title: script.title ?? "",
				hook: script.hook ?? "",
				text,
				words: tokenize(text),
				voice_profile_id: voiceProfileId,
				nonverbal_cue_id: nonverbalCueId,
				voice_features: voiceFeatures,
			});
		} catch (error) {
			const reason =
				error instanceof z.ZodError
					? error.issues
							.map(
								(issue) =>
									`${issue.path.join(".") || "root"}: ${issue.message}`,
							)
							.join("; ")
					: String(error);
			excluded.push(`${runName}: ${reason}`);
		}
	}
	return {
		observations,
		excluded,
		missingArtifactRuns,
		windowRunCount: runNames.length,
	};
}

function distribution(
	options: string[],
	values: Array<string | null | undefined>,
): Distribution {
	const counts = Object.fromEntries(options.map((option) => [option, 0]));
	let sampleCount = 0;
	for (const value of values) {
		if (!value) continue;
		if (!(value in counts)) counts[value] = 0;
		counts[value] = (counts[value] ?? 0) + 1;
		sampleCount++;
	}
	const nonzero = Object.values(counts).filter((count) => count > 0);
	const entropy = nonzero.reduce((sum, count) => {
		const probability = count / sampleCount;
		return sum - probability * Math.log(probability);
	}, 0);
	return {
		sample_count: sampleCount,
		missing_count: values.length - sampleCount,
		configured_options: options.length,
		observed_options: nonzero.length,
		coverage_ratio: options.length > 0 ? nonzero.length / options.length : null,
		normalized_entropy:
			options.length > 1 && sampleCount > 0
				? Number((entropy / Math.log(options.length)).toFixed(4))
				: null,
		counts,
	};
}

function maxJaccardSimilarity(observations: Observation[]) {
	let maximum = 0;
	let pair: [string, string] | null = null;
	for (let left = 0; left < observations.length; left++) {
		for (let right = left + 1; right < observations.length; right++) {
			const a = new Set(observations[left]?.words ?? []);
			const b = new Set(observations[right]?.words ?? []);
			const union = new Set([...a, ...b]);
			if (union.size === 0) continue;
			let intersection = 0;
			for (const word of a) if (b.has(word)) intersection++;
			const similarity = intersection / union.size;
			if (similarity > maximum) {
				maximum = similarity;
				pair = [
					observations[left]?.run_id ?? "",
					observations[right]?.run_id ?? "",
				];
			}
		}
	}
	return { score: Number(maximum.toFixed(4)), pair };
}

function wordFrequency(observations: Observation[]) {
	const counts = new Map<string, number>();
	const runCounts = new Map<string, number>();
	for (const observation of observations) {
		const oncePerRun = new Set(observation.words);
		for (const word of observation.words)
			counts.set(word, (counts.get(word) ?? 0) + 1);
		for (const word of oncePerRun)
			runCounts.set(word, (runCounts.get(word) ?? 0) + 1);
	}
	return [...counts]
		.map(([word, count]) => ({
			word,
			count,
			runs: runCounts.get(word) ?? 0,
		}))
		.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
		.slice(0, 30);
}

function numericSummary(observations: Observation[], key: string) {
	const values = observations
		.map((observation) => observation.voice_features?.[key])
		.filter(
			(value): value is number =>
				typeof value === "number" &&
				Number.isFinite(value) &&
				!(key === "hnr_median_db" && value <= -100),
		)
		.sort((a, b) => a - b);
	if (values.length === 0)
		return { count: 0, min: null, median: null, max: null };
	const middle = Math.floor(values.length / 2);
	const median =
		values.length % 2 === 0
			? ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2
			: values[middle];
	return {
		count: values.length,
		min: values[0] ?? null,
		median: median ?? null,
		max: values[values.length - 1] ?? null,
	};
}

function buildReport() {
	const { observations, excluded, missingArtifactRuns, windowRunCount } =
		readObservations();
	const selections = observations.map((observation) => observation.selection);
	const dimensions: Record<string, Distribution> = {
		situation_pattern: distribution(
			config.situation_patterns.map((pattern) => pattern.id),
			selections.map((selection) => selection.situation_pattern?.id),
		),
		story_shape: distribution(
			Object.keys(config.arc.shapes),
			selections.map((selection) => selection.shape),
		),
		voice_profile: distribution(
			config.voice.profiles.map((profile) => profile.id),
			observations.map((observation) => observation.voice_profile_id),
		),
		nonverbal_cue: distribution(
			config.nonverbal_experiment.cues.map((cue) => cue.id),
			observations.map((observation) => observation.nonverbal_cue_id),
		),
	};
	for (const [axis, options] of Object.entries(config.axes))
		dimensions[axis] = distribution(
			options,
			selections.map((selection) => selection.axes[axis]),
		);

	const wordCounts = wordFrequency(observations);
	const pairwiseSimilarity = maxJaccardSimilarity(observations);
	const suggestions: string[] = [];
	for (const [dimension, report] of Object.entries(dimensions)) {
		if (report.configured_options > 0 && report.sample_count > 0) {
			const unused = Object.entries(report.counts)
				.filter(([, count]) => count === 0)
				.map(([value]) => value);
			if (unused.length > 0)
				suggestions.push(
					`${dimension}: 未使用候補 ${unused.slice(0, 8).join("、")}${unused.length > 8 ? " ほか" : ""}`,
				);
		}
	}
	if (pairwiseSimilarity.pair && pairwiseSimilarity.score > 0)
		suggestions.push(
			`台本全体の語彙Jaccard最大値 ${pairwiseSimilarity.score} (${pairwiseSimilarity.pair.join(" vs ")}); 上位頻出語と状況設定を次のYAML設計で見直す`,
		);
	if (
		observations.some((observation) => !observation.selection.situation_pattern)
	)
		suggestions.push(
			"新しい状況パターン形式の記録がない過去runが含まれます。状況分布は記録のあるrun数と分けて解釈してください。",
		);

	return {
		generated_at: new Date().toISOString(),
		advisory_only: true,
		gate_applied: false,
		production_or_publication_effect: "none",
		config_path: "config/yawa/daily.yaml",
		config_sha256: sha256File(path.join(ROOT, "config/yawa/daily.yaml")),
		window: reportWindow,
		window_run_count: windowRunCount,
		observation_count: observations.length,
		missing_artifact_runs: missingArtifactRuns,
		excluded_runs: excluded,
		dimensions,
		scripts: {
			unique_word_count: new Set(observations.flatMap((item) => item.words))
				.size,
			max_pairwise_word_jaccard: pairwiseSimilarity,
			top_word_frequency: wordCounts,
		},
		voice_measurements: {
			advisory_only: true,
			f0_median_hz: numericSummary(observations, "f0_median_hz"),
			f0_p95_p05_semitone: numericSummary(observations, "f0_p95_p05_semitone"),
			spectral_centroid_median_hz: numericSummary(
				observations,
				"spectral_centroid_median_hz",
			),
			spectral_rolloff85_median_hz: numericSummary(
				observations,
				"spectral_rolloff85_median_hz",
			),
			spectral_tilt_db_octave: numericSummary(
				observations,
				"spectral_tilt_db_octave",
			),
			hnr_median_db: numericSummary(observations, "hnr_median_db"),
			a1_p0_median_db: numericSummary(observations, "a1_p0_median_db"),
			f1_median_hz: numericSummary(observations, "f1_median_hz"),
			f2_median_hz: numericSummary(observations, "f2_median_hz"),
			f3_median_hz: numericSummary(observations, "f3_median_hz"),
			f1_bandwidth_median_hz: numericSummary(
				observations,
				"f1_bandwidth_median_hz",
			),
		},
		suggestions,
	};
}

function formatReport(report: ReturnType<typeof buildReport>): string {
	const dimensionLines = Object.entries(report.dimensions).map(
		([name, value]) =>
			`- ${name}: ${value.observed_options}/${value.configured_options} options; coverage=${value.coverage_ratio === null ? "n/a" : value.coverage_ratio.toFixed(2)}; normalized_entropy=${value.normalized_entropy === null ? "n/a" : value.normalized_entropy.toFixed(3)}; samples=${value.sample_count}, missing=${value.missing_count}`,
	);
	return [
		"# Yawa Diversity Diagnostic",
		"",
		`Generated: ${report.generated_at}`,
		`Window: ${report.observation_count}/${report.window_run_count} readable runs (target ${report.window})`,
		"Mode: advisory only; no gate; no production or publication effect",
		"",
		"## Design dimensions",
		...dimensionLines,
		"",
		"## Voice measurements (reference values only)",
		`- F0 median (Hz): ${JSON.stringify(report.voice_measurements.f0_median_hz)}`,
		`- F0 range (semitones): ${JSON.stringify(report.voice_measurements.f0_p95_p05_semitone)}`,
		`- Spectral centroid median (Hz): ${JSON.stringify(report.voice_measurements.spectral_centroid_median_hz)}`,
		`- Spectral rolloff 85% (Hz): ${JSON.stringify(report.voice_measurements.spectral_rolloff85_median_hz)}`,
		`- Spectral tilt (dB/octave): ${JSON.stringify(report.voice_measurements.spectral_tilt_db_octave)}`,
		`- HNR (dB): ${JSON.stringify(report.voice_measurements.hnr_median_db)}`,
		`- A1−P0 (dB): ${JSON.stringify(report.voice_measurements.a1_p0_median_db)}`,
		`- Formant estimates F1/F2/F3 (Hz; unsegmented and exploratory): ${JSON.stringify([report.voice_measurements.f1_median_hz, report.voice_measurements.f2_median_hz, report.voice_measurements.f3_median_hz])}`,
		"- HNR samples at or below -100 dB are omitted from summaries as unusable silence/unvoiced values.",
		"",
		"## Frequent words",
		"(Common function words and direct-address pronouns omitted.)",
		...report.scripts.top_word_frequency
			.slice(0, 20)
			.map(
				(item) =>
					`- ${item.word}: ${item.count} occurrences in ${item.runs} runs`,
			),
		"",
		"## Design suggestions",
		...(report.suggestions.length > 0
			? report.suggestions.map((suggestion) => `- ${suggestion}`)
			: ["- No advisory suggestions in this window."]),
		"",
		...(report.excluded_runs.length > 0
			? [
					"## Excluded malformed runs",
					...report.excluded_runs.map((value) => `- ${value}`),
					"",
				]
			: []),
		...(report.missing_artifact_runs.length > 0
			? [
					"## Runs missing selection or script",
					...report.missing_artifact_runs.map((value) => `- ${value}`),
					"",
				]
			: []),
	].join("\n");
}

const report = buildReport();
const markdown = formatReport(report);
const outputDir = path.join(ROOT, "logs");
fs.ensureDirSync(outputDir);
fs.writeJsonSync(path.join(outputDir, "yawa_diversity_report.json"), report, {
	spaces: 2,
});
fs.writeFileSync(path.join(outputDir, "yawa_diversity_report.md"), markdown);
console.log(markdown);
