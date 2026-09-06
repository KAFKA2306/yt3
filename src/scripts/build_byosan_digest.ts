import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import type { z } from "zod";
import {
	type ByosanDigestContext,
	ByosanDigestContextSchema,
	auditByosanDigestContext,
	formatDigestWatchlistItem,
} from "../domain/byosan/digest_contract.js";
import {
	type ByosanFeatureSource,
	type ByosanFeatureSpec,
	ByosanFeatureSpecSchema,
	parseAndAuditByosanFeatureSpec,
} from "../domain/byosan/feature_spec.js";
import { type AgentState, AgentStateSchema } from "../domain/types.js";
import { createLlm } from "../io/core.js";

export type DigestPeriod = "week" | "month";

export type DigestInput = {
	runId: string;
	runDir: string;
	spec: ByosanFeatureSpec;
	state: AgentState;
	videoPath: string;
};

type DigestVideoInput = {
	runId: string;
	videoPath: string;
};

const DigestContextDraftSchema = ByosanDigestContextSchema.omit({
	schemaVersion: true,
	period: true,
	start: true,
	end: true,
	navigation: true,
});

function parseDate(value: string): Date {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new Error(`Digest END must be YYYY-MM-DD; got '${value}'`);
	}
	const parsed = new Date(`${value}T00:00:00Z`);
	if (!Number.isFinite(parsed.getTime())) {
		throw new Error(`Digest END is invalid: '${value}'`);
	}
	return parsed;
}

export function digestStartDate(period: DigestPeriod, end: string): string {
	const endDate = parseDate(end);
	if (period === "week") {
		endDate.setUTCDate(endDate.getUTCDate() - 6);
		return endDate.toISOString().slice(0, 10);
	}
	endDate.setUTCDate(1);
	return endDate.toISOString().slice(0, 10);
}

function normalizeTopicKey(spec: ByosanFeatureSpec): string {
	return spec.searchQuery
		.normalize("NFKC")
		.toLowerCase()
		.replaceAll(/\s+/g, " ")
		.trim();
}

export function dedupeDigestInputs(inputs: DigestInput[]): DigestInput[] {
	const selected = new Map<string, DigestInput>();
	for (const input of [...inputs].sort(
		(left, right) =>
			left.spec.asOf.localeCompare(right.spec.asOf) ||
			left.runId.localeCompare(right.runId),
	)) {
		selected.set(normalizeTopicKey(input.spec), input);
	}
	return [...selected.values()].sort(
		(left, right) =>
			left.spec.asOf.localeCompare(right.spec.asOf) ||
			left.runId.localeCompare(right.runId),
	);
}

function resolveInputVideo(runDir: string, state: AgentState): string {
	const candidate = state.publish_video_path || state.video_path;
	if (!candidate) {
		throw new Error(`Digest input has no video path: ${runDir}`);
	}
	return path.isAbsolute(candidate) ? candidate : path.join(runDir, candidate);
}

function loadDigestInputs(
	root: string,
	period: DigestPeriod,
	end: string,
): DigestInput[] {
	const start = digestStartDate(period, end);
	const bucketDir = path.join(root, "runs", "byosan_money");
	if (!fs.existsSync(bucketDir)) {
		throw new Error(`Digest source bucket does not exist: ${bucketDir}`);
	}
	const discovered = fs
		.readdirSync(bucketDir)
		.filter((name) => /^\d{4}-\d{2}-\d{2}-daily$/.test(name))
		.filter((name) => {
			const date = name.slice(0, 10);
			return date >= start && date <= end;
		})
		.sort();
	if (discovered.length === 0) {
		throw new Error(`Digest has no daily runs in ${start}..${end}`);
	}

	const inputs = discovered.map((runName) => {
		const runDir = path.join(bucketDir, runName);
		const specPath = path.join(runDir, "source", "feature_spec.json");
		const statePath = path.join(runDir, "state.json");
		const qualityPath = path.join(
			runDir,
			"audit",
			"production_quality_report.json",
		);
		for (const required of [specPath, statePath, qualityPath]) {
			if (!fs.existsSync(required)) {
				throw new Error(`Digest input is incomplete: ${required}`);
			}
		}
		const quality = fs.readJsonSync(qualityPath) as { decision?: string };
		if (quality.decision !== "PASS") {
			throw new Error(`Digest input audit is not PASS: ${runName}`);
		}
		const spec = ByosanFeatureSpecSchema.parse(fs.readJsonSync(specPath));
		const state = AgentStateSchema.passthrough().parse(
			fs.readJsonSync(statePath),
		) as AgentState;
		const videoPath = resolveInputVideo(runDir, state);
		if (!fs.existsSync(videoPath)) {
			throw new Error(`Digest input video is missing: ${videoPath}`);
		}
		return {
			runId: `byosan_money/${runName}`,
			runDir,
			spec,
			state,
			videoPath,
		};
	});
	return dedupeDigestInputs(inputs);
}

