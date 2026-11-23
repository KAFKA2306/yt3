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
	title: z.string().min(1).max(100),
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
		/(?:AI供給網|好決算.{0,12}見えない動きがあります|まず目を引くのは|AIを支える部材や製造工程|追加の生産量を目指す時期|増産が形になるのは|供給を広げる動きは|先の計画だけではありません|次に見えてくるのは|供給網の姿)/u,
		"abstract_or_template_phrase_in_narration",
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
					`BYOSAN_HUMANIZER_META_SPEECH: ${code} segment=${segment.index} text=${JSON.stringify(segment.text.slice(0, 180))}`,
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
			"秒算マネーの日本語YouTube台本を、友人に話すような自然な日本語に編集してください。調査結果の報告ではなく、視聴者が出来事を一度でつかめる短い話にします。",
			"titleは企業名と具体的な変化を中心に、自然な見出しにします。『AI供給網』『好決算の先で広がる動き』のような抽象的なまとめや、需要への注意書きをタイトルにしません。",
			"最初は具体的な出来事から入ります。『見えない動きがあります』『まず目を引くのは』『では、いつでしょうか』のような前置きや、答えを引き延ばす問いかけは使いません。story_spineは話の中心を一文で言い切ります。",
			"似た説明は一つにまとめ、出典や資料の読み上げ、調査手順、データの有無、一般論の注意書きは削除します。会社名は話に必要なものだけ残し、残す各文には具体的な主語と動詞を置きます。抽象的な一文を埋め草として足さず、事実が少なければ短く終えます。",
			"『記事では』『資料によると』『発表によれば』『報告書には』のように、何かを読んで報告する形で話しません。出典元ではなく、企業や工場、製品を主語にして事実を話します。",
			"短い文と少し長い文を混ぜて、音読したときに引っかからない言葉を選びます。『供給網』『供給を広げる動き』『生産量を目指す時期』『増産が形になる』のような抽象語や報告書調の言い回しを避け、誰が何をいつするのかをそのまま言います。",
			"例：『追加の生産量を目指す時期は2028年第3四半期』ではなく、『基板の生産量を今の3.5倍超に増やす目標は、2028年第3四半期です』。『次に見えてくるのは、2027年後半に生産が始まるかどうか』ではなく、『Kinsusが生産を始める予定は2027年後半です』。",
			"『記事本文に数字がない』『この資料からは言えない』『直接つながるとは言えない』『それだけでは分からない』は内部監査用で、公開台詞には入れません。計画や予測は事実として明確に言い、実績とは混同しません。計画の留保を一度伝えた後に、需要への注意や『次に見ること』を重ねません。",
			"結びは最初の話題に答える具体的な事実か、予定されている日付・出来事を言い切って終えます。『今回見えたのは』『手掛かりになります』『今後を見守る必要があります』のような報告書調のまとめは使いません。",
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
	const maximumSegments = Math.min(
		draft.segments.length,
		Math.max(4, Math.floor(draft.segments.length * 0.75)),
	);
	if (segments.length < minimumSegments) {
		throw new Error(`BYOSAN_HUMANIZER_TOO_FEW_SEGMENTS: ${segments.length}`);
	}
	if (segments.length > maximumSegments) {
		throw new Error(
			`BYOSAN_HUMANIZER_TOO_MANY_SEGMENTS: source=${draft.segments.length} maximum=${maximumSegments} actual=${segments.length} kept=${JSON.stringify(segments.map(({ text }) => text.slice(0, 120)))}`,
		);
	}
	assertSpeakableLines([
		{ index: -4, text: response.value.title },
		{ index: -1, text: response.value.description_lead },
		...response.value.description_bullets.map((text, index) => ({
			index: -2 - index,
			text,
		})),
		...segments.map((segment, index) => ({ index, text: segment.text })),
	]);
	// A fact can move when sections merge; compare numbers against the whole draft.
	assertNoNewNumbers(draft, {
		story_spine: response.value.story_spine,
		description_lead: response.value.description_lead,
		description_bullets: response.value.description_bullets,
		segments: segments.map(({ text }) => text),
	});

	const editedDraft = ByosanFeatureDraftSchema.parse({
		...draft,
		title: response.value.title.trim(),
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
