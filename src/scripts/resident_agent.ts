import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import {
	BENCHMARK_VERSION,
	type BenchmarkProduct,
	evaluateByosanRun,
	evaluateHumanityRun,
	evaluateYawaCrossRun,
	evaluateYawaRun,
} from "../domain/benchmark/evaluators.js";
import {
	answerHumanQuestion,
	ensureLedgers,
	executeWorkCycle,
	type ResidentStep,
	renderOwnerActionLedgerMarkdown,
	resolveHumanQuestionObsolete,
	resolveResidentPaths,
	saveQuestionLedger,
} from "../domain/resident/ledgers.js";
import {
	buildCompactAdvisoryPrompt,
	decideTokenMinimalActions,
	detectAnomaliesAndBias,
	SupervisorAdvisorySchema,
} from "../domain/resident/supervisor.js";
import { AGY_DEFAULT_MODEL, invokeAgyStructured } from "../io/agy.js";
import { ROOT } from "../io/core.js";

const BUCKET_BY_PRODUCT: Record<BenchmarkProduct, string> = {
	byosan: "byosan_money",
	yawa: "yawa_archive",
	humanity: "humanity_observatory",
};

const RUN_DIR_FILTER: Record<BenchmarkProduct, RegExp> = {
	byosan: /^\d{4}-\d{2}-\d{2}-/,
	yawa: /^yawa-\d{4}-\d{2}-\d{2}/,
	humanity: /^music-\d{4}-\d{2}-\d{2}/,
};

function currentTokyoHourSlot(): string {
	const fmt = new Intl.DateTimeFormat("sv-SE", {
		timeZone: "Asia/Tokyo",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		hour12: false,
	});
	const parts = Object.fromEntries(
		fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
	);
	return `hourly:${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00+09:00`;
}

function getGitHead(): string {
	const proc = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
		cwd: ROOT,
		encoding: "utf8",
	});
	return proc.status === 0 ? proc.stdout.trim() : "unknown";
}

function listRecentRuns(product: BenchmarkProduct, limit: number): string[] {
	const dir = path.join(ROOT, "runs", BUCKET_BY_PRODUCT[product]);
	if (!fs.existsSync(dir)) return [];
	const filter = RUN_DIR_FILTER[product];
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory() && filter.test(e.name))
		.map((e) => e.name)
		.sort()
		.reverse()
		.slice(0, limit)
		.map((name) => path.join(dir, name));
}

function queryEvolutionAnalyticsRowCount(): number {
	const dbPath = path.join(ROOT, "db", "evolution.db");
	if (!fs.existsSync(dbPath)) return 0;
	const proc = spawnSync(
		"python3",
		[
			"-c",
			"import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(c.execute('select count(*) from youtube_analytics').fetchone()[0])",
			dbPath,
		],
		{ encoding: "utf8" },
	);
	if (proc.status !== 0) return 0;
	return Number(proc.stdout.trim()) || 0;
}

function hasDiscordWebhookConfigured(): boolean {
	const envPath = path.join(ROOT, ".env");
	if (!fs.existsSync(envPath)) return false;
	const text = fs.readFileSync(envPath, "utf8");
	return /^DISCORD_WEBHOOK_URL=\S+/m.test(text);
}