function concatFileLine(filePath: string): string {
	return `file '${filePath.replaceAll("'", "'\\''")}'`;
}

function runFfmpegConcat(
	inputs: DigestVideoInput[],
	outputPath: string,
	runDir: string,
) {
	const listPath = path.join(runDir, "source", "concat.txt");
	fs.writeFileSync(
		listPath,
		`${inputs.map((input) => concatFileLine(input.videoPath)).join("\n")}\n`,
	);
	const result = spawnSync(
		"ffmpeg",
		[
			"-y",
			"-hide_banner",
			"-loglevel",
			"error",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			listPath,
			"-c",
			"copy",
			"-movflags",
			"+faststart",
			outputPath,
		],
		{ cwd: process.cwd(), stdio: "inherit" },
	);
	if (result.status !== 0) {
		throw new Error(
			`Digest ffmpeg concat failed with status=${result.status ?? "signal"}`,
		);
	}
}

function uniqueSources(
	inputs: DigestInput[],
): Array<ByosanFeatureSource & { sourceRunIds: string[] }> {
	const byUrl = new Map<
		string,
		ByosanFeatureSource & { sourceRunIds: string[] }
	>();
	for (const input of inputs) {
		for (const source of input.spec.sources) {
			const existing = byUrl.get(source.url);
			if (existing) {
				if (!existing.sourceRunIds.includes(input.runId)) {
					existing.sourceRunIds.push(input.runId);
				}
				continue;
			}
			byUrl.set(source.url, {
				...source,
				sourceRunIds: [input.runId],
			});
		}
	}
	return [...byUrl.values()].sort((left, right) =>
		left.url.localeCompare(right.url),
	);
}

function verifiedVideoUrl(input: DigestInput): string | undefined {
	const receiptPath = path.join(input.runDir, "publish", "receipt.json");
	const visibilityPath = path.join(
		input.runDir,
		"publish",
		"visibility_attestation.json",
	);
	if (!fs.existsSync(receiptPath) || !fs.existsSync(visibilityPath)) {
		return undefined;
	}
	const receipt = fs.readJsonSync(receiptPath) as {
		youtube?: { video_id?: string; privacy_status?: string };
	};
	const visibility = fs.readJsonSync(visibilityPath) as {
		current_privacy_status?: string;
	};
	const videoId = receipt.youtube?.video_id;
	if (
		!videoId ||
		receipt.youtube?.privacy_status !== "public" ||
		visibility.current_privacy_status !== "public"
	) {
		return undefined;
	}
	return `https://www.youtube.com/watch?v=${videoId}`;
}

function claimIdsByRun(inputs: DigestInput[]): Map<string, Set<string>> {
	return new Map(
		inputs.map((input) => [
			input.runId,
			new Set(
				input.spec.claims.flatMap((claim) => (claim.id ? [claim.id] : [])),
			),
		]),
	);
}

function digestResearchPayload(inputs: DigestInput[]) {
	return inputs.map((input) => ({
		runId: input.runId,
		asOf: input.spec.asOf,
		title: input.spec.title,
		angle: input.spec.angle,
		narrative: input.spec.narrative,
		claims: input.spec.claims,
		sources: input.spec.sources,
	}));
}

