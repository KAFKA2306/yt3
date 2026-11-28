import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { syncRunIsolated } from "../domain/audio_syndication.js";
import {
	buildCanonicalAudit,
	hostOf,
} from "../domain/byosan/canonical_audit.js";
import {
	reconcileByosanCheckpoint,
	writeByosanCheckpoint,
} from "../domain/byosan/checkpoint.js";
import {
	type ByosanFailureClassification,
	byosanFailureClassification,
	failureSignalLines,
	termsMatch,
} from "../domain/byosan/codex_llm.js";
import {
	type Explanation,
	ExplanationSchema,
} from "../domain/byosan/explanation.js";
import { auditFeatureSpecAgainstExplanation } from "../domain/byosan/explanation_contract.js";
import {
	assertFactSheetRunSuffix,
	assertFactSheetUnpublished,
	factSheetHosts,
	factSheetPathFromEnv,
	loadFactSheet,
	writeFactSheetResearch,
} from "../domain/byosan/fact_sheet.js";
import {
	buildFeatureSpecInput,
	DraftArticlesSchema,
	type FeatureDraftInput,
	featureDraftIssues,
	inputSourceText,
	isJson,
	normalizeFeatureDraft,
	prepareFeatureDraftInput,
	renderFeatureDraftInput,
	summarizeFeatureIssues,
} from "../domain/byosan/feature_draft.js";
import {
	ByosanFeatureDraftSchema,
	type ByosanFeatureSpec,
	parseAndAuditByosanFeatureSpec,
} from "../domain/byosan/feature_spec.js";
import {
	type DiscoveryConfig,
	loadDiscoveryBaseline,
	writeDiscoveryEvidence,
} from "../domain/byosan/feed_discovery.js";
import { byosanFontconfigEnv } from "../domain/byosan/fonts.js";
import {
	loadPublishedByosanSourceUrls,
	normalizedSourceUrl,
} from "../domain/byosan/published_sources.js";
import {
	assertNoSourceNames,
	assertSpeakableLines,
	humanizeByosanDraft,
} from "../domain/byosan/spoken_humanizer.js";
import {
	TitleFitSchema,
	TitleProposalSchema,
	TitleReviewSchema,
	titleFitPrompt,
	titleOnlyPrompt,
	titleProposalPrompt,
} from "../domain/creative_authoring.js";
import {
	AssetStore,
	getRunIdDateString,
	loadConfig,
	ROOT,
} from "../io/core.js";
import { invokeCreativeStructured } from "../io/creative.js";

type DailyConfig = {
	discovery: DiscoveryConfig & { repeat_window_days: number };
	feature_draft: { system: string };
};

const StorySelectionSchema = z.object({
	angle: z.string().min(1).max(220),
	article_urls: z.array(z.string().url()).min(1).max(3),
	hook: z.string().min(1).max(120),
	answer: z.string().min(1).max(180),
	early_clue: z.string().min(1).max(140),
	payoff: z.string().min(1).max(180),
	beats: z.array(z.string().min(1).max(180)).min(2).max(4),
});

type StorySelection = z.infer<typeof StorySelectionSchema>;

export function byosanCandidateSlugKey(url: string): string | null {
	try {
		const parsed = new URL(url);
		const slug = parsed.pathname
			.split("/")
			.filter(Boolean)
			.at(-1)
			?.toLowerCase()
			.replace(/[^a-z0-9]/gu, "");
		return slug ? `${parsed.origin}/${slug}` : null;
	} catch {
		return null;
	}
}

export function selectionContainsSourceMismatch(
	selection: StorySelection,
): boolean {
	const publicPlan = [
		selection.angle,
		selection.hook,
		selection.answer,
		selection.early_clue,
		selection.payoff,
		...selection.beats,
	].join(" ");
	return /(?:記事|本文|原文|出典|比較文|同じ指標).{0,80}(?:食い違|矛盾|二通り|不整合|誤記|誤植|異なる数値|違う数値)|(?:食い違|矛盾|二通り|不整合|誤記|誤植|異なる数値|違う数値).{0,80}(?:記事|本文|原文|出典|比較文|同じ指標)/u.test(
		publicPlan,
	);
}

export function hasConflictingCurrentGrowthRates(
	article: Pick<FeatureDraftInput["today"][number], "body">,
): boolean {
	const current = /has increased to\s+([\d.]+)%\s+today/iu.exec(article.body);
	const comparison =
		/blended earnings growth rate for the other 493 S&P 500 companies for Q3 2026\s+\(([\d.]+)%\)/iu.exec(
			article.body,
		);
	return Boolean(current && comparison && current[1] !== comparison[1]);
}

function isDryCalendarPreview(
	article: FeatureDraftInput["today"][number],
): boolean {
	return /(?:economic week ahead|week ahead|projected to rise|予定|スケジュール|週間見通し|来週の予定|calendar)/iu.test(
		article.title,
	);
}

