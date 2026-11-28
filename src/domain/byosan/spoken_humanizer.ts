import { z } from "zod";
import {
	type CreativeReceipt,
	invokeCreativeStructured,
} from "../../io/creative.js";
import { ByosanFeatureDraftSchema } from "./feature_spec.js";
import { canonicalNumberTokens } from "./number_canonicalization.js";

const HumanizedSegmentSchema = z.object({
	index: z.number().int().nonnegative(),
	text: z.string(),
});

const HumanizerResponseSchema = z.object({
	story_spine: z.string().min(1).max(200),
	segments: z.array(HumanizedSegmentSchema).min(1),
});

type FeatureDraft = z.infer<typeof ByosanFeatureDraftSchema>;

export type HumanizedFeatureDraft = {
	draft: FeatureDraft;
	storySpine: string;
	edits: Array<{
		index: number;
		before: string;
		after: string;
	}>;
	receipt: CreativeReceipt;
};

function numericValues(value: unknown): Set<string> {
	const text =
		typeof value === "string" ? value : (JSON.stringify(value) ?? "");
	return new Set(canonicalNumberTokens(text));
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

function assertNoUnsupportedEarningsPraise(
	claims: FeatureDraft["claims"],
	publicCopy: string,
): void {
	const hasEstimateComparison = claims.some(({ claim }) =>
		/(?:市場予想|アナリスト予想|コンセンサス|予想比|予想を上回)/u.test(claim),
	);
	if (
		!hasEstimateComparison &&
		/(?:好決算|好業績|予想を上回|予想超え|上振れ)/u.test(publicCopy)
	) {
		throw new Error("BYOSAN_HUMANIZER_UNSUPPORTED_EARNINGS_PRAISE");
	}
}

function assertNoUnclaimedMultiple(
	claims: FeatureDraft["claims"],
	publicCopy: string,
): void {
	const multiple =
		/(?:倍増|(?:\d+(?:\.\d+)?|[一二三四五六七八九十]+)倍(?:超|以上)?)/u;
	if (
		multiple.test(publicCopy) &&
		!claims.some(({ claim }) => multiple.test(claim))
	) {
		throw new Error("BYOSAN_HUMANIZER_UNCLAIMED_MULTIPLE");
	}
}

function humanizerClaimFacts(
	draft: FeatureDraft,
): Array<{ id: string; fact: string }> {
	return draft.claims
		.filter(({ status }) => status === "verified")
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
	[/^(?:青山龍星|秒算マネー)[：:]\s*/u, "speaker_label_in_spoken_text"],
	[
		/(?:売上(?:高)?|売り上げ(?:高)?)、(?:前年同期比|前年比)(?:で)?/u,
		"headline_fragment_in_narration",
	],
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
	[
		/(?:投資助言|個別の売買を推奨|情報提供を目的|投資判断は自己責任|免責事項)/u,
		"generic_disclaimer_in_public_copy",
	],
	[
		/(?:しないといけない|しなければならない|する必要があります|する必要がある)/u,
		"teacherly_instruction_in_public_copy",
	],
	[/(?:構成対象|構成会社)/u, "formal_index_term_in_public_copy"],
	[
		/\d+(?:,\d{3})*(?:\.\d+)?十億(?:米)?ドル/u,
		"machine_translated_currency_unit",
	],
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
		/(?:なんですね|なのですね|ということです|ことが分かります|ことがわかります|と言えます)[。！？!?]?$/u,
		"report_like_final_sentence",
	],
	[
		/(?:AI供給網|好決算.{0,12}見えない動きがあります|まず目を引くのは|AIを支える部材や製造工程|追加の生産量を目指す時期|増産が形になるのは|供給を広げる動きは|先の計画だけではありません|次に見えてくるのは|供給網の姿)/u,
		"abstract_or_template_phrase_in_narration",
	],
	[
		/(?:確認できる事実から|記事本文に.{0,20}(?:ない|記載)|数字の意味を検証|資料に.{0,16}(?:ない|記載)|AI需要続く[?？]|見えてくることがあります)/u,
		"editorial_note_or_teaser_in_public_copy",
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

export function assertSpeakableLines(
	segments: Array<{ index: number; text: string }>,
): void {
	for (const segment of segments) {
		if (
			/(?:注釈|注記|根拠と限界|限界\s*[:：]|保証|かもしれない|可能性が(?:ある|あります|高い|低い)|ことが(?:あります|ある|ありました)|ことも(?:あります|ある|ありました)|見込まれ|予想されています|予測されています|と見られています|ではない|じゃありません|とは限らない|わけではない|とは別|そのものではない|意味しない|だけでは.{0,16}(?:答え|意味|証明|判断)|同一視できない|(?:答え|結果).{0,12}にならない|ではありません|予測.{0,12}実績.{0,5}(?:と区別|を区別)|(?:とは|と)言え(?:ない|ません)|断定でき(?:ない|ません)|一概に.{0,12}(?:言えない|言えません)|(?:記事|資料|本文).{0,24}(?:示していない|確認できない|支えない|記載されていない)|因果関係.{0,18}(?:結ばない|つなげない|支えない)|(?:対象と期間|改定値).{0,12}(?:区別|注意)|予測と実績は別|FRBの決定ではありません|投資判断は自己責任|免責事項)/u.test(
				segment.text,
			)
		) {
			throw new Error(
				`BYOSAN_HUMANIZER_FOOTNOTE_OR_EXCUSE: segment=${segment.index} text=${JSON.stringify(segment.text.slice(0, 180))}`,
			);
		}
		for (const [pattern, code] of META_SPEECH_PATTERNS) {
			if (pattern.test(segment.text)) {
				throw new Error(
					`BYOSAN_HUMANIZER_META_SPEECH: ${code} segment=${segment.index} text=${JSON.stringify(segment.text.slice(0, 180))}`,
				);
			}
		}
	}
}

export function assertNoSourceNames(
	segments: Array<{ index: number; text: string }>,
	sourceNames: string[],
): void {
	const markers = sourceNameMarkers(sourceNames);
	for (const segment of segments) {
		for (const marker of markers) {
			const present = /^[A-Za-z]/u.test(marker)
				? new RegExp(`\\b${marker}\\b`, "iu").test(segment.text)
				: segment.text.includes(marker);
			if (present) {
				throw new Error(
					`BYOSAN_HUMANIZER_SOURCE_NAME_IN_PUBLIC_COPY: segment=${segment.index} source=${marker} text=${JSON.stringify(segment.text.slice(0, 180))}`,
				);
			}
		}
	}
}

function assertDistinctDatesStayDistinct(
	claims: FeatureDraft["claims"],
	angle: string,
	publicCopy: string,
): void {
	const dates = new Set(
		claims.flatMap(({ claim }) =>
			[...claim.matchAll(/(20\d{2})[-年](\d{1,2})[-月](\d{1,2})日?/gu)].map(
				([, year, month, day]) =>
					`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
			),
		),
	);
	if (dates.size > 1 && /(?:同じ日|同日|その日)/u.test(publicCopy)) {
		throw new Error("BYOSAN_HUMANIZER_COLLAPSED_DISTINCT_DATES");
	}
	const requiredInterval = angle.match(
		/(?:\d+日後|翌日|翌週|翌月|数日後)/u,
	)?.[0];
	if (
		dates.size > 1 &&
		requiredInterval &&
		!publicCopy.normalize("NFKC").includes(requiredInterval.normalize("NFKC"))
	) {
		throw new Error("BYOSAN_HUMANIZER_DROPPED_NARRATIVE_INTERVAL");
	}
}

export function assertResolvedEnding(segments: Array<{ text: string }>): void {
	const finalSegment = segments.at(-1)?.text.trim();
	if (!finalSegment) throw new Error("BYOSAN_HUMANIZER_EMPTY_ENDING");
	if (/[?？][」』）)]?$/u.test(finalSegment)) {
		throw new Error("BYOSAN_HUMANIZER_UNANSWERED_FINAL_QUESTION");
	}
}

const NON_COMPANY_LATIN_TERMS = new Set([
	"ABF",
	"AI",
	"CSP",
	"CPUS",
	"CPU",
	"COWOS",
	"EPS",
	"GPU",
	"NAND",
	"NVL72",
	"QLC",
	"SSD",
	"USD",
	"VERA",
	"RUBIN",
]);

function sourceNameMarkers(sourceNames: string[]): string[] {
	return [
		...new Set(
			sourceNames.flatMap((name) => {
				const publisher =
					name.split(/\s+[—–]\s+|\s*\|\s*|:\s+/u)[0]?.trim() ?? name;
				return [
					publisher,
					...(publisher.match(/[A-Za-z][A-Za-z0-9-]{2,}/gu) ?? []).filter(
						(marker) => !NON_COMPANY_LATIN_TERMS.has(marker.toUpperCase()),
					),
				];
			}),
		),
	];
}

function stripSourceNames(text: string, sourceNames: string[]): string {
	const markers = sourceNameMarkers(sourceNames).sort(
		(left, right) => right.length - left.length,
	);
	let clean = text;
	for (const marker of markers) {
		const escaped = marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
		const boundary = /^[A-Za-z]/u.test(marker) ? `\\b${escaped}\\b` : escaped;
		const attribution = new RegExp(
			`${boundary}(?:\\s*(?:によると|によれば|による|では|から|への|の|は|が|で))?[、，,:：]?\\s*`,
			"giu",
		);
		clean = clean.replace(attribution, " ");
	}
	return clean
		.replace(/[ \t]{2,}/gu, " ")
		.replace(/([。！？!?])\s+/gu, "$1")
		.trim();
}

const MIN_REPEATED_NARRATIVE_CHARACTERS = 20;

function normalizedNarrativeText(value: string): string[] {
	return Array.from(value.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, ""));
}

function longestSharedNarrativePhrase(left: string, right: string): string {
	const leftCharacters = normalizedNarrativeText(left);
	const rightCharacters = normalizedNarrativeText(right);
	let previous = Array.from({ length: rightCharacters.length + 1 }, () => 0);
	let longestLength = 0;
	let longestEnd = 0;

	for (let leftIndex = 0; leftIndex < leftCharacters.length; leftIndex += 1) {
		const current = Array.from({ length: rightCharacters.length + 1 }, () => 0);
		for (
			let rightIndex = 0;
			rightIndex < rightCharacters.length;
			rightIndex += 1
		) {
			if (leftCharacters[leftIndex] !== rightCharacters[rightIndex]) continue;
			const length = (previous[rightIndex] ?? 0) + 1;
			current[rightIndex + 1] = length;
			if (length > longestLength) {
				longestLength = length;
				longestEnd = leftIndex + 1;
			}
		}
		previous = current;
	}

	return leftCharacters.slice(longestEnd - longestLength, longestEnd).join("");
}

function assertNoRepeatedNarrativeSegments(
	segments: Array<{ index: number; text: string }>,
): void {
	for (let left = 0; left < segments.length; left += 1) {
		for (let right = left + 1; right < segments.length; right += 1) {
			const leftSegment = segments[left];
			const rightSegment = segments[right];
			if (!leftSegment || !rightSegment) continue;
			const repeated = longestSharedNarrativePhrase(
				leftSegment.text,
				rightSegment.text,
			);
			if (repeated.length >= MIN_REPEATED_NARRATIVE_CHARACTERS) {
				throw new Error(
					`BYOSAN_HUMANIZER_REPEATED_NARRATIVE: segments=${leftSegment.index},${rightSegment.index} shared=${JSON.stringify(repeated)}`,
				);
			}
		}
	}
}

export function humanizeByosanDraft(
	draft: FeatureDraft,
): HumanizedFeatureDraft {
	const sourceNames = draft.sources.map(({ name }) => name);
	draft = {
		...draft,
		title: stripSourceNames(draft.title, sourceNames),
		descriptionLead: stripSourceNames(draft.descriptionLead, sourceNames),
		descriptionBullets: draft.descriptionBullets.map((text) =>
			stripSourceNames(text, sourceNames),
		),
		segments: draft.segments.map((segment) => ({
			...segment,
			headline: stripSourceNames(segment.headline, sourceNames),
			subheadline: stripSourceNames(segment.subheadline, sourceNames),
			text: stripSourceNames(segment.text, sourceNames),
			stats: segment.stats.map((stat) => ({
				...stat,
				label: stripSourceNames(stat.label, sourceNames),
				detail: stripSourceNames(stat.detail, sourceNames),
			})),
		})),
	};
	const response = invokeCreativeStructured({
		name: "byosan_spoken_humanizer",
		kind: "draft",
		schema: HumanizerResponseSchema,
		prompt: [
			"この動画を友人に話したくなる発見を一つ選びます。最初の一言で意外な出来事と答えを見せ、数字と具体例で仕組みを広げ、冒頭の手がかりを終盤で回収して最後に構造を一言で残します。説明文の要約や教訓、未回答の疑問で締めません。",
			"秒算マネーの単独ナレーター、青山龍星の声と人格に合わせて語りを整えます。鋭く権威があり、落ち着いた緊張感で核心を明晰に届けます。ニュース読みの硬さ、相槌、口癖、空疎な橋渡し、説明の繰り返しを削ります。短く自然な日本語で、重要な数字の前後に間を置きます。台詞に話者名を入れません。出典名や執筆者を語りで紹介せず、sourcesに任せます。見出しのような名詞句を読み上げず、事実と仕組みを主語と動詞のある文で伝えます。制作メモ、先生口調、注釈、免責、言い訳、限界の列挙、一般的な予防線を公開文に書きません。二つの結果の差は具体的に並べます。根拠のない可能性表現や、説明を引き延ばす語尾を使わず、観測事実を簡潔に述べます。堅い用語は自然な会話の言葉に直します。",
			"各セグメントに物語上の仕事を一つ持たせ、必要な事実だけを残します。問いにはすぐ答え、数字や具体例を続け、比喩で見える形にします。重複した事実と橋渡しを削り、結末では一つの構造か観測点を言い切ります。",
			"この編集はsegments[].textの話し言葉だけを整えます。title、description、headline、subheadline、stats、出典、claim ledgerは変更しません。",
			"入力と同じindexのセグメントを一つずつ返してください。セグメントを削除、追加、結合、分割、並べ替えせず、話し言葉だけを編集します。claimIdsは元のセグメントのまま維持されます。",
			"新しい数字や因果関係を足さず、順序、出典、検証用claim、タイトル、概要欄を変えません。",
			`[出典名（sources専用・台詞では使わない）]\n${JSON.stringify(sourceNameMarkers(sourceNames))}`,
			`[VERIFIED_SOURCE_FACTS]\n${JSON.stringify(humanizerClaimFacts(draft))}`,
			`[SEGMENT_SLOTS]\n${JSON.stringify(
				draft.segments.map((segment, index) => ({
					index,
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
	const editLog = draft.segments.map((segment, index) => {
		const edit = editsByIndex.get(index);
		if (!edit) throw new Error(`BYOSAN_HUMANIZER_SEGMENT_INDEX: ${index}`);
		return {
			index,
			before: segment.text,
			after: edit.text.trim(),
		};
	});
	const segments = draft.segments.map((segment, index) => {
		const edit = editsByIndex.get(index);
		if (!edit) throw new Error(`BYOSAN_HUMANIZER_SEGMENT_INDEX: ${index}`);
		const text = stripSourceNames(edit.text.trim(), sourceNames);
		if (!text) throw new Error(`BYOSAN_HUMANIZER_EMPTY_TEXT: segment=${index}`);
		return {
			...segment,
			speaker: "青山龍星" as const,
			text,
		};
	});
	assertResolvedEnding(segments);
	const publicLines = [
		{ index: -13, text: response.value.story_spine },
		{ index: -4, text: draft.title },
		{ index: -1, text: draft.descriptionLead },
		...draft.descriptionBullets.map((text, index) => ({
			index: -2 - index,
			text,
		})),
		...segments.flatMap((segment, index) => [
			{ index, text: segment.text },
			{ index: 100 + index, text: segment.headline },
			{ index: 200 + index, text: segment.subheadline },
			...segment.stats.flatMap((stat, statIndex) => [
				{ index: 300 + index * 10 + statIndex, text: stat.label },
				{ index: 400 + index * 10 + statIndex, text: stat.detail },
			]),
		]),
	];
	assertSpeakableLines(publicLines);
	assertNoSourceNames(publicLines, sourceNames);
	assertNoRepeatedNarrativeSegments(
		segments.map((segment, index) => ({ index, text: segment.text })),
	);
	// A fact can move when sections merge; compare numbers against the whole draft.
	assertNoNewNumbers(draft, {
		story_spine: response.value.story_spine,
		segments: segments.map(({ text }) => ({ text })),
	});
	const publicCopy = [
		draft.title,
		draft.descriptionLead,
		...draft.descriptionBullets,
		...segments.map(({ text }) => text),
	].join(" ");
	assertNoUnsupportedEarningsPraise(draft.claims, publicCopy);
	assertNoUnclaimedMultiple(draft.claims, publicCopy);
	assertDistinctDatesStayDistinct(draft.claims, draft.angle, publicCopy);

	const editedDraft = ByosanFeatureDraftSchema.parse({
		...draft,
		angle: response.value.story_spine.trim(),
		segments,
	});
	return {
		draft: editedDraft,
		storySpine: response.value.story_spine.trim(),
		edits: editLog,
		receipt: response.receipt,
	};
}