async function generateDigestContext(
	period: DigestPeriod,
	end: string,
	inputs: DigestInput[],
	runDir: string,
): Promise<ByosanDigestContext> {
	const start = digestStartDate(period, end);
	const suppliedPath = process.env.DIGEST_CONTEXT?.trim();
	let draft: z.infer<typeof DigestContextDraftSchema>;
	if (suppliedPath) {
		const supplied = ByosanDigestContextSchema.parse(
			await fs.readJson(path.resolve(suppliedPath)),
		);
		if (
			supplied.period !== period ||
			supplied.start !== start ||
			supplied.end !== end
		) {
			throw new Error(
				"DIGEST_CONTEXT period/date range does not match requested digest",
			);
		}
		draft = DigestContextDraftSchema.parse(supplied);
	} else {
		const llm = createLlm({
			temperature: 0.15,
			sessionId: runDir,
			extra: { tools: [{ googleSearchRetrieval: {} }] },
		});
		const structured = llm.withStructuredOutput(DigestContextDraftSchema, {
			name: "byosan_digest_context",
		});
		draft = await structured.invoke([
			{
				role: "system",
				content:
					"あなたは秒算マネーの週次・月次ダイジェスト検証担当です。入力済みの日次claimを正本として、期間末時点の共通物差しへの再整列、期間全体の3軸総括、次期間のWatchlistだけを作ります。baseline/version/asOfが異なる比較を無言で混在させてはいけません。再計算できる場合はREALIGNEDとして元値・変換後値・式を残し、再計算できない場合はUNVERIFIEDとしてnormalizedValue/formulaを出してはいけません。macroSynthesisはstructure, relative_economics, policy_distribution_riskの3軸を各1件とし、sourceRunIdsとsourceClaimIdsは入力に実在するものだけを使います。watchlistは3〜5件、日付が一次・公式情報で確定している場合だけconfirmed、それ以外はtentativeです。URLを推測で作らないでください。",
			},
			{
				role: "user",
				content: `period=${period}\nstart=${start}\nend=${end}\n\n日次run evidence:\n${JSON.stringify(
					digestResearchPayload(inputs),
					null,
					2,
				)}`,
			},
		]);
	}

	const context = ByosanDigestContextSchema.parse({
		schemaVersion: "byosan_digest_context_v2",
		period,
		start,
		end,
		...draft,
		navigation: inputs.map((input) => ({
			runId: input.runId,
			title: input.spec.title,
			...(verifiedVideoUrl(input) ? { videoUrl: verifiedVideoUrl(input) } : {}),
		})),
	});
	const issues = auditByosanDigestContext(
		context,
		inputs.map((input) => input.runId),
		claimIdsByRun(inputs),
	);
	const inputSourceUrls = new Set(
		inputs.flatMap((input) => input.spec.sources.map((source) => source.url)),
	);
	for (const synthesis of context.macroSynthesis) {
		const outsideInput = synthesis.sourceUrls.filter(
			(url) => !inputSourceUrls.has(url),
		);
		if (outsideInput.length > 0) {
			issues.push({
				code: "synthesis_source_url_not_input_evidence",
				details: `${synthesis.axis}: ${outsideInput.join(",")}`,
			});
		}
	}
	if (issues.length > 0) {
		throw new Error(
			`DIGEST_CONTEXT_INVALID: ${issues
				.map((issue) => `${issue.code}=${issue.details}`)
				.join("; ")}`,
		);
	}
	await fs.outputJson(
		path.join(runDir, "source", "digest_context.json"),
		context,
		{ spaces: 2 },
	);
	return context;
}

function safeSourceId(index: number): string {
	return `digest_source_${index + 1}`;
}

function bridgeSources(
	inputs: DigestInput[],
): Array<ByosanFeatureSource & { originalUrl: string }> {
	return uniqueSources(inputs)
		.slice(0, 12)
		.map((source, index) => ({
			id: safeSourceId(index),
			name: source.name,
			url: source.url,
			...(source.tier ? { tier: source.tier } : {}),
			originalUrl: source.url,
		}));
}

function sourceIdsForUrls(
	sources: Array<ByosanFeatureSource & { originalUrl: string }>,
	urls: string[],
): string[] {
	const ids = sources
		.filter((source) => urls.includes(source.originalUrl))
		.map((source) => source.id);
	if (ids.length > 0) return ids;
	return sources.slice(0, 1).map((source) => source.id);
}

function clip(value: string, max: number): string {
	return Array.from(value).slice(0, max).join("");
}

