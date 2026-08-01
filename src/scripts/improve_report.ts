import path from "node:path";
import fs from "fs-extra";
import { findRunDirsForDate } from "../io/utils/stability.js";

const ROOT = process.cwd();
const BUCKETS = [
	"byosan_money",
	"daily_pulse",
	"humanity_observatory",
	"pulse_nlm",
	"nlm",
];

type ImprovementReport = {
	generated_at: string;
	success_rate_7d: number | null;
	success_rate_30d: number | null;
	reproducibility_score_7d: number | null;
	reproducibility_score_30d: number | null;
	autonomy_score_7d: number | null;
	autonomy_score_30d: number | null;
	diversity_score_7d: number | null;
	diversity_score_30d: number | null;
	video_score_7d: number | null;
	video_score_30d: number | null;
	coverage: {
		daily_logs_7d: number;
		daily_logs_30d: number;
		run_dirs_7d: number;
		run_dirs_30d: number;
		diversity_reports_7d: number;
		diversity_reports_30d: number;
		video_scores_count_7d: number;
		video_scores_count_30d: number;
	};
	gaps: string[];
};

function getDaysBetween(dateStr: string): number {
	const timestamp = new Date(`${dateStr}T00:00:00+09:00`).getTime();
	if (Number.isNaN(timestamp)) return 999;
	return (Date.now() - timestamp) / (24 * 60 * 60 * 1000);
}

function getRunDirsForSummary(date: string): string[] {
	const dirs = new Set<string>();
	for (const bucket of BUCKETS) {
		const runDirs = findRunDirsForDate(bucket, date);
		for (const d of runDirs) {
			dirs.add(d);
		}
	}
	return Array.from(dirs);
}