function currentTokyoDate(): string {
	const fmt = new Intl.DateTimeFormat("sv-SE", {
		timeZone: "Asia/Tokyo",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
	return fmt.format(new Date());
}

function hasVerifiedRunToday(
	product: BenchmarkProduct,
	today: string,
): boolean {
	const bucketDir = path.join(ROOT, "runs", BUCKET_BY_PRODUCT[product]);
	if (!fs.existsSync(bucketDir)) return false;
	const prefix =
		product === "byosan"
			? `${today}-`
			: product === "yawa"
				? `yawa-${today}`
				: `music-${today}`;
	for (const entry of fs.readdirSync(bucketDir, { withFileTypes: true })) {
		if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
		const pubStatePath = path.join(
			bucketDir,
			entry.name,
			"publish",
			"state.json",
		);
		if (!fs.existsSync(pubStatePath)) continue;
		try {
			const state = fs.readJsonSync(pubStatePath) as { phase?: string };
			if (state.phase === "VERIFIED") return true;
		} catch {
			// ignore unreadable state
		}
	}
	return false;
}

function runTick(options?: {
	triggerOverride?: string;
	enableAdvisory?: boolean;
}) {
	const paths = resolveResidentPaths(ROOT);
	const triggerId = options?.triggerOverride ?? currentTokyoHourSlot();
	const enableAdvisory =
		options?.enableAdvisory ?? process.env.RESIDENT_ENABLE_ADVISORY === "1";
	const gitHead = getGitHead();
	const snapshotPath = path.join(paths.stateDir, "latest_health_snapshot.json");
	const advisoriesPath = path.join(paths.stateDir, "advisories.jsonl");
	const duckdbPath = path.join(
		ROOT,
		"data",
		"analytics",
		"yt3_analytics.duckdb",
	);

	const prevSnapshot = fs.existsSync(snapshotPath)
		? (fs.readJsonSync(snapshotPath) as {
				state_fingerprint?: string;
				anomaly_fingerprint?: string;
				advised_anomaly_fingerprint?: string;
				analytics_rows?: number;
			})
		: null;

	const byosanRuns = listRecentRuns("byosan", 5).map(evaluateByosanRun);
	const yawaRuns = listRecentRuns("yawa", 5).map((d) =>
		evaluateYawaRun(d, { repoRoot: ROOT }),
	);
	const humanityRuns = listRecentRuns("humanity", 5).map((d) =>
		evaluateHumanityRun(d, { repoRoot: ROOT }),
	);
	const yawaCross = evaluateYawaCrossRun(yawaRuns);
	const analyticsRows = queryEvolutionAnalyticsRowCount();

	const detected = detectAnomaliesAndBias({
		byosanRuns,
		yawaRuns,
		humanityRuns,
		yawaCrossChecks: yawaCross,
		analyticsRows,
	});
	const decision = decideTokenMinimalActions({
		previousStateFingerprint: prevSnapshot?.state_fingerprint ?? null,
		previousAnomalyFingerprint:
			prevSnapshot?.advised_anomaly_fingerprint ?? null,
		previousAnalyticsRows: prevSnapshot?.analytics_rows ?? null,
		currentStateFingerprint: detected.state_fingerprint,
		currentAnomalyFingerprint: detected.anomaly_fingerprint,
		currentAnalyticsRows: analyticsRows,
		anomalies: detected.anomalies,
		duckdbExists: fs.existsSync(duckdbPath),
	});

	const steps: ResidentStep[] = [
		{
			id: "run_channel_l1_benchmarks",
			run: () => {
				let advisedFingerprint =
					prevSnapshot?.advised_anomaly_fingerprint ?? null;
				let llmTokensUsed = 0;

				if (enableAdvisory && decision.advisory_needed) {
					const { value, receipt } = invokeAgyStructured({
						name: "resident-supervisor-advisory",
						prompt: buildCompactAdvisoryPrompt(decision.anomalies),
						schema: SupervisorAdvisorySchema,
						model: AGY_DEFAULT_MODEL,
					});
					llmTokensUsed = receipt.usage?.total_tokens ?? 0;
					advisedFingerprint = decision.anomaly_fingerprint;
					fs.ensureDirSync(path.dirname(advisoriesPath));
					fs.appendFileSync(
						advisoriesPath,
						`${JSON.stringify({
							at: new Date().toISOString(),
							trigger_id: triggerId,
							anomaly_fingerprint: decision.anomaly_fingerprint,
							model: receipt.model,
							total_tokens: llmTokensUsed,
							anomalies: decision.anomalies,
							advisory: value,
						})}\n`,
						"utf8",
					);
				}

				const snapshot = {
					captured_at: new Date().toISOString(),
					trigger_id: triggerId,
					git_head: gitHead,
					benchmark_version: BENCHMARK_VERSION,
					state_fingerprint: decision.state_fingerprint,
					anomaly_fingerprint: decision.anomaly_fingerprint,
					advised_anomaly_fingerprint: advisedFingerprint,
					analytics_rows: analyticsRows,
					llm_tokens_used: llmTokensUsed,
					anomalies_detected: decision.anomalies.length,
					anomalies: decision.anomalies,
					channels: {
						byosan: {
							evaluated: byosanRuns.length,
							pass: byosanRuns.filter((r) => r.status === "PASS").length,
							fail: byosanRuns.filter((r) => r.status === "FAIL").length,
							latest_run: byosanRuns[0]?.run_id ?? null,
							latest_status: byosanRuns[0]?.status ?? null,
						},
						yawa: {
							evaluated: yawaRuns.length,
							pass: yawaRuns.filter((r) => r.status === "PASS").length,
							fail: yawaRuns.filter((r) => r.status === "FAIL").length,
							latest_run: yawaRuns[0]?.run_id ?? null,
							latest_status: yawaRuns[0]?.status ?? null,
							cross_run_warnings: yawaCross.filter((c) => c.status === "WARN")
								.length,
						},
						humanity: {
							evaluated: humanityRuns.length,
							pass: humanityRuns.filter((r) => r.status === "PASS").length,
							fail: humanityRuns.filter((r) => r.status === "FAIL").length,
							latest_run: humanityRuns[0]?.run_id ?? null,
							latest_status: humanityRuns[0]?.status ?? null,
						},
					},
				};
				fs.ensureDirSync(path.dirname(snapshotPath));
				fs.writeJsonSync(snapshotPath, snapshot, { spaces: 2 });
				// Read back snapshot to verify persistence
				const readBack = fs.readJsonSync(snapshotPath) as {
					trigger_id?: string;
				};
				if (readBack.trigger_id !== triggerId) {
					return {
						status: "failed",
						error: "Health snapshot read-back mismatch",
					};
				}
				return { status: "verified", ref: snapshotPath };
			},
		},
		{
			id: "sync_dbt_analytics_marts",
			run: () => {
				if (!decision.dbt_needed) {
					return {
						status: "verified",
						ref: `${duckdbPath}#unchanged(rows=${analyticsRows})`,
					};
				}
				const proc = spawnSync("task", ["analytics:build"], {
					cwd: ROOT,
					encoding: "utf8",
					timeout: 120_000,
				});
				if (proc.status !== 0) {
					return {
						status: "failed",
						error: `task analytics:build exited ${proc.status}: ${(proc.stderr || proc.stdout).trim().slice(-400)}`,
					};
				}
				if (!fs.existsSync(duckdbPath)) {
					return {
						status: "failed",
						error: `dbt output DuckDB missing after build: ${duckdbPath}`,
					};
				}
				return { status: "verified", ref: duckdbPath };
			},
		},
		{
			id: "verify_youtube_analytics_api_live_data",
			run: ({ questionLedger }) => {
				const rows = queryEvolutionAnalyticsRowCount();
				if (rows > 0) {
					resolveHumanQuestionObsolete(
						questionLedger,
						"gcp:659942893881",
						"enable_youtube_analytics_api",
						`youtube_analytics now has ${rows} measured row(s)`,
					);
					return {
						status: "verified",
						ref: `sqlite:db/evolution.db#youtube_analytics(rows=${rows})`,
					};
				}
				return {
					status: "needs_human",
					question: {
						target: "gcp:659942893881",
						decision_topic: "enable_youtube_analytics_api",
						question:
							"GCP プロジェクト 659942893881 で YouTube Analytics API を有効化していただけますか？",
						respondent: "owner",
						rationale:
							"task analytics:refresh が API 未有効化（youtubeanalytics.googleapis.com disabled）で失敗しており、dbt Layer 3 実績マートの実数値が 0 件のまま UNVERIFIED になっているため。",
						alternatives_checked: [
							"db/evolution.db のスキーマ差分補完と dbt ビルド（完了済み・54/54 PASS）",
							"フィクスチャ SQLite DB による突合検証（完了済み）",
							"OAuth トークン確認（エージェントには GCP API 有効化権限なし）",
						],
						blocked_step: "verify_youtube_analytics_api_live_data",
						resume_condition:
							"GCP コンソールで youtubeanalytics.googleapis.com を有効化後、task analytics:refresh が youtube_analytics に 1 件以上書き込むこと",
					},
				};
			},
		},
		{
			id: "verify_discord_webhook_and_daily_recovery",
			run: ({ questionLedger }) => {
				// Auto-resolve obsolete standalone bot question: daily URL notifications use DISCORD_WEBHOOK_URL
				resolveHumanQuestionObsolete(
					questionLedger,
					"systemd:yt3-discord.service",
					"rotate_discord_token",
					"Daily Discord notifications use DISCORD_WEBHOOK_URL webhook; standalone bot is not required",
				);
				if (!hasDiscordWebhookConfigured()) {
					return {
						status: "failed",
						error: "DISCORD_WEBHOOK_URL is missing in repository root .env",
					};
				}
				const today = currentTokyoDate();
				const byosanVerified = hasVerifiedRunToday("byosan", today);
				const recoveryStatePath = path.join(
					paths.stateDir,
					"recovery_state.json",
				);
				const recoveryState = fs.existsSync(recoveryStatePath)
					? (fs.readJsonSync(recoveryStatePath) as Record<string, number>)
					: {};
				const byosanKey = `byosan:${today}`;
				const byosanAttempts = recoveryState[byosanKey] ?? 0;

				// Bounded auto-recovery: only on scheduled Byosan days (Mon/Wed/Fri) past 08:00 JST if 0 VERIFIED runs today
				const tokyoWeekday = new Intl.DateTimeFormat("en-US", {
					timeZone: "Asia/Tokyo",
					weekday: "short",
				}).format(new Date());
				const isByosanScheduledDay = ["Mon", "Wed", "Fri"].includes(
					tokyoWeekday,
				);
				const tokyoHour = Number(
					new Intl.DateTimeFormat("en-GB", {
						timeZone: "Asia/Tokyo",
						hour: "2-digit",
						hour12: false,
					}).format(new Date()),
				);
				if (
					isByosanScheduledDay &&
					!byosanVerified &&
					tokyoHour >= 8 &&
					byosanAttempts < 1
				) {
					recoveryState[byosanKey] = byosanAttempts + 1;
					fs.writeJsonSync(recoveryStatePath, recoveryState, { spaces: 2 });
					const proc = spawnSync("task", ["byosan:publish-daily"], {
						cwd: ROOT,
						encoding: "utf8",
						timeout: 45 * 60 * 1000,
					});
					if (proc.status !== 0) {
						return {
							status: "failed",
							error: `Auto-recovery byosan:publish-daily failed (exit ${proc.status})`,
						};
					}
					return {
						status: "verified",
						ref: `recovered:byosan:${today}`,
					};
				}
				return {
					status: "verified",
					ref: `webhook=configured,byosan_verified_today=${byosanVerified}`,
				};
			},
		},
	];

	const result = executeWorkCycle({
		paths,
		workId: "ops:yt3-resident-hourly",
		target: "yt3:all-channels",
		goal: "3チャンネルのL1ベンチマーク・dbt分析マート同期・稼働監視を自律継続し、オーナー権限が必要なブロッカーだけを質問台帳へ集約する",
		schedule: "hourly (:05 Asia/Tokyo)",
		timezone: "Asia/Tokyo",
		triggerId,
		inputVersion: gitHead,
		maxAttempts: 5,
		steps,
	});

	console.log(JSON.stringify(result, null, 2));
}

function showStatus() {
	const paths = resolveResidentPaths(ROOT);
	const { workLedger, questionLedger } = ensureLedgers(paths);
	const snapshotPath = path.join(paths.stateDir, "latest_health_snapshot.json");
	const snapshot = fs.existsSync(snapshotPath)
		? fs.readJsonSync(snapshotPath)
		: null;
	console.log(
		JSON.stringify(
			{
				work_ledger_path: paths.workLedgerPath,
				question_ledger_path: paths.questionLedgerPath,
				event_log_path: paths.eventLogPath,
				work_items: workLedger.items,
				open_questions: questionLedger.questions.filter(
					(q) => q.status === "open",
				),
				answered_questions: questionLedger.questions.filter(
					(q) => q.status === "answered",
				),
				latest_snapshot: snapshot,
			},
			null,
			2,
		),
	);
}

function showQuestions() {
	const paths = resolveResidentPaths(ROOT);
	const { questionLedger } = ensureLedgers(paths);
	if (questionLedger.questions.length === 0) {
		console.log("No questions recorded in question ledger.");
		return;
	}
	for (const q of questionLedger.questions) {
		console.log(
			`- [${q.status}] ${q.question_id} (${q.target} / ${q.decision_topic})\n  Q: ${q.question}\n  Blocked step: ${q.blocked_step}\n  Resume when: ${q.resume_condition}`,
		);
	}
}

function recordAnswer(
	questionId: string,
	answerRef: string,
	answerSummary: string,
) {
	const paths = resolveResidentPaths(ROOT);
	const { questionLedger } = ensureLedgers(paths);
	const updated = answerHumanQuestion(
		questionLedger,
		questionId,
		answerRef,
		answerSummary,
	);
	saveQuestionLedger(paths, questionLedger);
	console.log(JSON.stringify(updated, null, 2));
}

function main() {
	const [cmd, ...rest] = process.argv.slice(2);
	if (cmd === "tick") {
		const triggerArg = rest
			.find((a) => a.startsWith("--trigger="))
			?.slice("--trigger=".length);
		const enableAdvisory = rest.includes("--advisory")
			? true
			: rest.includes("--no-advisory")
				? false
				: undefined;
		runTick({ triggerOverride: triggerArg, enableAdvisory });
		return;
	}
	if (cmd === "advisories") {
		const paths = resolveResidentPaths(ROOT);
		const advisoriesPath = path.join(paths.stateDir, "advisories.jsonl");
		if (!fs.existsSync(advisoriesPath)) {
			console.log("No supervisor advisories recorded yet.");
			return;
		}
		const lines = fs
			.readFileSync(advisoriesPath, "utf8")
			.trim()
			.split(/\r?\n/)
			.filter(Boolean)
			.slice(-5);
		for (const line of lines) console.log(line);
		return;
	}
	if (cmd === "status") {
		showStatus();
		return;
	}
	if (cmd === "questions") {
		showQuestions();
		return;
	}
	if (cmd === "ledger") {
		const paths = resolveResidentPaths(ROOT);
		const { questionLedger } = ensureLedgers(paths);
		console.log(renderOwnerActionLedgerMarkdown(questionLedger));
		console.log(
			"\nCanonical Vault Ledger: docs/standard/owner-action-ledger.md",
		);
		return;
	}
	if (cmd === "answer") {
		const [questionId, answerRef, ...summaryParts] = rest;
		if (!questionId || !answerRef || summaryParts.length === 0) {
			console.error(
				"usage: resident_agent.ts answer <question_id> <answer_ref> <answer_summary>",
			);
			process.exit(2);
		}
		recordAnswer(questionId, answerRef, summaryParts.join(" "));
		return;
	}
	console.error(
		"usage: resident_agent.ts <tick [--trigger=...] | status | questions | ledger | answer <id> <ref> <summary>>",
	);
	process.exit(2);
}

main();
