import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { type ResearchResult, TrendScout } from "../domain/agents/research.js";
import {
	ByosanFeatureDraftSchema,
	type ByosanFeatureSource,
	type ByosanFeatureSpec,
	parseAndAuditByosanFeatureSpec,
} from "../domain/byosan/feature_spec.js";
import type { ByosanAngleCandidate } from "../domain/byosan/news_angle.js";
import { AssetStore, ROOT, createLlm, getRunIdDateString } from "../io/core.js";

type FeatureSource = ByosanFeatureSource;

export type PublishedRunEvidence = {
	runId: string;
	verified: boolean;
	reason: string;
	videoId?: string;
};

function safeSourceId(raw: string, index: number): string {
	const normalized = raw
		.normalize("NFKD")
		.replaceAll(/[^a-zA-Z0-9_-]+/g, "_")
		.replaceAll(/^_+|_+$/g, "")
		.slice(0, 48);
	return normalized || `source_${index + 1}`;
}

function normalizedSources(candidate: ByosanAngleCandidate): FeatureSource[] {
	const seen = new Set<string>();
	return candidate.sources.map((source, index) => {
		let id = safeSourceId(source.id, index);
		while (seen.has(id)) id = `${id}_${index + 1}`;
		seen.add(id);
		return { id, name: source.name, url: source.url };
	});
}

