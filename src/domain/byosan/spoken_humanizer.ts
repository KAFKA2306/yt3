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
	[
		/(?:記事|本文|資料).{0,40}(?:載っていない|掲載されていない|記載されていない|書かれていない|ありません|ない)/u,
		"source_limit_in_narration",
	],
	[
		/(?:確認できるのは|分かるのは|わかるのは).{0,24}(?:だけ|まで)/u,
		"evidence_boundary_in_narration",
	],
	[
		/(?:それだけで|直接|単独で).{0,40}(?:分かりません|わかりません|示すものではありません|証明するものではありません|保証しません|確定しません)/u,
		"defensive_caveat_in_narration",
	],
	[/(?:実績と取り違え|見通しを実績)/u, "repeated_warning_in_narration"],
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
			"秒算マネーの日本語YouTube台本を、耳で聞いて自然で、一本の話として追える短い語りに編集してください。資料を説明する原稿ではなく、視聴者が『何が起きて、なぜ面白いのか』をつかめる話にします。",
			"最初に一つの問いや意外な食い違いを立て、重要な出来事を見せ、最後に視聴者が持ち帰る一言へ着地させてください。story_spineは、その話を一文で言い切ります。",
			"残すセグメントは3〜4個を目安にし、入力が多い場合は少なくとも4分の1を削ってください。似た説明は一つにまとめ、出典の読み上げ、データが載っていない説明、調査手順、一般論の注意書き、同じ留保の繰り返しは keep=false にします。会社名の列挙も避け、話に必要な具体例を一つだけ残してください。入力の順序は変えず、残す内容はstory_spineにつなげてください。",
			"聞き手は賢い友人です。短い文と少し長い文を混ぜ、口に出して自然な日本語にします。「地図では」「資料で見ておこう」「同研究は」「記事本文には載っていない」「それだけでは分からない」「直接示すものではない」のように、画面・文書・確認作業・言い訳を台詞にしないでください。",
			"一番伝えたい事実ははっきり言い、必要な留保はその事実の中に短く一度だけ添えます。『計画』や『予測』は事実の一部なので消さず、計画を実績のように言い換えないでください。それ以外の限界や、入力に数字がないという説明は、公開台詞から削除します。",
			"数字を新しく足さず、原因と結果の向きを変えないでください。検証済みclaims・出典・詳しい限界は内部記録に残り、視聴者向け説明欄には出典リンクだけを残します。一般的な投資免責文や制作上の言い訳は台詞にも説明欄にも入れません。",
			"description_leadは短い紹介文、description_bulletsは視聴者が得る内容を最大3点で書きます。出典名、検証手順、限界の列挙は入れません。",
			"入力と同じindexのセグメントを一つずつ返してください。削るセグメントもkeep=falseとして返し、話者、順序、図、数値カード、出典データは別工程で保持します。",
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
	const minimumSegments = Math.min(3, draft.segments.length);
	const maximumSegments = Math.max(
		minimumSegments,
		Math.floor(draft.segments.length * 0.75),
	);
	if (segments.length < minimumSegments) {
		throw new Error(`BYOSAN_HUMANIZER_TOO_FEW_SEGMENTS: ${segments.length}`);
	}
	if (segments.length > maximumSegments) {
		throw new Error(
			`BYOSAN_HUMANIZER_TOO_MANY_SEGMENTS: maximum=${maximumSegments} actual=${segments.length}`,
		);
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