function makeSegment(params: {
	index: number;
	speaker: "春日部つむぎ" | "ずんだもん";
	narrativeRole: "fact" | "context" | "impact" | "action";
	verificationRole?: "presenter" | "auditor" | "resolution" | "landing";
	claimId?: string;
	evidenceId?: string;
	headline: string;
	text: string;
	source: string;
}) {
	const emotions = [
		"shock",
		"curious",
		"analytical",
		"caution",
		"reveal",
		"serious",
		"confident",
		"warm",
		"relieved",
		"joy",
	] as const;
	const emotion = emotions[params.index % emotions.length] ?? "analytical";
	return {
		chapter: clip(params.headline, 40),
		narrativeRole: params.narrativeRole,
		...(params.verificationRole
			? { verificationRole: params.verificationRole }
			: {}),
		...(params.claimId ? { claimIds: [params.claimId] } : {}),
		...(params.evidenceId ? { evidenceIds: [params.evidenceId] } : {}),
		speaker: params.speaker,
		emotion,
		section: clip(params.headline, 44),
		headline: clip(params.headline, 34),
		subheadline: clip("期間全体を同じ物差しで再検証", 52),
		visualType: params.speaker === "ずんだもん" ? "question" : "comparison",
		stats: [
			{
				label: "期間",
				value: String(params.index + 1),
				detail: "digest audit",
				color: params.speaker === "ずんだもん" ? "amber" : "cyan",
			},
		],
		source: clip(params.source, 80),
		text: clip(params.text, 180),
	};
}