export function selectByosanStoryAngle(input: FeatureDraftInput): {
	selection: StorySelection;
	selectedInput: FeatureDraftInput;
} {
	const candidates = [...input.today, ...input.baseline];
	const coherent = candidates.filter(
		(article) => !hasConflictingCurrentGrowthRates(article),
	);
	if (candidates.length > 0 && coherent.length === 0) {
		throw new Error("BYOSAN_NO_COHERENT_STORY_CANDIDATE");
	}
	const substantive = coherent.filter(
		(article) => !isDryCalendarPreview(article),
	);
	const pool = substantive.length > 0 ? substantive : coherent;
	const allowed = new Map(
		pool.flatMap((article) => {
			const key = normalizedSourceUrl(article.url);
			return key === null ? [] : [[key, article] as const];
		}),
	);
	const allowedBySlug = new Map<string, FeatureDraftInput["today"]>();
	for (const article of pool) {
		const key = byosanCandidateSlugKey(article.url);
		if (!key) continue;
		const matches = allowedBySlug.get(key) ?? [];
		matches.push(article);
		allowedBySlug.set(key, matches);
	}
	const requestSelection = (
		selectionPool: FeatureDraftInput["today"],
		rejectedAngle = "",
	): StorySelection =>
		invokeCreativeStructured({
			name: "byosan_story_selection",
			kind: "title",
			schema: StorySelectionSchema,
			prompt: [
				"あなたは秒算マネーの企画編集者です。記事一覧から、最も視聴者の頭に残る一つの構造的な発見を選びます。",
				"候補に驚くべき結果の逆転、需給の詰まり、評価と利益の乖離、意外な歴史的な仕組みが一つでもあれば、それを選びます。記事内の数字の誤記や矛盾、出典上の不整合そのものを動画の題材にしません。そうした候補は退け、数字と仕組みが一貫した別の逆説を選びます。雇用予測、経済カレンダー、来週の予定、一般的な発表記事は、実質的な逆説が候補にある日は必ず退けます。最新公開時刻を価値の基準にしません。",
				"まず同じ市場・期間・母集団で直接比べられる事実の逆転を探します。マグニフィセント7の利益成長率が他の493社を下回る一方で指数全体の利益成長が上向く、または利益予想が強いのに株価評価が落ちるような比較は、候補にあれば優先します。PJMの肩季に電力価格が跳ねるような、数字で確認できる供給制約も優先候補です。異なる市場の記事を一つに束ねるのは、記事が共通の仕組みを明示している場合に限ります。米国企業決算と日本の家計資金移動を、利回りやリスク選好の仮説だけで因果的につなぎません。",
				"比較に使う数字は、同じ指標・期間・定義で本文と照合します。同じ指標の数値が記事内で食い違う場合、その値を芯にした企画を選ばず、別記事の逆説を優先します。選んだangle、hook、answer、early_clue、payoff、beatsのどこにも、記事の誤記や食い違いを持ち込みません。",
				"1〜3記事を選び、共通する問いをangleにまとめます。hookは冒頭10〜15秒で見せる具体的な逆説、answerはその場で出す短い答え、early_clueは冒頭に置き終盤で意味がつながる数字または細部、payoffは最後に解ける構造、beatsは問いから答え、具体例、比喩、回収へ進む順です。候補にない数字や因果を作らず、選んだ記事URLだけを返します。",
				"angle、hook、answer、early_clue、payoff、beatsも公開脚本の設計です。記事の紹介や制作メモを入れず、注釈、否定形の予防線、言い訳、限界説明を書きません。「〜とは言えない」「〜とは限らない」「答えにならない」の形を避け、観測された数字と仕組みを短く言い切ります。事実の差を示す自然な対比は使えます。",
				"answerは記事が示す主体の判断を直接書きます。『投資家は利益予想を楽観的すぎると警戒している』のように言い切り、『実現しないかもしれない』『可能性がある』などの仮定や予防線は入れません。",
				rejectedAngle,
				input.subject ? `依頼題材: ${input.subject}` : "",
				`候補記事:\n${JSON.stringify(
					selectionPool.map(({ title, url, issuer, published, body }) => ({
						title,
						url,
						issuer,
						published,
						body: body.slice(0, 1800),
					})),
				)}`,
			]
				.filter(Boolean)
				.join("\n\n"),
		}).value;
	let selection = requestSelection(pool);
	if (selectionContainsSourceMismatch(selection)) {
		const rejectedUrls = new Set(selection.article_urls);
		const alternatePool = pool.filter(
			(article) => !rejectedUrls.has(article.url),
		);
		if (alternatePool.length === 0) {
			throw new Error("BYOSAN_STORY_SELECTION_ONLY_SOURCE_MISMATCH");
		}
		selection = requestSelection(
			alternatePool,
			`棄却した題材: ${selection.angle}。出典の数値不一致を動画の題材にしません。候補記事から、事実と仕組みが一貫した別の逆説を選んでください。`,
		);
		if (selectionContainsSourceMismatch(selection)) {
			throw new Error("BYOSAN_STORY_SELECTION_SOURCE_MISMATCH_REPEATED");
		}
	}
	const selectedByUrl = new Map<string, FeatureDraftInput["today"][number]>();
	const unknownUrls: string[] = [];
	for (const requestedUrl of selection.article_urls) {
		let article: FeatureDraftInput["today"][number] | undefined;
		try {
			const exactKey = normalizedSourceUrl(requestedUrl);
			if (exactKey) article = allowed.get(exactKey);
		} catch {
			article = undefined;
		}
		if (!article) {
			const slugKey = byosanCandidateSlugKey(requestedUrl);
			const matches = slugKey ? (allowedBySlug.get(slugKey) ?? []) : [];
			if (matches.length === 1) article = matches[0];
		}
		if (!article) {
			unknownUrls.push(requestedUrl);
			continue;
		}
		selectedByUrl.set(article.url, article);
	}
	if (unknownUrls.length > 0) {
		throw new Error(
			`BYOSAN_STORY_SELECTION_UNKNOWN_SOURCE: ${unknownUrls.join(",")}`,
		);
	}
	const selectedArticles = [...selectedByUrl.values()];
	selection = {
		...selection,
		article_urls: selectedArticles.map((article) => article.url),
	};
	const storyLines = [
		{ index: -1, text: selection.angle },
		{ index: -2, text: selection.hook },
		{ index: -3, text: selection.answer },
		{ index: -4, text: selection.early_clue },
		{ index: -5, text: selection.payoff },
		...selection.beats.map((text, index) => ({ index, text })),
	];
	assertSpeakableLines(storyLines);
	assertNoSourceNames(
		storyLines,
		selectedArticles.map(({ issuer }) => issuer),
	);
	const today = selectedArticles.filter((article) =>
		input.today.some((candidate) => candidate.url === article.url),
	);
	if (today.length === 0) {
		throw new Error("BYOSAN_STORY_SELECTION_REQUIRES_CURRENT_ARTICLE");
	}
	return {
		selection,
		selectedInput: {
			...input,
			today,
			baseline: selectedArticles.filter((article) =>
				input.baseline.some((candidate) => candidate.url === article.url),
			),
			subject: input.subject ?? selection.angle,
		},
	};
}