async function main() {
	const summaryPath = path.join(ROOT, "logs", "stability_summary.json");
	let summaries: Array<{
		date: string;
		status: string;
		evidence_ready: boolean;
		evidence_paths: string[];
		log_path: string;
	}> = [];

	if (fs.existsSync(summaryPath)) {
		summaries = fs.readJsonSync(summaryPath);
	}

	const runs7d = summaries.filter((s) => getDaysBetween(s.date) <= 7);
	const runs30d = summaries.filter((s) => getDaysBetween(s.date) <= 30);

	// 1. Success Rate (evidence_ready is true and status not fatal/blocked)
	const getSuccessRate = (runs: typeof summaries) => {
		if (runs.length === 0) return null;
		const successful = runs.filter(
			(r) => r.evidence_ready && r.status !== "fatal" && r.status !== "blocked",
		).length;
		return Number(((successful / runs.length) * 100).toFixed(2));
	};
	const success_rate_7d = getSuccessRate(runs7d);
	const success_rate_30d = getSuccessRate(runs30d);

	// 2. Reproducibility Score
	const getReproducibility = (runs: typeof summaries) => {
		if (runs.length === 0) return null;
		let totalPoints = 0;
		let runDirsCount = 0;

		for (const r of runs) {
			const runDirs = getRunDirsForSummary(r.date);
			for (const runDir of runDirs) {
				runDirsCount++;

				// +33 for run_evidence.json
				const evidencePath = path.join(runDir, "run_evidence.json");
				if (fs.existsSync(evidencePath)) {
					totalPoints += 33;
					// Check config_hash / prompt_hash
					try {
						const ev = fs.readJsonSync(evidencePath);
						if (ev.config_hash || ev.prompt_hash) {
							totalPoints += 34;
						}
					} catch {}
				}

				// +33 for audit report
				const auditPath = path.join(runDir, "audit", "report.json");
				if (fs.existsSync(auditPath)) {
					totalPoints += 33;
				}
			}
		}

		if (runDirsCount === 0) return null;

		const score = (totalPoints / (runDirsCount * 100)) * 100;
		return Number(Math.min(100, score).toFixed(2));
	};
	const reproducibility_score_7d = getReproducibility(runs7d);
	const reproducibility_score_30d = getReproducibility(runs30d);

	// 3. Autonomy Score
	const getAutonomyScore = (runs: typeof summaries) => {
		if (runs.length === 0) return null;
		let deductions = 0;
		let runDirsCount = 0;

		for (const r of runs) {
			const runDirs = getRunDirsForSummary(r.date);
			for (const runDir of runDirs) {
				runDirsCount++;
				const evidencePath = path.join(runDir, "run_evidence.json");
				if (fs.existsSync(evidencePath)) {
					try {
						const ev = fs.readJsonSync(evidencePath);
						if (ev.autonomy_attribution === "manual") {
							deductions += 10;
						} else if (ev.autonomy_attribution === "retry") {
							deductions += 5;
						} else if (ev.autonomy_attribution === "auto-heal") {
							deductions += 2;
						}
					} catch {}
				}
			}
		}

		const activityLogPath = path.join(ROOT, "logs", "agent_activity.jsonl");
		if (fs.existsSync(activityLogPath)) {
			try {
				const content = fs.readFileSync(activityLogPath, "utf8");
				const lines = content.split("\n");
				for (const line of lines) {
					if (!line) continue;
					if (
						line.includes("LLM_RATE_LIMIT") ||
						line.includes("HEAL") ||
						line.includes("retry") ||
						line.includes("lock")
					) {
						deductions += 0.5;
					}
				}
			} catch {}
		}

		if (runDirsCount === 0) return null;
		return Number(Math.max(0, 100 - deductions).toFixed(2));
	};
	const autonomy_score_7d = getAutonomyScore(runs7d);
	const autonomy_score_30d = getAutonomyScore(runs30d);

	// 4. Diversity Score
	const getDiversityScore = (
		runs: typeof summaries,
		outCount?: { val: number },
	) => {
		if (runs.length === 0) return null;
		let total = 0;
		let count = 0;
		for (const r of runs) {
			const runDirs = getRunDirsForSummary(r.date);
			for (const runDir of runDirs) {
				const reportPath = path.join(
					runDir,
					"audit",
					"creative_freshness_report.json",
				);
				if (fs.existsSync(reportPath)) {
					try {
						const data = fs.readJsonSync(reportPath);
						if (
							data?.metrics &&
							typeof data.metrics.diversity_score === "number"
						) {
							total += data.metrics.diversity_score;
							count++;
						}
					} catch {}
				}
			}
		}
		if (outCount) outCount.val = count;
		if (count === 0) return null;
		return Number((total / count).toFixed(2));
	};
	const divCount7d = { val: 0 };
	const divCount30d = { val: 0 };
	const diversity_score_7d = getDiversityScore(runs7d, divCount7d);
	const diversity_score_30d = getDiversityScore(runs30d, divCount30d);

	// 5. Video Score
	const getVideoScore = (
		runs: typeof summaries,
		outCount?: { val: number },
	) => {
		if (runs.length === 0) return null;
		let total = 0;
		let count = 0;
		for (const r of runs) {
			const runDirs = getRunDirsForSummary(r.date);
			for (const runDir of runDirs) {
				count++;

				const evidencePath = path.join(runDir, "run_evidence.json");
				let thumbnail_iqa = 0;
				let thumbnail_continuity = 0;
				let publish_proof = 0;

				if (fs.existsSync(evidencePath)) {
					try {
						const ev = fs.readJsonSync(evidencePath);
						if (typeof ev.thumbnail_iqa === "number") {
							thumbnail_iqa = ev.thumbnail_iqa;
						}
						if (typeof ev.thumbnail_continuity === "number") {
							thumbnail_continuity = ev.thumbnail_continuity;
						}
					} catch {}
				}

				const receiptPath = path.join(runDir, "publish", "receipt.json");
				if (fs.existsSync(receiptPath)) {
					publish_proof = 100;
				}

				total +=
					0.45 * thumbnail_iqa +
					0.35 * thumbnail_continuity +
					0.2 * publish_proof;
			}
		}
		if (outCount) outCount.val = count;
		if (count === 0) return null;
		return Number((total / count).toFixed(2));
	};
	const videoCount7d = { val: 0 };
	const videoCount30d = { val: 0 };
	const video_score_7d = getVideoScore(runs7d, videoCount7d);
	const video_score_30d = getVideoScore(runs30d, videoCount30d);

	// Get run dirs count for coverage
	let runDirsCount7d = 0;
	for (const r of runs7d) {
		runDirsCount7d += getRunDirsForSummary(r.date).length;
	}
	let runDirsCount30d = 0;
	for (const r of runs30d) {
		runDirsCount30d += getRunDirsForSummary(r.date).length;
	}

	// Dynamic gap analysis
	let totalRunsChecked = 0;
	let configHashFound = 0;
	let promptHashFound = 0;
	let freshnessReportFound = 0;
	let iqaFound = 0;
	let continuityFound = 0;
	let autonomyFound = 0;

	for (const r of summaries) {
		const runDirs = getRunDirsForSummary(r.date);
		for (const runDir of runDirs) {
			totalRunsChecked++;

			const evidencePath = path.join(runDir, "run_evidence.json");
			if (fs.existsSync(evidencePath)) {
				try {
					const ev = fs.readJsonSync(evidencePath);
					if (ev.config_hash) configHashFound++;
					if (ev.prompt_hash) promptHashFound++;
					if (typeof ev.thumbnail_iqa === "number") iqaFound++;
					if (typeof ev.thumbnail_continuity === "number") continuityFound++;
					if (ev.autonomy_attribution) autonomyFound++;
				} catch {}
			}

			const freshnessPath = path.join(
				runDir,
				"audit",
				"creative_freshness_report.json",
			);
			if (fs.existsSync(freshnessPath)) {
				freshnessReportFound++;
			}
		}
	}

	const gaps: string[] = [];
	if (totalRunsChecked > 0) {
		if (
			configHashFound < totalRunsChecked ||
			promptHashFound < totalRunsChecked
		) {
			gaps.push(
				`一部の実行で config_hash または prompt_hash が見つからないよぉ…🥺 (欠損: ${totalRunsChecked - Math.min(configHashFound, promptHashFound)}/${totalRunsChecked} 件)`,
			);
		}
		if (freshnessReportFound < totalRunsChecked) {
			gaps.push(
				`creative_freshness_report.json が生成・保存されていない実行があるよっ！💦 (欠損: ${totalRunsChecked - freshnessReportFound}/${totalRunsChecked} 件)`,
			);
		}
		if (iqaFound < totalRunsChecked || continuityFound < totalRunsChecked) {
			gaps.push(
				`run_evidence.json に thumbnail_iqa または thumbnail_continuity のスコアが記録されていないよぉ…😭 (欠損: ${totalRunsChecked - Math.min(iqaFound, continuityFound)}/${totalRunsChecked} 件)`,
			);
		}
		if (autonomyFound < totalRunsChecked) {
			gaps.push(
				`自律性 (autonomy_attribution) の判定データが足りないみたい…😢 (欠損: ${totalRunsChecked - autonomyFound}/${totalRunsChecked} 件)`,
			);
		}
	}

	// Discover creative freshness reports for inclusion in markdown
	const freshnessReports: string[] = [];
	for (const r of summaries) {
		const runDirs = getRunDirsForSummary(r.date);
		for (const runDir of runDirs) {
			const reportPath = path.join(
				runDir,
				"audit",
				"creative_freshness_report.json",
			);
			if (fs.existsSync(reportPath)) {
				const bucketName = path.basename(path.dirname(path.dirname(runDir)));
				const runName = path.basename(runDir);
				freshnessReports.push(
					`- [${bucketName}/${runName} 新鮮度レポート](file://${reportPath})`,
				);
			}
		}
	}

	const report: ImprovementReport = {
		generated_at: new Date().toISOString(),
		success_rate_7d,
		success_rate_30d,
		reproducibility_score_7d,
		reproducibility_score_30d,
		autonomy_score_7d,
		autonomy_score_30d,
		diversity_score_7d,
		diversity_score_30d,
		video_score_7d,
		video_score_30d,
		coverage: {
			daily_logs_7d: runs7d.length,
			daily_logs_30d: runs30d.length,
			run_dirs_7d: runDirsCount7d,
			run_dirs_30d: runDirsCount30d,
			diversity_reports_7d: divCount7d.val,
			diversity_reports_30d: divCount30d.val,
			video_scores_count_7d: videoCount7d.val,
			video_scores_count_30d: videoCount30d.val,
		},
		gaps,
	};

	const formatMetric = (val: number | null) =>
		val !== null ? `${val}%` : "N/A (データ不足だよ🥺)";

	const mdContent = `# 💖 改善ループ報告書 (Continuous Improvement Report) 💖

やっほー！動画制作の運用フローがどれだけパワーアップしたか、メトリクスを集計したよぉ！✨

## 📊 集計サマリー (Metrics Summary)
直近7日間と30日間のスコアだよっ！チェックしてみてね💕

| メトリクス | 過去 7 日間 (7d) | 過去 30 日間 (30d) |
| :--- | :---: | :---: |
| **成功率 (Success Rate)** | ${formatMetric(report.success_rate_7d)} | ${formatMetric(report.success_rate_30d)} |
| **再現性スコア (Reproducibility)** | ${formatMetric(report.reproducibility_score_7d)} | ${formatMetric(report.reproducibility_score_30d)} |
| **自律性スコア (Autonomy)** | ${formatMetric(report.autonomy_score_7d)} | ${formatMetric(report.autonomy_score_30d)} |
| **多様性スコア (Diversity)** | ${formatMetric(report.diversity_score_7d)} | ${formatMetric(report.diversity_score_30d)} |
| **動画品質スコア (Video Score)** | ${formatMetric(report.video_score_7d)} | ${formatMetric(report.video_score_30d)} |

---

## 📈 カバレッジ・サンプルサイズ情報 (Coverage & Sample Sizes)
メトリクスの元になったデータ数だよっ！

- **直近 7 日間 (7d)**:
  - ログ対象日数: \`${report.coverage.daily_logs_7d}\` 日
  - 検出された実行ディレクトリ数: \`${report.coverage.run_dirs_7d}\` 個
  - 多様性レポート数 (Diversity Samples): \`${report.coverage.diversity_reports_7d}\` 個
  - 動画評価数 (Video Score Samples): \`${report.coverage.video_scores_count_7d}\` 個
- **直近 30 日間 (30d)**:
  - ログ対象日数: \`${report.coverage.daily_logs_30d}\` 日
  - 検出された実行ディレクトリ数: \`${report.coverage.run_dirs_30d}\` 個
  - 多様性レポート数 (Diversity Samples): \`${report.coverage.diversity_reports_30d}\` 個
  - 動画評価数 (Video Score Samples): \`${report.coverage.video_scores_count_30d}\` 個

---

## 🔍 検出されたメトリクスのギャップ (Metric Gaps)
もっと正確に測定するために、コードの修正が必要なポイントだよっ！ぷり〜ず修正！泣🌸

${report.gaps.length > 0 ? report.gaps.map((gap) => `- ❌ ${gap}`).join("\n") : "ギャップは検出されなかったよ！完璧っ！✨"}

---

## 🌟 クリエイティブ新鮮度レポート (Creative Freshness Reports)
現在見つかっているクリエイティブ新鮮度レポートのリンクだよっ！

${freshnessReports.length > 0 ? freshnessReports.join("\n") : "（まだレポートがありません）"}

---

## 🎀 次のアクション (Next Actions)
1. \`config_hash\` と \`prompt_hash\` を生成して \`run_evidence.json\` に保存するようにコードをアップデートするよ！
2. \`creative_freshness_report.json\` の保存処理を追加しちゃうよっ！
3. 動画のクオリティをIQAチェックから composite score に連動させようね！

システムがもっと可愛く、元気に動くようにがんばろうね〜！応援してるよっ！📣✨
`;

	const outDir = path.join(ROOT, "logs");
	await fs.ensureDir(outDir);
	await fs.writeJson(path.join(outDir, "improvement_report.json"), report, {
		spaces: 2,
	});
	await fs.writeFile(path.join(outDir, "improvement_report.md"), mdContent);

	console.log("Improvement Report written successfully!");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