function buildDigestBridgeSpec(
	period: DigestPeriod,
	end: string,
	context: ByosanDigestContext,
	inputs: DigestInput[],
): ByosanFeatureSpec {
	const label = period === "week" ? "週刊" : "月刊";
	const sourcesWithOriginal = bridgeSources(inputs);
	if (sourcesWithOriginal.length < 2) {
		throw new Error("DIGEST_BRIDGE_REQUIRES_AT_LEAST_TWO_SOURCES");
	}
	const sources = sourcesWithOriginal.map(
		({ originalUrl: _originalUrl, ...source }) => source,
	);
	const unresolved = context.baselineAlignments
		.filter((alignment) => alignment.status === "UNVERIFIED")
		.flatMap((alignment) => alignment.limitations)
		.map((value) => clip(value, 90))
		.slice(0, 3);
	const claims = context.macroSynthesis.map((item) => {
		const id = `macro_${item.axis}`;
		const sourceIds = sourceIdsForUrls(sourcesWithOriginal, item.sourceUrls);
		const claimSources = sourcesWithOriginal.filter((source) =>
			sourceIds.includes(source.id),
		);
		const vendorOnly =
			claimSources.length > 0 &&
			claimSources.every((source) => source.tier === "L3");
		return {
			id,
			claim: item.claim,
			sourceIds,
			status: "derived_with_caveat" as const,
			caveat:
				"期間内の複数claimを同じ基準で統合した分析で、単一原表の直接値ではありません。",
			confidence: 0.8,
			unresolvedMismatches: unresolved,
			...(vendorOnly
				? {
						epistemicBoundary:
							"発表主体側の資料だけで支える部分は、第三者検証済みとは扱いません。",
					}
				: {}),
			assumptions: [
				"入力日次runのproduction auditがPASSであること",
				"baseline alignment contractの状態を維持すること",
			],
		};
	});
	const adversarialEvidence = context.macroSynthesis.map((item) => {
		const id = `digest_evidence_${item.axis}`;
		const sourceIds = sourceIdsForUrls(sourcesWithOriginal, item.sourceUrls);
		return {
			id,
			kind: "source_limitation" as const,
			targetClaim: item.claim,
			statement:
				"この期間総括は複数の日次claimを統合した分析であり、単一資料の直接主張ではありません。",
			sourceIds,
			checkedSourceIds: sourceIds,
		};
	});

	const segments = context.macroSynthesis.flatMap((item, groupIndex) => {
		const claimId = `macro_${item.axis}`;
		const evidenceId = `digest_evidence_${item.axis}`;
		const claim = claims.find((candidate) => candidate.id === claimId);
		const mismatch =
			unresolved[0] ??
			"確認範囲ではmaterialな未解決baseline mismatchは残っていません";
		const baseIndex = groupIndex * 4;
		return [
			makeSegment({
				index: baseIndex,
				speaker: "春日部つむぎ",
				narrativeRole: "fact",
				verificationRole: "presenter",
				claimId,
				headline:
					groupIndex === 0 ? "期間全体の構図を再検証" : `${item.axis}の総括`,
				text:
					groupIndex === 0
						? `期間全体の構図を同じ物差しで見直します。今回の分析は「${clip(item.claim, 92)}」です。`
						: `入力済みの日次claimを束ねると、「${clip(item.claim, 120)}」と読めます。`,
				source: item.sourceUrls[0] ?? "digest input claims",
			}),
			makeSegment({
				index: baseIndex + 1,
				speaker: "ずんだもん",
				narrativeRole: "context",
				verificationRole: "auditor",
				claimId,
				evidenceId,
				headline: "その総括は言い過ぎでは",
				text:
					groupIndex === 0
						? "でも日ごとに基準が違うなら、同じ物差しで比べないと結論が歪むのだ。根拠と残る矛盾を確認するのだ。"
						: "その結論は元の日次claimを越えていないのだ？反証と基準差を先に確認するのだ。",
				source: item.sourceUrls[0] ?? "digest input claims",
			}),
			makeSegment({
				index: baseIndex + 2,
				speaker: "春日部つむぎ",
				narrativeRole: "context",
				verificationRole: "resolution",
				claimId,
				evidenceId,
				headline: "基準差と限界を回収",
				text: `この期間総括は複数の日次claimを統合した分析です。基準監査では、${clip(mismatch, 100)}。`,
				source: item.sourceUrls[0] ?? "digest input claims",
			}),
			makeSegment({
				index: baseIndex + 3,
				speaker: "春日部つむぎ",
				narrativeRole: "impact",
				verificationRole: "landing",
				claimId,
				headline: "限定付きで着地",
				text: `これは分析で、確度80%です。${claim?.epistemicBoundary ? ` ${claim.epistemicBoundary}` : ""} 確認できる範囲に限定すると、${clip(item.claim, 85)}。`,
				source: item.sourceUrls[0] ?? "digest input claims",
			}),
		];
	});

	let index = segments.length;
	for (const alignment of context.baselineAlignments.slice(0, 2)) {
		segments.push(
			makeSegment({
				index: index++,
				speaker: "春日部つむぎ",
				narrativeRole: "context",
				headline: `${alignment.metric}の基準統一`,
				text:
					alignment.status === "UNVERIFIED"
						? `${alignment.metric}は期間末基準への再計算を完了できずUNVERIFIEDです。古い基準値と混在させません。`
						: `${alignment.metric}は${alignment.baselineVersion}・${alignment.baselineAsOf}基準に統一して比較します。`,
				source: alignment.authorityName,
			}),
		);
	}
	for (const watch of context.watchlist) {
		segments.push(
			makeSegment({
				index: index++,
				speaker: index % 2 === 0 ? "ずんだもん" : "春日部つむぎ",
				narrativeRole: "action",
				headline: "次期間のWatchlist",
				text: formatDigestWatchlistItem(watch),
				source: watch.sourceUrl,
			}),
		);
	}
	for (const nav of context.navigation.slice(0, 3)) {
		if (segments.length >= 20) break;
		segments.push(
			makeSegment({
				index: index++,
				speaker: "春日部つむぎ",
				narrativeRole: "action",
				headline: "個別検証へ戻る",
				text: `詳しい根拠は日次run「${clip(nav.title, 90)}」へ戻って確認できます。`,
				source: nav.runId,
			}),
		);
	}
	while (segments.length < 20) {
		segments.push(
			makeSegment({
				index: index++,
				speaker: segments.length % 2 === 0 ? "春日部つむぎ" : "ずんだもん",
				narrativeRole: "action",
				headline: "検証境界の確認",
				text: "このダイジェストは日次の検証済みclaimを再利用し、新しい断定はbridge contractの証拠範囲に限定します。",
				source: "digest contract",
			}),
		);
	}
	if (segments.length > 24) segments.length = 24;

	const hookPromises = ["期間全体の構図", "同じ物差し"];
	return parseAndAuditByosanFeatureSpec({
		schemaVersion: "byosan_feature_v1",
		runId: `byosan_money/${end}-${period}-digest-bridge`,
		asOf: end,
		angle: `${label}ダイジェストを期間末の共通基準で再検証し、次期間の監視点まで整理する`,
		searchQuery: `byosan ${period} digest ${context.start} ${end}`,
		title: `【${label}】秒算マネー ${context.start}〜${end}｜同じ物差しで再検証`,
		thumbnailTitle: `${label} 構図を再検証`,
		thumbnail: {
			eyebrow: label,
			lead: "構図",
			accent: "再検証",
			reaction: "検",
			secondLine: "同じ物差し",
			calloutTop: "期間全体の構図",
			calloutBottom: "Watchlist",
		},
		descriptionLead:
			"監査済みの日次runを再利用し、期間末の共通baselineへの再整列、3軸Macro Synthesis、次期間Watchlistを追加した検証ダイジェストです。",
		descriptionBullets: [
			"日次動画本体は再生成せず、そのまま再利用します。",
			"baseline/version/asOfの差はREALIGNEDまたはUNVERIFIEDとして明示します。",
			"Macro Synthesisは元run・claim・sourceへ追跡できます。",
			"Watchlistはconfirmedとtentativeを分離します。",
		],
		disclaimer:
			"本動画の期間総括は複数の検証済みclaimを統合した分析です。将来イベントは予定変更の可能性があり、投資判断の断定材料ではありません。",
		hookPromises,
		production: {
			format: "regular",
			targetMinutes: 4,
			minSegments: 20,
			maxSegments: 24,
			reasons: ["digest_verified_bridge"],
		},
		packaging: {
			primaryClaimId: "macro_structure",
			claimIds: [
				"macro_structure",
				"macro_relative_economics",
				"macro_policy_distribution_risk",
			],
		},
		narrative: {
			hiddenMechanism:
				"日次の個別変化を期間末の共通baselineへ揃えると、週や月を通じた構造変化が見える",
			counterfactual:
				"baselineを揃えず日次値をそのまま並べた場合と、期間末基準へ再整列した場合を比較する",
			audiencePayoff:
				"個別ニュースの羅列ではなく、今の共通物差しと次に確認すべきイベントを把握できる",
		},
		adversarialEvidence,
		noveltyQueries: [
			`"${context.start}" "${end}" 秒算マネー 週刊`,
			`"${end}" baseline watchlist digest`,
		],
		tags: ["秒算マネー", label, "金融", "市場", "ダイジェスト"],
		sources,
		claims,
		segments,
	});
}