const dailyConfig = (): DailyConfig =>
	loadConfig("byosan_money") as unknown as DailyConfig;

type PublishedRunEvidence = {
	runId: string;
	verified: boolean;
	reason: string;
	videoId?: string;
};

export type ByosanFailureClass =
	| "INFRA_DEPENDENCY"
	| "NETWORK_AUTH"
	| "PROVIDER_RATE_LIMIT"
	| "RESEARCH_ANGLE_STOP"
	| "PUBLISH_REMOTE"
	| "UNCERTAIN_REMOTE_COMMIT"
	| "PIPELINE_FAILURE";

type ByosanFailureStage = "RESEARCH" | "SPEC" | "MEDIA" | "PUBLISH" | "UNKNOWN";

export type ByosanFailureTrace = {
	schema_version: "byosan_failure_trace_v1";
	status: "OPEN" | "RECOVERED";
	failure_class: ByosanFailureClass;
	stage: ByosanFailureStage;
	failed_gate: ByosanFailureStage;
	command?: string;
	symptom: string;
	evidence: string;
	fingerprint: string;
	failed_commit: string;
	exit_status?: number;
	failed_at: string;
	first_failed_at: string;
	recovered_at?: string;
};

export function failureTracePath(runDir: string): string {
	return path.join(runDir, "audit", "failure_trace.json");
}

function currentGitHead(): string {
	const result = spawnSync("git", ["rev-parse", "HEAD"], {
		cwd: ROOT,
		encoding: "utf8",
	});
	if (result.status !== 0) return "UNVERIFIED";
	return result.stdout.trim() || "UNVERIFIED";
}

function failureStage(message: string): ByosanFailureStage {
	if (/DUPLICATE_PUBLISH|PUBLISH_|publish_youtube/i.test(message))
		return "PUBLISH";
	if (
		/produce_byosan_feature|VOICEVOX|TTS|audio|ffmpeg|motion|zoompan|subtitle/i.test(
			message,
		)
	) {
		return "MEDIA";
	}
	if (/BYOSAN_FEATURE|feature spec|schema|zod|structured/i.test(message))
		return "SPEC";
	if (/BYOSAN_ANGLE|research/i.test(message)) return "RESEARCH";
	return "UNKNOWN";
}

