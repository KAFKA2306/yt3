import { z } from "zod";
import {
	type CreativeReceipt,
	invokeCreativeStructured,
} from "../../io/creative.js";
import { ByosanFeatureDraftSchema } from "./feature_spec.js";

const HumanizedSegmentSchema = z.object({
	index: z.number().int().nonnegative(),
	keep: z.boolean(),
	text: z.string(),
});

const HumanizerResponseSchema = z.object({
	story_spine: z.string().min(1).max(200),
	description_lead: z.string().min(1).max(350),
	description_bullets: z.array(z.string().min(1).max(160)).min(1).max(3),
	segments: z.array(HumanizedSegmentSchema).min(1),
});

type FeatureDraft = z.infer<typeof ByosanFeatureDraftSchema>;

export type HumanizedFeatureDraft = {
	draft: FeatureDraft;
	storySpine: string;
	removedSegmentIndexes: number[];
	edits: Array<{ index: number; keep: boolean; before: string; after: string }>;
	receipt: CreativeReceipt;
};

function numericValues(value: unknown): Set<string> {
	const text =
		typeof value === "string" ? value : (JSON.stringify(value) ?? "");
	return new Set(
		[...text.normalize("NFKC").matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/gu)].map(
			([token]) => Number(token?.replaceAll(",", "")).toString(),
		),
	);
}

function assertNoNewNumbers(original: unknown, edited: unknown): void {
	const allowed = numericValues(original);
	const added = [...numericValues(edited)].filter(
		(value) => !allowed.has(value),
	);
	if (added.length > 0) {
		throw new Error(`BYOSAN_HUMANIZER_ADDED_NUMBERS: ${added.join(",")}`);
	}
}

const META_SPEECH_PATTERNS: Array<[RegExp, string]> = [
	[/(?:地図|図|グラフ)では/u, "visual_label_in_narration"],
	[/(?:資料|出典)で見(?:て|よう)|資料に戻って/u, "source_note_in_narration"],
	[
		/(?:本論文|同研究|この研究|論文|研究|報告書)(?:は|が|では|によると)/u,
		"document_voice_in_narration",
	],
	[
		/因果を.{0,16}(?:説明|示|特定).{0,16}(?:しません|していません)/u,
		"defensive_caveat_in_narration",
	],
	[/(?:投資助言|個別の売買を推奨)/u, "generic_disclaimer_in_narration"],
];

function assertSpeakableLines(
	segments: Array<{ index: number; text: string }>,
): void {
	for (const segment of segments) {
		for (const [pattern, code] of META_SPEECH_PATTERNS) {
			if (pattern.test(segment.text)) {
				throw new Error(
					`BYOSAN_HUMANIZER_META_SPEECH: ${code} segment=${segment.index}`,
				);
			}
		}
	}
}