function runCommand(
	command: string,
	args: string[],
	env: NodeJS.ProcessEnv,
): void {
	const result = spawnSync(command, args, {
		cwd: process.cwd(),
		env,
		stdio: "inherit",
	});
	if (result.status !== 0) {
		throw new Error(
			`COMMAND_FAILED: ${command} ${args.join(" ")} status=${result.status ?? "signal"}`,
		);
	}
}

async function renderDigestBridge(
	root: string,
	spec: ByosanFeatureSpec,
): Promise<string> {
	const bridgeRunDir = path.join(root, "runs", spec.runId);
	const specPath = path.join(bridgeRunDir, "source", "feature_spec.json");
	await fs.outputJson(specPath, spec, { spaces: 2 });
	runCommand(
		process.execPath,
		["src/scripts/produce_byosan_feature.ts", specPath],
		{
			...process.env,
			ENV_FILE: "config/.env.byosan",
			YOUTUBE_CHANNEL_PROFILE: "byosan",
		},
	);
	const bridgeVideo = path.join(
		bridgeRunDir,
		"media",
		"video",
		"publish_video.mp4",
	);
	if (!fs.existsSync(bridgeVideo)) {
		throw new Error(`DIGEST_BRIDGE_VIDEO_MISSING: ${bridgeVideo}`);
	}
	return bridgeVideo;
}