export function classifyByosanFailure(
	rawMessage: string,
	classification: ByosanFailureClassification = byosanFailureClassification(),
): {
	failureClass: ByosanFailureClass;
	stage: ByosanFailureStage;
} {
	const stage = failureStage(rawMessage);
	const message = failureSignalLines(
		rawMessage,
		classification.mcp_noise_terms,
	).join("\n");
	if (/BYOSAN_ANGLE_STOP/.test(message)) {
		return { failureClass: "RESEARCH_ANGLE_STOP", stage: "RESEARCH" };
	}
	if (
		/COMMAND_FAILED: .*publish_youtube|DUPLICATE_PUBLISH_BLOCKED|PUBLISH_EVIDENCE_INCOMPLETE/i.test(
			message,
		)
	) {
		return { failureClass: "UNCERTAIN_REMOTE_COMMIT", stage: "PUBLISH" };
	}
	if (termsMatch(message, classification.rate_limit_terms)) {
		return { failureClass: "PROVIDER_RATE_LIMIT", stage };
	}
	if (termsMatch(message, classification.auth_terms)) {
		return { failureClass: "NETWORK_AUTH", stage };
	}
	if (/PUBLISH_|\byoutube\b/i.test(message)) {
		return { failureClass: "PUBLISH_REMOTE", stage: "PUBLISH" };
	}
	if (
		/permission|EACCES|EPERM|not found|module|dependency|ffmpeg|ffprobe/i.test(
			message,
		)
	) {
		return { failureClass: "INFRA_DEPENDENCY", stage };
	}
	return { failureClass: "PIPELINE_FAILURE", stage };
}

function failureFingerprint(
	failureClass: ByosanFailureClass,
	stage: ByosanFailureStage,
	message: string,
): string {
	const canonicalMessage = message.split("\n", 1)[0]?.trim() || message.trim();
	return createHash("sha256")
		.update(`${failureClass}\n${stage}\n${canonicalMessage}`)
		.digest("hex");
}

