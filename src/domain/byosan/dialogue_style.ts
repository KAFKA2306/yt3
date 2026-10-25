import { z } from "zod";
import { loadConfig } from "../../io/core.js";

const nonEmptyString = z.string().min(1);
const positiveInteger = z.number().int().positive();

const DialogueStyleSchema = z.object({
	prompt_heading: nonEmptyString,
	guidance: z.array(nonEmptyString),
	repair_summary: nonEmptyString,
	targets: z.object({
		max_chars_per_utterance: positiveInteger,
		max_sentences_per_utterance: positiveInteger,
		opening_seconds: positiveInteger,
		filler_phrases: z.array(nonEmptyString).min(1),
		production_memo_terms: z.array(nonEmptyString).min(1),
	}),
});

export type DialogueStyle = z.infer<typeof DialogueStyleSchema>;
type DialogueStyleTargets = DialogueStyle["targets"];

type DialogueUtterance = { speaker: string; text: string };

type DialogueStyleReport = {
	schemaVersion: "byosan_dialogue_style_report_v1";
	utterances: number;
	speaker_utterances: Record<string, number>;
	chars: { mean: number; median: number; p90: number; max: number };
	over_max_chars: number;
	max_sentences: number;
	over_max_sentences: number;
	opening_utterances: number;
	filler_utterances: Record<string, number>;
};

export function loadDialogueStyle(): DialogueStyle {
	return DialogueStyleSchema.parse(
		(loadConfig("byosan_money") as unknown as { dialogue_style: unknown })
			.dialogue_style,
	);
}

function renderTargets(text: string, targets: DialogueStyleTargets): string {
	const numeric = targets as Record<string, unknown>;
	return text.replaceAll(/\{(\w+)\}/g, (_, key: string) => {
		const value = numeric[key];
		if (typeof value === "number") return String(value);
		if (Array.isArray(value)) return value.join("、");
		throw new Error(`DIALOGUE_STYLE_PLACEHOLDER_UNKNOWN: ${key}`);
	});
}

export function renderDialogueStylePrompt(style: DialogueStyle): string {
	if (style.guidance.length === 0) return "";
	return [
		style.prompt_heading,
		...style.guidance.map((rule) => `- ${renderTargets(rule, style.targets)}`),
	].join("\n");
}

export function renderDialogueRepairSummary(style: DialogueStyle): string {
	if (style.guidance.length === 0) return "";
	return renderTargets(style.repair_summary, style.targets);
}

function percentile(sorted: number[], ratio: number): number {
	const index = Math.max(0, Math.ceil(ratio * sorted.length) - 1);
	return sorted[index] ?? 0;
}

function sentenceCount(text: string): number {
	return text.split(/[。！？!?]/).filter((part) => part.trim().length > 0)
		.length;
}

export function dialogueStyleReport(
	utterances: DialogueUtterance[],
	targets: DialogueStyleTargets,
	charsPerSecond: number,
): DialogueStyleReport {
	const lengths = utterances.map((utterance) => utterance.text.length);
	const sorted = [...lengths].sort((left, right) => left - right);
	const sentences = utterances.map((utterance) =>
		sentenceCount(utterance.text),
	);
	let elapsedSeconds = 0;
	let openingUtterances = 0;
	for (const utterance of utterances) {
		if (elapsedSeconds < targets.opening_seconds) openingUtterances += 1;
		elapsedSeconds += utterance.text.length / charsPerSecond;
	}
	const total = lengths.reduce((sum, length) => sum + length, 0);
	return {
		schemaVersion: "byosan_dialogue_style_report_v1",
		utterances: utterances.length,
		speaker_utterances: countBy(utterances.map((u) => u.speaker)),
		chars: {
			mean: Math.round((total / utterances.length) * 10) / 10,
			median: percentile(sorted, 0.5),
			p90: percentile(sorted, 0.9),
			max: sorted[sorted.length - 1] ?? 0,
		},
		over_max_chars: lengths.filter(
			(length) => length > targets.max_chars_per_utterance,
		).length,
		max_sentences: Math.max(...sentences),
		over_max_sentences: sentences.filter(
			(count) => count > targets.max_sentences_per_utterance,
		).length,
		opening_utterances: openingUtterances,
		filler_utterances: Object.fromEntries(
			targets.filler_phrases.map((phrase) => [
				phrase,
				utterances.filter((utterance) => utterance.text.includes(phrase))
					.length,
			]),
		),
	};
}

function countBy(keys: string[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
	return counts;
}