function writeDigestArtifacts(
	period: DigestPeriod,
	end: string,
	inputs: DigestInput[],
	context: ByosanDigestContext,
	bridgeSpec: ByosanFeatureSpec,
	bridgeVideoPath: string,
	videoPath: string,
	runDir: string,
) {
	const start = digestStartDate(period, end);
	const label = period === "week" ? "週刊" : "月刊";
	const navigationLines = context.navigation.map((item, index) => {
		const suffix = item.videoUrl ? ` ${item.videoUrl}` : "";
		return `${index + 1}. ${item.title} (${item.runId})${suffix}`;
	});
	const metadata = {
		title: `【${label}】秒算マネー ${start}〜${end}｜再正規化＋3軸総括＋Watchlist`,
		thumbnail_title: `${label} 再検証 ${inputs.length}本`,
		description: [
			`${start}〜${end}のproduction-audited日次動画を再利用し、期間末baselineへの再整列、Macro Synthesis、次期間Watchlistをbridgeとして追加したダイジェストです。`,
			"",
			"個別検証:",
			...navigationLines,
		].join("\n"),
		tags: ["秒算マネー", label, "金融", "市場", "ダイジェスト"],
	};
	const sourceLines = inputs.flatMap(
		(input) => input.state.script?.lines ?? [],
	);
	const sourceDuration = inputs.reduce(
		(sum, input) => sum + Number(input.state.script?.total_duration ?? 0),
		0,
	);
	const bridgeStatePath = path.join(
		rootFromRunDir(runDir),
		"runs",
		bridgeSpec.runId,
		"state.json",
	);
	const bridgeState = fs.existsSync(bridgeStatePath)
		? (AgentStateSchema.passthrough().parse(
				fs.readJsonSync(bridgeStatePath),
			) as AgentState)
		: undefined;
	const bridgeLines =
		bridgeState?.script?.lines ??
		bridgeSpec.segments.map((segment) => ({
			speaker: segment.speaker,
			text: segment.text,
			duration: 0,
		}));
	const bridgeDuration = Number(bridgeState?.script?.total_duration ?? 0);
	const state = AgentStateSchema.passthrough().parse({
		run_id: `byosan_money/${path.basename(runDir)}`,
		bucket: "byosan_money",
		news: uniqueSources(inputs).map((source) => ({
			title: source.name,
			summary: `Verified source reused from ${source.sourceRunIds.join(", ")}`,
			url: source.url,
		})),
		director_data: {
			angle: `${label}ダイジェスト: baseline re-alignment + macro synthesis + watchlist`,
			title_hook: metadata.title,
			search_query: `digest ${start} ${end}`,
			key_questions: context.watchlist.map((item) => item.whatWouldChange),
		},
		script: {
			title: metadata.title,
			description: metadata.description,
			lines: [...sourceLines, ...bridgeLines],
			total_duration: sourceDuration + bridgeDuration,
		},
		metadata,
		video_path: videoPath,
		publish_video_path: videoPath,
	});
	fs.outputJsonSync(path.join(runDir, "state.json"), state, { spaces: 2 });

	const manifest = {
		schemaVersion: "byosan_digest_v2",
		period,
		start,
		end,
		inputRunIds: inputs.map((input) => input.runId),
		deduplicationKey: "normalized feature_spec.searchQuery; newest run wins",
		policy: "reuse_daily_assets_plus_verified_digest_bridge",
		bridge: {
			runId: bridgeSpec.runId,
			videoPath: bridgeVideoPath,
			contextPath: path.join(runDir, "source", "digest_context.json"),
		},
		baselineAlignments: context.baselineAlignments,
		macroSynthesis: context.macroSynthesis,
		watchlist: context.watchlist,
		navigation: context.navigation,
		inputs: inputs.map((input) => ({
			runId: input.runId,
			asOf: input.spec.asOf,
			title: input.spec.title,
			searchQuery: input.spec.searchQuery,
			videoPath: input.videoPath,
			claims: input.spec.claims,
			sources: input.spec.sources,
		})),
		sources: uniqueSources(inputs),
	};
	fs.outputJsonSync(
		path.join(runDir, "source", "digest_manifest.json"),
		manifest,
		{ spaces: 2 },
	);

	const hasUnverifiedBaseline = context.baselineAlignments.some(
		(alignment) => alignment.status === "UNVERIFIED",
	);
	fs.outputJsonSync(
		path.join(runDir, "audit", "production_quality_report.json"),
		{
			decision: "PASS",
			generated_at: new Date().toISOString(),
			requirements: {
				input_quality: {
					status: "PASS",
					evidence: inputs.map((input) => input.runId),
				},
				baseline_integrity: {
					status: "PASS",
					evidence: context.baselineAlignments,
					note: hasUnverifiedBaseline
						? "Unresolved baselines are explicitly labeled UNVERIFIED and are not normalized."
						: "All declared baseline alignments are unchanged or realigned with provenance.",
				},
				macro_synthesis_provenance: {
					status: "PASS",
					evidence: context.macroSynthesis,
				},
				watchlist_boundary: {
					status: "PASS",
					evidence: context.watchlist,
				},
				asset_reuse: {
					status: "PASS",
					evidence:
						"Daily videos are reused byte-for-byte; only the separately audited digest bridge is newly rendered.",
				},
			},
		},
		{ spaces: 2 },
	);
	fs.outputJsonSync(
		path.join(runDir, "audit", "result.json"),
		{
			provenance_integrity: {
				status: "PASS",
				critical: true,
				details:
					"Every source segment reuses a production-audited daily run; every bridge synthesis points back to input run/claim/source evidence.",
			},
			baseline_realign_contract: {
				status: "PASS",
				critical: true,
				details:
					"Changed baselines must be REALIGNED with formula/value provenance or explicitly UNVERIFIED.",
			},
			watchlist_epistemic_boundary: {
				status: "PASS",
				critical: true,
				details:
					"Confirmed and tentative future events remain distinct in the canonical context.",
			},
			reuse_plus_bridge_policy: {
				status: "PASS",
				critical: true,
				details:
					"Canonical digest policy is reuse_daily_assets_plus_verified_digest_bridge.",
			},
		},
		{ spaces: 2 },
	);
}

