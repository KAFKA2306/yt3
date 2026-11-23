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

function humanizerClaimFacts(
	draft: FeatureDraft,
): Array<{ id: string; fact: string }> {
	return draft.claims
		.filter(
			({ status, claim }) =>
				status === "verified" &&
				!/(?:記事|本文|資料).{0,32}(?:載っていない|記載されていない|確認できない|分からない|わからない)|限界|断定できない/u.test(
					claim,
				),
		)
		.map(({ id, claim }) => ({
			id,
			fact: claim
				.replace(
					/^[^。]{0,48}?(?:研究所|研究機関)(?:は|が|によると)[、，\s]*/u,
					"",
				)
				.replace(
					/^(?:記事|本文|資料|出典|レポート|報告書|論文|同研究所|この研究)(?:は|が|では|によると)[、，\s]*/u,
					"",
				)
				.replace(/(?:と報告している|と説明している|と述べている)$/u, "")
				.trim(),
		}));
}

const META_SPEECH_PATTERNS: Array<[RegExp, string]> = [
	[/(?:地図|図|グラフ)では/u, "visual_label_in_narration"],
	[/(?:資料|出典)で見(?:て|よう)|資料に戻って/u, "source_note_in_narration"],
	[
		/(?:本論文|同研究|この研究|論文|研究所|研究|報告書|レポート|記事|資料|出典)(?:は|が|では|によると|から)/u,
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
	[
		/(?:直接|間接的に).{0,40}(?:つながる|結び付く|関係する).{0,16}(?:とは|とまでは)(?:言えません|いえません)/u,
		"defensive_relationship_caveat_in_narration",
	],
	[
		/(?:資料|記事|本文|この情報).{0,40}(?:分かりません|わかりません|確認できません|言えません|断定できません)/u,
		"source_limit_in_narration",
	],
	[
		/(?:今回見えてきたのは|今回の発表が示すのは|手掛かりになります|手がかりになります|時間軸を追うこと)/u,
		"report_like_wrapup_in_narration",
	],
	[
		/(?:能力を増やす計画|供給能力の拡大).{0,24}需要.{0,32}(?:決めるわけではありません|保証しません|証明しません|分かりません|読めません)/u,
		"repeated_demand_caveat_in_narration",
	],
	[
		/(?:研究所|論文|報告書|レポート|資料|出典|記事)/u,
		"source_name_in_narration",
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
			"最初に一つの問いや意外な食い違いを立て、重要な出来事を見せ、最後に最初の問いへ答える一言で締めてください。story_spineは、その話を一文で言い切ります。",
			"残すセグメントは3〜4個を目安にし、入力が多い場合は少なくとも4分の1を削ってください。似た説明は一つにまとめ、出典の読み上げ、データが載っていない説明、調査手順、一般論の注意書き、同じ留保の繰り返しは keep=false にします。会社名の列挙も避け、話に必要な具体例を一つだけ残してください。入力の順序は変えず、残す内容はstory_spineにつなげてください。",
			"聞き手は賢い友人です。短い文と少し長い文を混ぜ、口に出して自然な日本語にします。台詞には「研究所」「記事」「資料」「出典」「レポート」「論文」「報告書」を一度も書かず、発表元を話の主語にしません。発表元ではなく、起きた出来事を主語にしてください。悪い例は「研究所は需要が強いと説明しています」。良い例は「台湾の輸出受注が過去最高を更新しました」です。",
			"「記事本文に数字がない」「この資料からは言えない」「直接つながるとは言えない」「それだけでは分からない」は内部監査用の説明で、公開台詞には入れません。事実の主語と動詞を自然に言い切ってください。『計画』や『予測』は事実の一部なので残し、計画を実績のように言い換えないでください。計画の事実を一度伝えたら、『需要を保証しない』などの注意を結びで繰り返さず、次に起きる具体的な動きで終えます。",
			"専門用語や役所言葉は短い日常語に置き換えます。『能力』『稼働目標』『時間軸』『手掛かり』を重ねず、『生産量』『工場が動き始める時期』『次に見ること』のように言い換えてください。『先端パッケージ』は必要なときだけ『チップを組み立てる工程』と説明し、最後は具体的な出来事で締めます。",
			"数字を新しく足さず、原因と結果の向きを変えないでください。検証済みclaims・出典・詳しい限界は内部記録に残り、視聴者向け説明欄には出典リンクだけを残します。一般的な投資免責文や制作上の言い訳は台詞にも説明欄にも入れません。",
			"description_leadは短い紹介文、description_bulletsは視聴者が得る内容を最大3点で書きます。出典名、検証手順、限界の列挙は入れません。",
			"入力と同じindexのセグメントを一つずつ返してください。削るセグメントもkeep=falseとして返し、話者、順序、図、数値カード、出典データは別工程で保持します。",
			`[TITLE]\n${draft.title}\n\n[ANGLE]\n${draft.angle}`,
			`[VERIFIED_CORE_FACTS]\n${JSON.stringify(humanizerClaimFacts(draft))}`,
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
				{
					text: segment.text,
					stats: segment.stats,
					verified_claims: draft.claims
						.filter(({ status }) => status === "verified")
						.map(({ claim, caveat, epistemicBoundary }) => ({
							claim,
							caveat,
							epistemicBoundary,
						})),
				},
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
