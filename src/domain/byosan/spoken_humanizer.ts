import { z } from "zod";
import {
	type CreativeReceipt,
	invokeCreativeStructured,
} from "../../io/creative.js";
import { ByosanFeatureDraftSchema } from "./feature_spec.js";

const HumanizedStatSchema = z.object({
	source_index: z.number().int().nonnegative(),
	label: z.string().min(1).max(24),
	detail: z.string().min(1),
});

const HumanizedSegmentSchema = z.object({
	index: z.number().int().nonnegative(),
	keep: z.boolean(),
	fact_ids: z.array(z.string().min(1)).max(8),
	text: z.string(),
	headline: z.string(),
	subheadline: z.string(),
	stats: z.array(HumanizedStatSchema).max(3),
});

const HumanizedThumbnailSchema = z.object({
	eyebrow: z.string().min(2).max(18),
	lead: z.string().min(1).max(8),
	accent: z.string().min(1).max(10),
	reaction: z.string().min(1).max(4),
	second_line: z.string().min(2).max(12),
	callout_top: z.string().min(2).max(22),
	callout_bottom: z.string().min(2).max(18),
});

const HumanizerResponseSchema = z.object({
	title: z.string().min(1).max(100),
	thumbnail_title: z.string().min(1).max(100),
	thumbnail: HumanizedThumbnailSchema,
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
	edits: Array<{
		index: number;
		keep: boolean;
		factIds: string[];
		before: string;
		after: string;
		visualBefore: {
			headline: string;
			subheadline: string;
			stats: Array<{ label: string; detail: string }>;
		};
		visualAfter: {
			headline: string;
			subheadline: string;
			stats: Array<{ label: string; detail: string }>;
		} | null;
	}>;
	thumbnailTitle: { before: string; after: string };
	thumbnail: {
		before: FeatureDraft["thumbnail"];
		after: FeatureDraft["thumbnail"];
	};
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

function assertSpecificPackaging(title: string): void {
	const trimmedTitle = title.trim();
	const genericTopicEnding =
		/(?:売上(?:高)?|決算|株価|市場|新製品|発表|買収|値上がり|下落|ニュース)$/u;
	const hasConcreteHook =
		/\d|[?？]|(?:なぜ|どうして|どうなる|何が|どっち|それでも|なのに|ところが)/u.test(
			trimmedTitle,
		);
	if (genericTopicEnding.test(trimmedTitle) && !hasConcreteHook) {
		throw new Error("BYOSAN_HUMANIZER_GENERIC_PACKAGING_TITLE");
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

function requiredPackagedClaimIds(draft: FeatureDraft): string[] {
	const packagedIds = new Set(draft.packaging?.claimIds ?? []);
	return draft.claims.flatMap(({ id, status }) =>
		id && status === "verified" && packagedIds.has(id) ? [id] : [],
	);
}

function assertPackagedClaimsRetained(
	draft: FeatureDraft,
	usedFactIds: ReadonlySet<string>,
): void {
	const missing = requiredPackagedClaimIds(draft).filter(
		(id) => !usedFactIds.has(id),
	);
	if (missing.length > 0) {
		throw new Error(
			`BYOSAN_HUMANIZER_DROPPED_PACKAGED_FACTS: ${missing.join(",")}`,
		);
	}
}

function assertResolvedEnding(segments: Array<{ text: string }>): void {
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
	"GPU",
	"NAND",
	"NVL72",
	"QLC",
	"SSD",
	"USD",
	"VERA",
	"RUBIN",
]);

function assertNoCompanyEnumeration(
	segments: Array<{ index: number; text: string }>,
): void {
	for (const segment of segments) {
		const names = new Set(
			[...segment.text.matchAll(/\b[A-Z][A-Za-z0-9-]{2,}\b/gu)]
				.map(([token]) => token?.toUpperCase())
				.filter(
					(token): token is string =>
						token !== undefined && !NON_COMPANY_LATIN_TERMS.has(token),
				),
		);
		if (names.size >= 4) {
			throw new Error(
				`BYOSAN_HUMANIZER_COMPANY_ENUMERATION: segment=${segment.index} names=${[...names].join(",")} text=${JSON.stringify(segment.text.slice(0, 180))}`,
			);
		}
	}
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
	const claimIdsByIndex = new Map<number, string[]>();
	const assignedClaimIds = new Set<string>();
	for (const [index, segment] of draft.segments.entries()) {
		const claimIds: string[] = [];
		for (const claimId of segment.claimIds ?? []) {
			if (assignedClaimIds.has(claimId)) continue;
			assignedClaimIds.add(claimId);
			claimIds.push(claimId);
		}
		claimIdsByIndex.set(index, claimIds);
	}
	const response = invokeCreativeStructured({
		name: "byosan_interactive_humanizer",
		kind: "draft",
		schema: HumanizerResponseSchema,
		prompt: [
			"この動画を友人に話したくなる発見を一つ選びます。具体的な出来事から始め、事実の差や意外さを見せて、最後は登場人物がその場で気づいたように答えます。説明文の要約や教訓、未回答の疑問で締めません。",
			"台詞は声に出して自然な日本語にします。記事・資料の紹介、制作メモ、先生のようなまとめ、調査上の限界、一般的な免責文は公開文に書きません。『なんですね』『ということです』のように説明を言い換えて終える形も避けます。堅い用語を会話で使う言葉に直します。",
			"話は2〜3セグメントにまとめ、各台詞は会話の役目を持たせます。出来事を出す、意外な点を見せる、具体的な規模を添える、の中から必要なものだけを使います。同じ事実を繰り返さず、最後は目の前の事実への自然なひと言で終えます。",
			"titleとthumbnailは、確認済み事実の中で最も目を引く対比や変化を短く伝えます。会社名と一般的な話題名だけの見出しは避けます。数字はverified claimの表記を使い、増加率を倍率に計算し直しません。複数の日付が出る話では、同じ日に起きたようにまとめません。市場予想との比較が確認できない場合は『好決算』『上振れ』と評価しません。description_leadは動画の内容を一文で紹介し、description_bulletsは最大3点。出典名、調査手順、限界や言い訳を公開文に足しません。",
			"入力と同じindexのセグメントを一つずつ返してください。packagingに含まれるverified claimは、会話の中にすべて一度ずつ残します。fact_idsにはその枠のclaim_idsだけを指定し、同じIDを繰り返しません。削る枠はkeep=false、fact_idsは空配列です。数値カードは必要な項目だけ残し、元のstat_valuesのindexをsource_indexとして指定し、順番を保ちます。",
			"新しい数字や因果関係を足さず、話者、順序、図、出典、検証用claimを変えません。説明欄に出典リンク以外の注釈や制作上の言い訳を足しません。",
			`[VERIFIED_CORE_FACTS]\n${JSON.stringify(humanizerClaimFacts(draft))}`,
			`[SEGMENT_SLOTS_AND_EVIDENCE]\n${JSON.stringify(
				draft.segments.map((segment, index) => ({
					index,
					speaker: segment.speaker,
					claim_ids: claimIdsByIndex.get(index) ?? [],
					stat_values: segment.stats.map(({ value }, statIndex) => ({
						index: statIndex,
						value,
					})),
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
	const verifiedFactIds = new Set(
		humanizerClaimFacts(draft).map(({ id }) => id),
	);
	const allowedFactIdsByIndex = new Map(
		draft.segments.map((_, index) => [
			index,
			new Set(claimIdsByIndex.get(index) ?? []),
		]),
	);
	const usedFactIds = new Set<string>();
	for (const edit of response.value.segments) {
		if (!edit.keep) {
			if (edit.fact_ids.length > 0) {
				throw new Error(
					`BYOSAN_HUMANIZER_REMOVED_FACT_IDS: segment=${edit.index} ids=${edit.fact_ids.join(",")}`,
				);
			}
			continue;
		}
		if (edit.fact_ids.length === 0) {
			throw new Error(
				`BYOSAN_HUMANIZER_FACT_IDS_REQUIRED: segment=${edit.index}`,
			);
		}
		const allowedFactIds = allowedFactIdsByIndex.get(edit.index);
		for (const factId of edit.fact_ids) {
			if (!verifiedFactIds.has(factId) || !allowedFactIds?.has(factId)) {
				throw new Error(
					`BYOSAN_HUMANIZER_UNASSIGNED_FACT_ID: segment=${edit.index} id=${factId}`,
				);
			}
			if (usedFactIds.has(factId)) {
				throw new Error(
					`BYOSAN_HUMANIZER_REUSED_FACT_ID: segment=${edit.index} id=${factId}`,
				);
			}
			usedFactIds.add(factId);
		}
	}
	assertPackagedClaimsRetained(draft, usedFactIds);

	const removedSegmentIndexes: number[] = [];
	const editLog = draft.segments.map((segment, index) => {
		const edit = editsByIndex.get(index);
		if (!edit) throw new Error(`BYOSAN_HUMANIZER_SEGMENT_INDEX: ${index}`);
		const visualAfter = edit.keep
			? {
					headline: edit.headline.trim(),
					subheadline: edit.subheadline.trim(),
					stats: edit.stats.map(({ label, detail }) => ({
						label: label.trim(),
						detail: detail.trim(),
					})),
				}
			: null;
		return {
			index,
			keep: edit.keep,
			factIds: edit.fact_ids,
			before: segment.text,
			after: edit.keep ? edit.text.trim() : "",
			visualBefore: {
				headline: segment.headline,
				subheadline: segment.subheadline,
				stats: segment.stats.map(({ label, detail }) => ({ label, detail })),
			},
			visualAfter,
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
		if (!edit.headline.trim() || !edit.subheadline.trim()) {
			throw new Error(`BYOSAN_HUMANIZER_EMPTY_VISUAL_COPY: segment=${index}`);
		}
		if (segment.stats.length > 0 && edit.stats.length === 0) {
			throw new Error(`BYOSAN_HUMANIZER_STATS_REQUIRED: segment=${index}`);
		}
		const seenStatIndexes = new Set<number>();
		let previousStatIndex = -1;
		const stats = edit.stats.map((visualStat) => {
			const { source_index: statIndex } = visualStat;
			const stat = segment.stats[statIndex];
			if (!stat || seenStatIndexes.has(statIndex)) {
				throw new Error(
					`BYOSAN_HUMANIZER_STAT_INDEX: segment=${index} stat=${statIndex}`,
				);
			}
			if (statIndex <= previousStatIndex) {
				throw new Error(
					`BYOSAN_HUMANIZER_STAT_ORDER: segment=${index} stat=${statIndex}`,
				);
			}
			seenStatIndexes.add(statIndex);
			previousStatIndex = statIndex;
			assertNoNewNumbers(segment, {
				label: visualStat.label,
				detail: visualStat.detail,
			});
			return {
				...stat,
				label: visualStat.label.trim(),
				detail: visualStat.detail.trim(),
			};
		});
		return [
			{
				...segment,
				claimIds: edit.fact_ids,
				text,
				headline: edit.headline.trim(),
				subheadline: edit.subheadline.trim(),
				stats,
			},
		];
	});
	const minimumSegments = Math.min(2, draft.segments.length);
	const maximumSegments = Math.min(3, draft.segments.length);
	if (segments.length < minimumSegments) {
		throw new Error(
			`BYOSAN_HUMANIZER_TOO_FEW_SEGMENTS: source=${draft.segments.length} minimum=${minimumSegments} actual=${segments.length} kept=${JSON.stringify(segments.map(({ text }) => text.slice(0, 120)))}`,
		);
	}
	if (segments.length > maximumSegments) {
		throw new Error(
			`BYOSAN_HUMANIZER_TOO_MANY_SEGMENTS: source=${draft.segments.length} maximum=${maximumSegments} actual=${segments.length} kept=${JSON.stringify(segments.map(({ text }) => text.slice(0, 120)))}`,
		);
	}
	assertResolvedEnding(segments);
	const thumbnail = {
		eyebrow: response.value.thumbnail.eyebrow.trim(),
		lead: response.value.thumbnail.lead.trim(),
		accent: response.value.thumbnail.accent.trim(),
		reaction: response.value.thumbnail.reaction.trim(),
		secondLine: response.value.thumbnail.second_line.trim(),
		calloutTop: response.value.thumbnail.callout_top.trim(),
		calloutBottom: response.value.thumbnail.callout_bottom.trim(),
	};
	assertSpeakableLines([
		{ index: -4, text: response.value.title },
		{ index: -5, text: response.value.thumbnail_title },
		{ index: -6, text: thumbnail.eyebrow },
		{ index: -7, text: thumbnail.lead },
		{ index: -8, text: thumbnail.accent },
		{ index: -9, text: thumbnail.reaction },
		{ index: -10, text: thumbnail.secondLine },
		{ index: -11, text: thumbnail.calloutTop },
		{ index: -12, text: thumbnail.calloutBottom },
		{ index: -1, text: response.value.description_lead },
		...response.value.description_bullets.map((text, index) => ({
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
	]);
	assertSpecificPackaging(response.value.title);
	assertSpecificPackaging(response.value.thumbnail_title);
	assertNoCompanyEnumeration(
		segments.map((segment, index) => ({ index, text: segment.text })),
	);
	assertNoRepeatedNarrativeSegments(
		segments.map((segment, index) => ({ index, text: segment.text })),
	);
	// A fact can move when sections merge; compare numbers against the whole draft.
	assertNoNewNumbers(draft, {
		title: response.value.title,
		thumbnail_title: response.value.thumbnail_title,
		thumbnail,
		story_spine: response.value.story_spine,
		description_lead: response.value.description_lead,
		description_bullets: response.value.description_bullets,
		segments: segments.map(({ text, headline, subheadline, stats }) => ({
			text,
			headline,
			subheadline,
			stats: stats.map(({ label, value, detail }) => ({
				label,
				value,
				detail,
			})),
		})),
	});
	const claimedNumbers = draft.claims.map(({ claim }) =>
		claim.replaceAll("一日", "1日"),
	);
	const packagingCopy = {
		title: response.value.title,
		thumbnail_title: response.value.thumbnail_title,
		thumbnail,
	};
	assertNoNewNumbers(claimedNumbers, packagingCopy);
	const publicCopy = [
		response.value.title,
		response.value.thumbnail_title,
		...Object.values(thumbnail),
		response.value.description_lead,
		...response.value.description_bullets,
		...segments.map(({ text }) => text),
	].join(" ");
	assertNoUnsupportedEarningsPraise(draft.claims, publicCopy);
	assertNoUnclaimedMultiple(draft.claims, publicCopy);
	assertDistinctDatesStayDistinct(draft.claims, draft.angle, publicCopy);

	const editedDraft = ByosanFeatureDraftSchema.parse({
		...draft,
		title: response.value.title.trim(),
		thumbnailTitle: response.value.thumbnail_title.trim(),
		thumbnail,
		descriptionLead: response.value.description_lead,
		descriptionBullets: response.value.description_bullets,
		segments,
	});
	return {
		draft: editedDraft,
		storySpine: response.value.story_spine.trim(),
		removedSegmentIndexes,
		edits: editLog,
		thumbnailTitle: {
			before: draft.thumbnailTitle,
			after: response.value.thumbnail_title.trim(),
		},
		thumbnail: { before: draft.thumbnail, after: thumbnail },
		receipt: response.receipt,
	};
}