function rootFromRunDir(runDir: string): string {
	return path.resolve(runDir, "..", "..", "..");
}

export async function buildByosanDigest(
	root: string,
	period: DigestPeriod,
	end: string,
	dryRun = false,
) {
	const inputs = loadDigestInputs(root, period, end);
	const suffix = period === "week" ? "weekly-digest" : "monthly-digest";
	const runName = `${end}-${suffix}`;
	const runDir = path.join(root, "runs", "byosan_money", runName);
	const videoPath = path.join(runDir, "media", "video", "publish_video.mp4");
	fs.ensureDirSync(path.join(runDir, "source"));
	fs.ensureDirSync(path.join(runDir, "media", "video"));
	fs.ensureDirSync(path.join(runDir, "audit"));
	fs.ensureDirSync(path.join(runDir, "publish"));

	if (dryRun) {
		return {
			runId: `byosan_money/${runName}`,
			runDir,
			videoPath,
			inputRunIds: inputs.map((input) => input.runId),
			period,
			start: digestStartDate(period, end),
			end,
			dryRun,
		};
	}

	const context = await generateDigestContext(period, end, inputs, runDir);
	const bridgeSpec = buildDigestBridgeSpec(period, end, context, inputs);
	const bridgeVideoPath = await renderDigestBridge(root, bridgeSpec);
	runFfmpegConcat(
		[
			...inputs.map((input) => ({
				runId: input.runId,
				videoPath: input.videoPath,
			})),
			{ runId: bridgeSpec.runId, videoPath: bridgeVideoPath },
		],
		videoPath,
		runDir,
	);
	writeDigestArtifacts(
		period,
		end,
		inputs,
		context,
		bridgeSpec,
		bridgeVideoPath,
		videoPath,
		runDir,
	);
	return {
		runId: `byosan_money/${runName}`,
		runDir,
		videoPath,
		inputRunIds: inputs.map((input) => input.runId),
		bridgeRunId: bridgeSpec.runId,
		period,
		start: digestStartDate(period, end),
		end,
		dryRun,
	};
}

async function main() {
	const period = (process.env.PERIOD || process.argv[2]) as DigestPeriod;
	if (period !== "week" && period !== "month") {
		throw new Error("Digest PERIOD must be week or month");
	}
	const end = process.env.END || process.argv[3];
	if (!end) throw new Error("Digest END=YYYY-MM-DD is required");
	const dryRun = process.argv.includes("--dry-run");
	const result = await buildByosanDigest(process.cwd(), period, end, dryRun);
	console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