export function humanizeByosanDraft(
	draft: FeatureDraft,
): HumanizedFeatureDraft {
	const response = invokeCreativeStructured({
		name: "byosan_interactive_humanizer",
		kind: "draft",
		schema: HumanizerResponseSchema,
		prompt: [
			"秒算マネーの日本語YouTube台本を、耳で聞いて自然で、一本の話として追える原稿に編集してください。資料の説明ではなく、視聴者が市場で起きたことを理解できる語りが目的です。",
			"話の芯を一文で定め、残す各セグメントをその芯へつないでください。別の仕組みを並べるだけの箇所、同じ注意書きの反復、出典や図の説明だけの箇所は keep=false にできます。順序を変えず、必要な原因と結果は残してください。",
			"textは人が話す自然な日本語に直してください。「地図では」「資料で見ておこう」「同研究は」のように、画面や文書の説明を台詞にしないでください。専門用語は必要な場合だけ使い、その場で短く言い換えてください。",
			"数字を新しく足さず、原因と結果の向きを変えないでください。検証済みclaimsとその出典・限界は入力データに残ります。視聴者が事実を誤解する場合だけ、該当箇所で短く自然に条件を添えてください。一般的な免責文や制作上の言い訳は台詞に入れないでください。",
			"description_leadは短い紹介文、description_bulletsは視聴者が得る内容を最大3点で書きます。出典名、検証手順、限界の列挙は入れません。",
			"入力と同じindexのセグメントを一つずつ返してください。話者、順序、図、数値カード、出典データは別工程で保持されます。",
			`[TITLE]\n${draft.title}\n\n[ANGLE]\n${draft.angle}`,
			`[CLAIMS]\n${JSON.stringify(
				draft.claims.map(
					({ id, claim, status, caveat, epistemicBoundary }) => ({
						id,
						claim,
						status,
						caveat,
						epistemicBoundary,
					}),
				),
			)}`,
			`[SEGMENTS]\n${JSON.stringify(
				draft.segments.map((segment, index) => ({
					index,
					speaker: segment.speaker,
					section: segment.section,
					headline: segment.headline,
					claim_ids: segment.claimIds ?? [],
					stats: segment.stats,
					text: segment.text,
				})),
			)}`,
		].join("\n\n"),
	});

	if (response.value.segments.length !== draft.segments.length) {
		throw new Error(
			`BYOSAN_HUMANIZER_SEGMENT_COUNT: expected=${draft.segments.length} actual=${response.value.segments.length}`,
		);
	}
	const editsByIndex = new Map<
		number,
		z.infer<typeof HumanizedSegmentSchema>
	>();
	for (const edit of response.value.segments) {
		if (edit.index >= draft.segments.length || editsByIndex.has(edit.index)) {
			throw new Error(`BYOSAN_HUMANIZER_SEGMENT_INDEX: ${edit.index}`);
		}
		editsByIndex.set(edit.index, edit);
	}
	if (editsByIndex.size !== draft.segments.length) {
		throw new Error("BYOSAN_HUMANIZER_SEGMENT_INDEX: missing index");
	}

	const removedSegmentIndexes: number[] = [];
	const editLog = draft.segments.map((segment, index) => {
		const edit = editsByIndex.get(index);
		if (!edit) throw new Error(`BYOSAN_HUMANIZER_SEGMENT_INDEX: ${index}`);
		if (edit.keep) {
			assertNoNewNumbers(
				{ text: segment.text, stats: segment.stats },
				edit.text,
			);
		}
		return {
			index,
			keep: edit.keep,
			before: segment.text,
			after: edit.keep ? edit.text.trim() : "",
		};
	});
	const segments = draft.segments.flatMap((segment, index) => {
		const edit = editsByIndex.get(index);
		if (!edit) throw new Error(`BYOSAN_HUMANIZER_SEGMENT_INDEX: ${index}`);
		if (!edit.keep) {
			removedSegmentIndexes.push(index);
			return [];
		}
		const text = edit.text.trim();
		if (!text) throw new Error(`BYOSAN_HUMANIZER_EMPTY_TEXT: segment=${index}`);
		return [{ ...segment, text }];
	});
	if (segments.length < Math.min(5, draft.segments.length)) {
		throw new Error(`BYOSAN_HUMANIZER_TOO_FEW_SEGMENTS: ${segments.length}`);
	}
	assertSpeakableLines([
		{ index: -1, text: response.value.description_lead },
		...response.value.description_bullets.map((text, index) => ({
			index: -2 - index,
			text,
		})),
		...segments.map((segment, index) => ({ index, text: segment.text })),
	]);
	assertNoNewNumbers(draft, {
		story_spine: response.value.story_spine,
		description_lead: response.value.description_lead,
		description_bullets: response.value.description_bullets,
		segments: segments.map(({ text }) => text),
	});

	const editedDraft = ByosanFeatureDraftSchema.parse({
		...draft,
		descriptionLead: response.value.description_lead,
		descriptionBullets: response.value.description_bullets,
		segments,
	});
	return {
		draft: editedDraft,
		storySpine: response.value.story_spine.trim(),
		removedSegmentIndexes,
		edits: editLog,
		receipt: response.receipt,
	};
}
