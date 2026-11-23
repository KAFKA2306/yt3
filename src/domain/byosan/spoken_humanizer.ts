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
	[/(?:その一方で|一方で)/u, "written_transition_in_public_copy"],
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
		/(?:AI供給網|好決算.{0,12}見えない動きがあります|まず目を引くのは|AIを支える部材や製造工程|追加の生産量を目指す時期|増産が形になるのは|供給を広げる動きは|先の計画だけではありません|次に見えてくるのは|供給網の姿)/u,
		"abstract_or_template_phrase_in_narration",
	],
	[
		/(?:確認できる事実から|記事本文に.{0,20}(?:ない|記載)|数字の意味を検証|資料に.{0,16}(?:ない|記載)|AI需要続く[?？])/u,
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
	const response = invokeCreativeStructured({
		name: "byosan_interactive_humanizer",
		kind: "draft",
		schema: HumanizerResponseSchema,
		prompt: [
			"検証済みの事実から、視聴者が見終わったあと人に説明できる発見を一つ作ります。記事の要約ではなく、友人に話すような自然な日本語で、具体的な出来事から入り、最後はその発見を一文で伝えてください。",
			"書き言葉を読み上げる調子を避けます。『記事によると』『資料では』『構成対象』『今回見えたのは』のような報告書や制作メモの言葉、調査上の限界、一般的な免責文は公開台詞に出しません。会社や製品を主語にして、普段の会話で使う言葉と日本語として耳慣れた金額表記を選びます。",
			"話の中心に必要な事実だけを選びます。具体的な出来事で始め、違いが伝わる事実を見せ、最後に何が分かるのかを一文で言います。数字を足すためだけの締めや、同じ内容の言い直しは要りません。話は2〜3セグメントにまとめます。",
			"titleは企業名と具体的な変化を中心に短くします。headline、subheadline、stats、thumbnailも、見た瞬間に意味が伝わる短い言葉にします。description_leadは短い紹介文、description_bulletsは視聴者が得る内容を最大3点で書きます。出典名、調査手順、限界の列挙は公開文に含めません。",
			"入力と同じindexのセグメントを一つずつ返してください。残す台詞には、その枠のclaim_idsから今回使うfact_idsだけを入れ、同じclaim IDは全体で一度だけ使います。削る枠はkeep=false、fact_idsは空配列です。数値カードは必要な項目だけ残し、元のstat_valuesのindexをsource_indexとして指定し、順番を保ちます。",
			"新しい数字や因果関係を足さず、話者、順序、図、出典、検証用claimを変えません。説明欄に出典リンク以外の注釈や制作上の言い訳を足しません。",
			`[VERIFIED_CORE_FACTS]\n${JSON.stringify(humanizerClaimFacts(draft))}`,
			`[SEGMENT_SLOTS_AND_EVIDENCE]\n${JSON.stringify(
				draft.segments.map((segment, index) => ({
					index,
					speaker: segment.speaker,
					claim_ids: segment.claimIds ?? [],
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
		draft.segments.map((segment, index) => [
			index,
			new Set(segment.claimIds ?? []),
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