function readFailureTrace(runDir: string): ByosanFailureTrace | null {
	const tracePath = failureTracePath(runDir);
	if (!fs.existsSync(tracePath)) return null;
	try {
		const trace = fs.readJsonSync(tracePath) as ByosanFailureTrace;
		if (
			trace.schema_version !== "byosan_failure_trace_v1" ||
			!trace.fingerprint ||
			!trace.failure_class
		) {
			throw new Error("invalid failure trace schema");
		}
		return trace;
	} catch (error) {
		throw new Error(
			`FAILURE_TRACE_UNREADABLE: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export function assertByosanRetryAllowed(runDir: string): void {
	const trace = readFailureTrace(runDir);
	if (
		trace?.status === "OPEN" &&
		trace.failure_class === "UNCERTAIN_REMOTE_COMMIT"
	) {
		throw new Error(
			`RETRY_BLOCKED_REMOTE_READBACK_REQUIRED: ${trace.failure_class} ${trace.fingerprint}`,
		);
	}
}

export function recordByosanFailure(
	runDir: string,
	error: unknown,
	failedCommit = currentGitHead(),
): ByosanFailureTrace {
	const message = error instanceof Error ? error.message : String(error);
	const evidence =
		error instanceof Error ? (error.stack ?? error.message) : String(error);
	const classification = classifyByosanFailure(message);
	const fingerprint = failureFingerprint(
		classification.failureClass,
		classification.stage,
		message,
	);
	const previous = fs.existsSync(failureTracePath(runDir))
		? readFailureTrace(runDir)
		: null;
	const commandMatch = message.match(
		/COMMAND_FAILED:\s+(.+?)\s+status=(\d+|signal)/,
	);
	const now = new Date().toISOString();
	const sameFailure = previous?.fingerprint === fingerprint;
	const trace: ByosanFailureTrace = {
		schema_version: "byosan_failure_trace_v1",
		status: "OPEN",
		failure_class: classification.failureClass,
		stage: classification.stage,
		failed_gate: classification.stage,
		...(commandMatch?.[1] ? { command: commandMatch[1] } : {}),
		...(commandMatch?.[2] && commandMatch[2] !== "signal"
			? { exit_status: Number(commandMatch[2]) }
			: {}),
		symptom: message,
		evidence,
		fingerprint,
		failed_commit: failedCommit,
		failed_at: now,
		first_failed_at: sameFailure ? previous.first_failed_at : now,
	};
	fs.outputJsonSync(failureTracePath(runDir), trace, { spaces: 2 });
	return trace;
}

function markFailureRecovered(runDir: string): void {
	const trace = readFailureTrace(runDir);
	if (!trace || trace.status === "RECOVERED") return;
	fs.outputJsonSync(
		failureTracePath(runDir),
		{
			...trace,
			status: "RECOVERED",
			recovered_at: new Date().toISOString(),
		},
		{ spaces: 2 },
	);
}

export function findPublishedByosanRunForDate(
	root: string,
	wanted: string,
): PublishedRunEvidence | null {
	const bucketDir = path.join(root, "runs", "byosan_money");
	if (!fs.existsSync(bucketDir)) return null;
	for (const runName of fs
		.readdirSync(bucketDir)
		.filter((name) => name === wanted)
		.sort()
		.reverse()) {
		const publishDir = path.join(bucketDir, runName, "publish");
		const receiptPath = path.join(publishDir, "receipt.json");
		if (!fs.existsSync(receiptPath)) continue;
		try {
			const receipt = fs.readJsonSync(receiptPath) as {
				youtube?: {
					status?: string;
					video_id?: string;
					channel_id?: string;
					privacy_status?: string;
				};
			};
			const visibilityPath = path.join(
				publishDir,
				"visibility_attestation.json",
			);
			const thumbnailPath = path.join(publishDir, "thumbnail_attestation.json");
			const visibility = fs.existsSync(visibilityPath)
				? (fs.readJsonSync(visibilityPath) as {
						current_privacy_status?: string;
						channel_id?: string;
					})
				: undefined;
			const thumbnail = fs.existsSync(thumbnailPath)
				? (fs.readJsonSync(thumbnailPath) as { api_update_status?: string })
				: undefined;
			const youtube = receipt.youtube;
			const uploaded =
				youtube?.status === "uploaded" && Boolean(youtube.video_id);
			const verified =
				uploaded &&
				youtube?.channel_id === "UCYtjO-PYBfdG3MuPLXfhA-Q" &&
				youtube?.privacy_status === "public" &&
				visibility?.current_privacy_status === "public" &&
				visibility.channel_id === "UCYtjO-PYBfdG3MuPLXfhA-Q" &&
				thumbnail?.api_update_status === "succeeded";
			return {
				runId: `byosan_money/${runName}`,
				verified,
				reason: verified
					? "receipt_visibility_thumbnail_verified"
					: "upload_receipt_exists_but_attestation_is_incomplete",
				videoId: youtube?.video_id,
			};
		} catch {
			return {
				runId: `byosan_money/${runName}`,
				verified: false,
				reason: "publish_receipt_is_unreadable",
			};
		}
	}
	return null;
}

export function generateFeatureSpec(
	input: FeatureDraftInput,
	runDir: string,
): {
	spec: ByosanFeatureSpec;
	explanation: Explanation;
	selectedInput: FeatureDraftInput;
	storySelection: StorySelection;
} {
	const system = dailyConfig().feature_draft.system;
	const { selection: storySelection, selectedInput } =
		selectByosanStoryAngle(input);
	const articles = renderFeatureDraftInput(selectedInput);
	const lane = input.subject ? "deep_dive_feature" : "daily_selected_news";
	const titleRules =
		"視聴者が知りたい問いと意外な答えを短く結ぶ。対比か変化を一つ選び、具体的な数字・固有名詞を使う。数字と名称は選定記事本文で明記されたものだけを使います。採用した物語設計のangle・hook・answerを企画の芯として保ち、別の数字や逆説へすり替えません。挨拶、ニュース名の羅列、注釈、言い訳、予防線、免責、説明的な副題を入れず、実際の本文の魅力を約束する。売買推奨や爆益・暴落確定の煽りは書かない。";
	const titleProposal = invokeCreativeStructured({
		name: "byosan_title_proposal",
		kind: "title",
		schema: TitleProposalSchema,
		prompt: titleProposalPrompt({
			brand: "秒算マネー",
			rules: titleRules,
			context: {
				lane,
				subject: input.subject ?? null,
				story: storySelection,
				today: selectedInput.today.map(({ title, issuer, published }) => ({
					title,
					issuer,
					published,
				})),
				baseline: selectedInput.baseline.map(
					({ title, issuer, published }) => ({
						title,
						issuer,
						published,
					}),
				),
			},
		}),
	});
	const titleReview = invokeCreativeStructured({
		name: "byosan_title_review",
		kind: "title",
		schema: TitleReviewSchema,
		prompt: titleOnlyPrompt({
			brand: "秒算マネー",
			title: titleProposal.value.title,
			rules: titleRules,
		}),
	});
	const authored = invokeCreativeStructured({
		name: "byosan_feature_draft",
		kind: "draft",
		schema: z.unknown(),
		jsonSchema: ByosanFeatureDraftSchema,
		prompt: [
			system,
			`採用タイトル: ${titleProposal.value.title}`,
			`本文前のタイトル批評: ${JSON.stringify(titleReview.value)}`,
			`採用した物語の設計: ${JSON.stringify(storySelection)}`,
			"titleと物語の中心は選定済みのangle・hook・answerに合わせ、別の数字や逆説へすり替えません。最初の台詞はhookの逆説と答えから始め、2〜4回の問いと即答で数字・具体例を積み、比喩で仕組みを見せてearly_clueをpayoffに回収します。出典名はsourcesに置き、本文は発表主体と事実を自然な文で言い切ります。推計と実績と見通しは説明書きにせず、話の主語として正確に表します。",
			"注釈、免責、言い訳、限界、予防線、根拠の列挙はsegments、title、descriptionのどこにも書きません。「だけではありません」「そのものではない」のような否定形の補足を使わず、比較と仕組みを短く述べます。事実の差を示す自然な対比は使えます。「ことがあります」のような曖昧な可能表現や、主体のない受け身の予測を使わず、日付や数値を示した観測事実を直接述べます。descriptionLeadは発見を伝える1〜2文、descriptionBulletsは短い要点を最大3件にします。出典リンクと章は後段で追加されます。",
			"語りは秒算マネーの単独ナレーター、青山龍星の声で統一します。鋭く権威があり、落ち着いた緊張感で核心を明晰に話します。ニュース読みの硬さ、相槌、口癖、空疎な橋渡し、説明の繰り返しを削ります。",
			"公開する文言（segments[].text/headline/subheadline、descriptionLead/descriptionBullets、stats.label/detail）から、出典名、記事・資料・レポートへの言及、制作メモ、注釈、免責、言い訳を除きます。出典名はsourcesにだけ記録します。stats.detailも観測した事実を直接示し、「記事が『今週』とする週」のような出典の書きぶりを説明しません。本文は記事本文と入力済み根拠から作り、数値、対象、期間、定義、実績・推計・見通しを入力記事に合わせます。記事が支えない因果、数字、家庭への換算は加えません。explanation.figuresは数値で確認できる事実だけを記録し、valueの数字は引用文に必ず含めます。数値を含まない史実はclaimsとsegmentsで説明します。",
			articles,
		].join("\n\n"),
	});
	if (!isJson(authored.value))
		throw new Error(
			"BYOSAN_FEATURE_DRAFT_INVALID: draft must be a JSON object",
		);
	const normalized = normalizeFeatureDraft(authored.value);
	fs.outputJsonSync(
		path.join(runDir, "audit", "feature_corrections.json"),
		normalized.corrections,
		{ spaces: 2 },
	);
	let parsed = ByosanFeatureDraftSchema.parse(normalized.draft);
	const humanized = humanizeByosanDraft(parsed);
	parsed = humanized.draft;
	const titleFit = invokeCreativeStructured({
		name: "byosan_title_body_review",
		kind: "title",
		schema: TitleFitSchema,
		prompt: titleFitPrompt({
			brand: "秒算マネー",
			rules: titleRules,
			initialTitle: titleProposal.value.title,
			titleReview: titleReview.value,
			body: JSON.stringify({
				initial_title: parsed.title,
				angle: parsed.angle,
				explanation: parsed.explanation,
				claims: parsed.claims,
				segments: parsed.segments.map(({ headline, subheadline, text }) => ({
					headline,
					subheadline,
					text,
				})),
			}),
		}),
	});
	parsed = { ...parsed, title: titleFit.value.title };
	assertSpeakableLines([{ index: -4, text: parsed.title }]);
	assertNoSourceNames(
		[{ index: -4, text: parsed.title }],
		parsed.sources.map(({ name }) => name),
	);
	fs.outputJsonSync(
		path.join(runDir, "audit", "spoken_humanization.json"),
		{
			story_spine: humanized.storySpine,
			edits: humanized.edits,
			model_route: humanized.receipt,
		},
		{ spaces: 2 },
	);
	fs.outputJsonSync(
		path.join(runDir, "audit", "creative_authoring.json"),
		{
			model_routes: {
				title_proposal: titleProposal.receipt,
				title_review: titleReview.receipt,
				draft: authored.receipt,
				humanizer: humanized.receipt,
				title_fit: titleFit.receipt,
			},
			humanizer: {
				story_spine: humanized.storySpine,
			},
			title_proposal: titleProposal.value,
			title_proposal_usage: titleProposal.receipt.usage,
			title_proposal_conversation: titleProposal.receipt.conversation_id,
			title_review: titleReview.value,
			title_review_usage: titleReview.receipt.usage,
			title_review_conversation: titleReview.receipt.conversation_id,
			authoring_usage: authored.receipt.usage,
			authoring_conversation: authored.receipt.conversation_id,
			title_fit: titleFit.value,
			title_fit_usage: titleFit.receipt.usage,
			title_fit_conversation: titleFit.receipt.conversation_id,
		},
		{ spaces: 2 },
	);
	try {
		const issues = featureDraftIssues(parsed, selectedInput);
		fs.outputJsonSync(
			path.join(runDir, "audit", "feature_draft_issues.json"),
			issues,
			{ spaces: 2 },
		);
		if (issues.length > 0) {
			console.warn(
				`[byosan-feature-audit] WARN run=${input.runId} issues=${summarizeFeatureIssues(issues)}`,
			);
		}
	} catch (error) {
		recordNonBlockingAuditError(runDir, "feature_draft", error);
	}
	const spec = parseAndAuditByosanFeatureSpec(
		buildFeatureSpecInput(parsed, input),
	);
	fs.outputJsonSync(
		path.join(runDir, "audit", "story_selection.json"),
		storySelection,
		{ spaces: 2 },
	);
	return {
		spec,
		explanation: parsed.explanation,
		selectedInput,
		storySelection,
	};
}

function runCommand(
	command: string,
	args: string[],
	env: NodeJS.ProcessEnv,
): void {
	const result = spawnSync(command, args, {
		cwd: ROOT,
		env,
		stdio: "inherit",
	});
	if (result.status !== 0) {
		throw new Error(
			`COMMAND_FAILED: ${command} ${args.join(" ")} status=${result.status ?? "signal"}`,
		);
	}
}

function recordNonBlockingAuditError(
	runDir: string,
	auditName: string,
	error: unknown,
): void {
	const entry = {
		audit: auditName,
		error: error instanceof Error ? error.message : String(error),
		recorded_at: new Date().toISOString(),
	};
	console.warn(`[byosan-audit] WARN audit=${auditName} error=${entry.error}`);
	try {
		const file = path.join(runDir, "audit", "nonblocking_audit_errors.json");
		const previous = fs.existsSync(file) ? fs.readJsonSync(file) : [];
		fs.outputJsonSync(
			file,
			[...(Array.isArray(previous) ? previous : []), entry],
			{ spaces: 2 },
		);
	} catch (writeError) {
		console.warn(
			`[byosan-audit] WARN audit_error_record_failed=${writeError instanceof Error ? writeError.message : String(writeError)}`,
		);
	}
}

async function dryRun(): Promise<void> {
	const config = loadConfig("byosan_money") as unknown as {
		feature_production: { default_spec: string };
	};
	const referencePath = path.join(ROOT, config.feature_production.default_spec);
	const spec = parseAndAuditByosanFeatureSpec(await fs.readJson(referencePath));
	console.log(
		JSON.stringify(
			{
				status: "DRY_RUN_PASS",
				schema: spec.schemaVersion,
				scenes: spec.segments.length,
				sources: spec.sources.length,
				hookPromises: spec.hookPromises,
				publish: false,
			},
			null,
			2,
		),
	);
}

function byosanAllowedSourceHosts(): string[] {
	const config = loadConfig("byosan_money") as unknown as {
		discovery: { registry: string };
		source_policy: {
			power_macro_registry: string;
			tier1_sources: { url: string }[];
		};
	};
	const discovery = z
		.object({ sources: z.array(z.object({ domain: z.string().min(1) })) })
		.parse(fs.readJsonSync(path.join(ROOT, config.discovery.registry)));
	const macro = z
		.object({ sources: z.array(z.object({ url: z.string().url() })) })
		.parse(
			fs.readJsonSync(
				path.join(ROOT, config.source_policy.power_macro_registry),
			),
		);
	return [
		...discovery.sources.map((source) => source.domain),
		...macro.sources.map((source) => hostOf(source.url)),
		...config.source_policy.tier1_sources.map((source) => hostOf(source.url)),
	];
}

function writeByosanCanonicalAudit(
	runDir: string,
	spec: ByosanFeatureSpec,
	sourceText: string,
	extraAllowedHosts: string[] = [],
): void {
	const explanationPath = path.join(runDir, "source", "explanation.json");
	const explanation = ExplanationSchema.parse(fs.readJsonSync(explanationPath));
	const contractIssues = auditFeatureSpecAgainstExplanation(
		spec,
		explanation,
		sourceText,
	);
	const explanationIssues = contractIssues.map(
		(issue) => `${issue.code}:${issue.details}`,
	);
	const productionReportPath = path.join(
		runDir,
		"audit",
		"production_quality_report.json",
	);
	const productionReport = z
		.object({
			decision: z.string(),
			requirements: z.record(z.string(), z.object({ status: z.string() })),
		})
		.passthrough()
		.parse(fs.readJsonSync(productionReportPath));
	const checks = buildCanonicalAudit({
		claims: spec.claims,
		sources: spec.sources,
		explanationIssues,
		allowedHosts: [...byosanAllowedSourceHosts(), ...extraAllowedHosts],
		productionReport: {
			path: productionReportPath,
			decision: productionReport.decision,
			requirements: productionReport.requirements,
		},
		specPath: path.join(runDir, "source", "feature_spec.json"),
		explanationPath,
	});
	const failed = Object.values(checks)
		.filter((check) => check.status !== "PASS")
		.map((check) => `${check.name}: ${check.details}`);
	fs.outputJsonSync(path.join(runDir, "audit", "result.json"), checks, {
		spaces: 2,
	});
	if (failed.length > 0) {
		console.warn(
			`[byosan-canonical-audit] WARN run=${spec.runId} findings=${failed.join(" | ")}`,
		);
	}
}

async function runByosanDaily(): Promise<void> {
	if (
		process.argv.includes("--dry-run") ||
		process.env.BYOSAN_DAILY_DRY_RUN === "true"
	) {
		await dryRun();
		return;
	}
	const date = process.env.BYOSAN_DATE?.trim() || getRunIdDateString();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		throw new Error(`Invalid BYOSAN_DATE: ${date}`);
	}
	const runId = `byosan_money/${date}-daily${process.env.BYOSAN_SUFFIX ?? ""}`;
	// Validated before any run directory is created. Unset means discovery.
	const factSheetFile = factSheetPathFromEnv(process.env);
	const factSheet = factSheetFile ? loadFactSheet(factSheetFile) : undefined;
	if (factSheet) assertFactSheetRunSuffix(process.env.BYOSAN_SUFFIX);
	const store = new AssetStore(runId);
	const checkpoint = reconcileByosanCheckpoint(store.runDir, runId, ROOT);
	writeByosanCheckpoint(store.runDir, checkpoint);
	const articlesPath = path.join(
		store.runDir,
		"research",
		"discovery_articles.json",
	);
	const specPath = path.join(store.runDir, "source", "feature_spec.json");
	const explanationPath = path.join(store.runDir, "source", "explanation.json");
	assertByosanRetryAllowed(store.runDir);
	const { discovery } = dailyConfig();
	if (factSheet) {
		writeFactSheetResearch(factSheet, store.runDir);
		checkpoint.stages.research_ready = true;
		writeByosanCheckpoint(store.runDir, checkpoint);
	} else if (
		!(checkpoint.stages.research_ready && (await fs.pathExists(articlesPath)))
	) {
		await writeDiscoveryEvidence(discovery, store.runDir, new Date());
		checkpoint.stages.research_ready = true;
		writeByosanCheckpoint(store.runDir, checkpoint);
	}
	const publishedUrls = loadPublishedByosanSourceUrls(
		ROOT,
		new Date(`${date}T23:59:59Z`),
		discovery.repeat_window_days,
	);
	if (factSheet) assertFactSheetUnpublished(factSheet.sheet, publishedUrls);
	let input = prepareFeatureDraftInput({
		runId,
		asOf: date,
		today: DraftArticlesSchema.parse(await fs.readJson(articlesPath)),
		baseline: factSheet ? [] : loadDiscoveryBaseline(discovery, new Date()),
		publishedUrls,
		subject: factSheet?.sheet.subject,
	});
	let spec: ByosanFeatureSpec;
	if (checkpoint.stages.spec_ready && (await fs.pathExists(specPath))) {
		spec = parseAndAuditByosanFeatureSpec(await fs.readJson(specPath));
	} else {
		const generated = generateFeatureSpec(input, store.runDir);
		input = generated.selectedInput;
		spec = generated.spec;
		await fs.outputJson(explanationPath, generated.explanation, { spaces: 2 });
		await fs.outputJson(specPath, spec, { spaces: 2 });
		checkpoint.stages.spec_ready = true;
		writeByosanCheckpoint(store.runDir, checkpoint);
	}

	const finalVideoPath = path.join(
		store.runDir,
		"media",
		"video",
		"publish_video.mp4",
	);
	const qualityReportPath = path.join(
		store.runDir,
		"audit",
		"production_quality_report.json",
	);
	if (
		!(checkpoint.stages.media_ready && (await fs.pathExists(finalVideoPath)))
	) {
		runCommand(
			process.execPath,
			["src/scripts/produce_byosan_feature.ts", specPath],
			{
				...process.env,
				...byosanFontconfigEnv(),
				ENV_FILE: "config/.env.byosan",
				YOUTUBE_CHANNEL_PROFILE: "byosan",
			},
		);
		checkpoint.stages.media_ready = await fs.pathExists(finalVideoPath);
		try {
			const qualityReport = (await fs.readJson(qualityReportPath)) as {
				decision?: string;
			};
			checkpoint.stages.quality_pass = qualityReport.decision === "PASS";
		} catch (error) {
			checkpoint.stages.quality_pass = false;
			recordNonBlockingAuditError(store.runDir, "production_quality", error);
		}
		writeByosanCheckpoint(store.runDir, checkpoint);
	}
	try {
		runCommand(
			process.execPath,
			["src/scripts/audit_byosan_authenticity.ts", "--run", runId],
			process.env,
		);
	} catch (error) {
		recordNonBlockingAuditError(store.runDir, "authenticity", error);
	}
	try {
		writeByosanCanonicalAudit(
			store.runDir,
			spec,
			inputSourceText(input),
			factSheet ? factSheetHosts(factSheet.sheet) : [],
		);
	} catch (error) {
		recordNonBlockingAuditError(store.runDir, "canonical", error);
	}
	markFailureRecovered(store.runDir);
	await syncRunIsolated("byosan", path.basename(store.runDir));
	console.log(`PRODUCTION_PASS=${runId}`);
}

if (import.meta.main) {
	runByosanDaily().catch((error) => {
		const failureDate = process.env.BYOSAN_DATE?.trim() || getRunIdDateString();
		const failureRunDir = path.join(
			ROOT,
			"runs",
			"byosan_money",
			`${failureDate}-daily${process.env.BYOSAN_SUFFIX ?? ""}`,
		);
		const message = error instanceof Error ? error.message : String(error);
		if (
			fs.existsSync(failureRunDir) &&
			!message.startsWith("RETRY_BLOCKED_") &&
			!message.startsWith("FAILURE_TRACE_UNREADABLE")
		) {
			try {
				recordByosanFailure(failureRunDir, error);
			} catch (traceError) {
				console.error(
					traceError instanceof Error
						? (traceError.stack ?? traceError.message)
						: traceError,
				);
			}
		}
		console.error(
			error instanceof Error ? (error.stack ?? error.message) : error,
		);
		process.exit(1);
	});
}