export function findPublishedByosanRunForDate(
	root: string,
	date: string,
): PublishedRunEvidence | null {
	const bucketDir = path.join(root, "runs", "byosan_money");
	if (!fs.existsSync(bucketDir)) return null;
	for (const runName of fs
		.readdirSync(bucketDir)
		.filter((name) => name.startsWith(date))
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

function selectedCandidate(research: ResearchResult): ByosanAngleCandidate {
	const decision = research.angle_decision;
	if (
		!decision ||
		decision.decision !== "PASS" ||
		decision.selectedIndex === null
	) {
		throw new Error(
			"BYOSAN_ANGLE_STOP: research has no passing angle decision",
		);
	}
	const candidate = decision.evaluated[decision.selectedIndex]?.candidate;
	if (!candidate) {
		throw new Error("BYOSAN_ANGLE_STOP: selected candidate is missing");
	}
	return candidate;
}

async function generateFeatureSpec(
	research: ResearchResult,
	candidate: ByosanAngleCandidate,
	sources: FeatureSource[],
	runDir: string,
	runId: string,
	date: string,
): Promise<ByosanFeatureSpec> {
	const llm = createLlm({
		temperature: 0.28,
		sessionId: runDir,
	});
	const structured = llm.withStructuredOutput(ByosanFeatureDraftSchema, {
		name: "byosan_feature_draft",
	});
	const evidence = {
		candidate,
		allowed_sources: sources,
		news: research.news,
	};
	let lastError: unknown;
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			const draft = await structured.invoke([
				{
					role: "system",
					content:
						"あなたは秒算マネーの編集長です。与えられた証拠だけで5〜7分の対話型金融動画を設計します。出典にない数字や断定を作らないでください。推計はderived_with_caveatまたはanalyst_estimate_not_company_non_gaapとし、条件を台本と説明欄へ入れます。冒頭2シーンでhookPromisesをすべて文字列一致で回収します。20〜32シーン、7種類以上のemotion、春日部つむぎとずんだもんの対話、各シーン1〜3個の短いstatsを使います。画面は中心固定で、左右揺れを前提にしたvisualPlanを書かないでください。claimsのsourceIdsにはallowed_sourcesのidだけを使ってください。毎回新しい比較単位、章構成、問いの順番を選びます。",
				},
				{
					role: "user",
					content: `対象証拠:\n${JSON.stringify(evidence, null, 2)}\n\n制約: タイトル100文字以下。thumbnailTitleとthumbnailは同じ主張を表す。hookPromisesはcandidate.numbersから2〜4個を原表記のまま選ぶ。noveltyQueriesはYouTube上の完全一致・類似角度を点検できる検索式にする。descriptionBulletsは重要な限定条件を3〜8件含める。attempt=${attempt}\n前回の検証エラー: ${lastError instanceof Error ? lastError.message : lastError ? String(lastError) : "なし"}`,
				},
			]);
			return parseAndAuditByosanFeatureSpec({
				...draft,
				schemaVersion: "byosan_feature_v1",
				runId,
				asOf: date,
				angle: candidate.angle,
				searchQuery: research.director_data.search_query,
				sources,
			});
		} catch (error) {
			lastError = error;
		}
	}
	throw new Error(
		`BYOSAN_FEATURE_GENERATION_FAILED: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
	);
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

function assertPublishEvidence(runDir: string): void {
	const report = fs.readJsonSync(
		path.join(runDir, "audit", "production_quality_report.json"),
	) as { decision?: string };
	if (report.decision !== "PASS") {
		throw new Error("PUBLISH_BLOCKED: production audit is not PASS");
	}
	const runName = path.basename(runDir);
	const evidence = findPublishedByosanRunForDate(ROOT, runName.slice(0, 10));
	if (!evidence?.verified || evidence.runId !== `byosan_money/${runName}`) {
		throw new Error(
			`PUBLISH_EVIDENCE_INCOMPLETE: ${evidence?.reason ?? "missing_receipt"}`,
		);
	}
}

async function dryRun(): Promise<void> {
	const referencePath = path.join(
		ROOT,
		"config",
		"productions",
		"sp500_anthropic_2026q2.json",
	);
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

export async function runByosanDaily(): Promise<void> {
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
	const existing = findPublishedByosanRunForDate(ROOT, date);
	if (existing) {
		if (!existing.verified) {
			throw new Error(
				`DUPLICATE_PUBLISH_BLOCKED: ${existing.runId} ${existing.reason}`,
			);
		}
		console.log(
			`ALREADY_PUBLISHED=${existing.runId} VIDEO_ID=${existing.videoId ?? "unknown"}`,
		);
		return;
	}

	const runId = `byosan_money/${date}-daily`;
	const store = new AssetStore(runId);
	const missionPath = path.join(store.runDir, "source", "no-mission-file.md");
	const scout = new TrendScout(store);
	const research = await scout.run("byosan_money", 5, missionPath);
	await fs.outputJson(
		path.join(store.runDir, "source", "research_result.json"),
		research,
		{
			spaces: 2,
		},
	);
	const candidate = selectedCandidate(research);
	const sources = normalizedSources(candidate);
	const spec = await generateFeatureSpec(
		research,
		candidate,
		sources,
		store.runDir,
		runId,
		date,
	);
	const specPath = path.join(store.runDir, "source", "feature_spec.json");
	await fs.outputJson(specPath, spec, { spaces: 2 });
	await fs.outputJson(
		path.join(store.runDir, "audit", "loop_manifest.json"),
		{
			execution_layer: "agent loop",
			validation_layer: "closed-loop agent workflow",
			improvement_layer: "agent improvement loop / harness design",
			angle_decision: research.angle_decision,
			feature_spec: specPath,
			motion_policy: "center_locked_no_lateral_oscillation",
			generated_at: new Date().toISOString(),
		},
		{ spaces: 2 },
	);

	runCommand(
		process.execPath,
		["src/scripts/produce_byosan_feature.ts", specPath],
		{
			...process.env,
			ENV_FILE: "config/.env.byosan",
			YOUTUBE_CHANNEL_PROFILE: "byosan",
		},
	);
	if (process.env.BYOSAN_DAILY_NO_PUBLISH === "true") {
		console.log(`PRODUCTION_PASS_NO_PUBLISH=${runId}`);
		return;
	}
	runCommand(process.execPath, ["src/scripts/publish_latest_movie.ts", runId], {
		...process.env,
		ENV_FILE: "config/.env.byosan",
		YOUTUBE_CHANNEL_PROFILE: "byosan",
		RUN_ID: runId,
	});
	assertPublishEvidence(store.runDir);
	console.log(`BYOSAN_DAILY_PASS=${runId}`);
}

if (import.meta.main) {
	runByosanDaily().catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		const failureDate = process.env.BYOSAN_DATE?.trim() || getRunIdDateString();
		const failureRunDir = path.join(
			ROOT,
			"runs",
			"byosan_money",
			`${failureDate}-daily`,
		);
		if (fs.existsSync(failureRunDir)) {
			fs.outputJsonSync(
				path.join(failureRunDir, "audit", "failure_trace.json"),
				{
					symptom: message,
					evidence: error instanceof Error ? error.stack : String(error),
					root_cause: "pending_trace_review",
					harness_change:
						"convert the failure into a regression test before retry",
					regression_test: "pending",
					failed_at: new Date().toISOString(),
				},
				{ spaces: 2 },
			);
		}
		console.error(
			error instanceof Error ? (error.stack ?? error.message) : error,
		);
		process.exit(1);
	});
}
