import path from "node:path";
import fs from "fs-extra";
import { PublishAgent } from "../domain/agents/publish.js";
import { TranslatorAgent } from "../domain/agents/translator.js";
import type { AgentState } from "../domain/types.js";
import { AssetStore, ROOT, getRunIdDateString } from "../io/core.js";
import { AgentLogger } from "../io/utils/logger.js";
import {
	classifyFailureMessage,
	resolveDailyLogPath,
	writeRunEvidence,
} from "../io/utils/stability.js";

async function main() {
	let runId = process.env.RUN_ID || `publish_bulk/${getRunIdDateString()}`;
	if (!runId.includes("/")) {
		runId = `publish_bulk/${runId}`;
	}
	const store = new AssetStore(runId);
	AgentLogger.init();

	const publishAgent = new PublishAgent(store);
	const translatorAgent = new TranslatorAgent(store);
	const nlmBaseDir = path.join(ROOT, "runs-nlm");

	if (!fs.existsSync(nlmBaseDir)) {
		console.error("runs-nlm directory not found");
		return;
	}

	const notebooks = fs.readdirSync(nlmBaseDir);
	const logPath = path.join(ROOT, "logs/agent_activity.jsonl");
	let publishedTitles: string[] = [];
	const published: Array<{
		title: string;
		video_path: string;
		video_id?: string;
	}> = [];
	const skipped: string[] = [];
	const failures: Array<{
		title: string;
		video_path: string;
		message: string;
		disposition: string;
		category: string;
	}> = [];
	if (fs.existsSync(logPath)) {
		const logContent = fs.readFileSync(logPath, "utf-8");
		publishedTitles = logContent
			.split("\n")
			.filter((line) => line.trim())
			.map((line) => JSON.parse(line))
			.filter(
				(entry) =>
					entry.stage === "BULK_PUBLISH" &&
					entry.event === "SUCCESS" &&
					entry.message.startsWith("Published "),
			)
			.map((entry) =>
				entry.message.replace("Published ", "").toLowerCase().trim(),
			);
	}

	for (const notebook of notebooks) {
		const videoDir = path.join(nlmBaseDir, notebook, "videos");
		if (!fs.existsSync(videoDir)) continue;

		const videos = fs.readdirSync(videoDir).filter((f) => f.endsWith(".mp4"));

		for (const videoFile of videos) {
			const videoPath = path.join(videoDir, videoFile);
			const englishTitle = videoFile.replace(".mp4", "").replace(/_/g, " ");

			if (publishedTitles.includes(englishTitle.toLowerCase().trim())) {
				console.log(`Skipping already published video: ${englishTitle}`);
				skipped.push(englishTitle);
				continue;
			}

			const financeKeywords = [
				"economic",
				"monetary",
				"financial",
				"market",
				"performance",
				"crisis",
				"policy",
				"bank",
				"boj",
				"energy",
				"naphtha",
			];
			const isFinance =
				financeKeywords.some((k) => videoPath.toLowerCase().includes(k)) ||
				notebook.includes("銀行");

			if (!isFinance) {
				console.log(`Skipping non-financial video: ${englishTitle}`);
				continue;
			}

			console.log(`Translating title: ${englishTitle}`);
			const japaneseTitle = await translatorAgent.translateTitle(englishTitle);

			const notebookTitle = notebook.replace(/_/g, " ");

			AgentLogger.info(
				"SYSTEM",
				"BULK_PUBLISH",
				"START",
				`Publishing: ${japaneseTitle} (${englishTitle})`,
			);

			const state: AgentState = {
				run_id: runId,
				bucket: "notebooklm_bulk",
				video_path: videoPath,
				metadata: {
					title: japaneseTitle,
					description: `NotebookLM Deep Dive: ${japaneseTitle}\n\nOriginal: ${englishTitle}\nNotebook: ${notebookTitle}`,
					thumbnail_title: japaneseTitle,
					tags: [
						"Finance",
						"Economy",
						"NotebookLM",
						"AI",
						"Analysis",
						"日本語",
					],
				},
			};

			try {
				const result = (await publishAgent.run(state)) as {
					youtube?: { video_id?: string };
				};
				published.push({
					title: japaneseTitle,
					video_path: videoPath,
					video_id: result.youtube?.video_id,
				});
				AgentLogger.info(
					"SYSTEM",
					"BULK_PUBLISH",
					"SUCCESS",
					`Published ${englishTitle}`,
					{
						context: {
							video_id: result.youtube?.video_id,
							japanese_title: japaneseTitle,
						},
					},
				);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				const failure = classifyFailureMessage(message);
				failures.push({
					title: japaneseTitle,
					video_path: videoPath,
					message,
					disposition: failure.disposition,
					category: failure.category,
				});
				AgentLogger.error(
					"SYSTEM",
					"BULK_PUBLISH",
					"FAILED",
					`Failed to publish ${englishTitle}: ${message}`,
				);
			}
		}
	}

	fs.writeJsonSync(
		path.join(store.runDir, "bulk_publish_summary.json"),
		{
			run_id: runId,
			published,
			skipped,
			failures,
			recorded_at: new Date().toISOString(),
		},
		{ spaces: 2 },
	);

	const status =
		failures.length === 0
			? published.length > 0
				? "SUCCESS"
				: "SKIPPED"
			: published.length > 0
				? "PARTIAL_SUCCESS"
				: failures[failures.length - 1]?.disposition === "blocked"
					? "PUBLISH_BLOCKED"
					: failures[failures.length - 1]?.disposition === "retryable"
						? "RETRYABLE"
						: failures[failures.length - 1]?.disposition === "pending"
							? "PENDING"
							: "FAILED";

	writeRunEvidence(store.runDir, {
		run_id: runId,
		bucket: "notebooklm_bulk",
		status,
		disposition:
			failures.length === 0
				? published.length > 0
					? "success"
					: "skipped"
				: (failures[failures.length - 1]?.disposition as
						| "retryable"
						| "skipped"
						| "pending"
						| "blocked"
						| "fatal") || "fatal",
		log_path: resolveDailyLogPath(runId),
		evidence_paths: [
			path.join(store.runDir, "state.json"),
			path.join(store.runDir, "publish", "receipt.json"),
			path.join(store.runDir, "bulk_publish_summary.json"),
		],
		artifact_paths: published.map((item) => item.video_path),
		note:
			failures.length === 0
				? published.length > 0
					? "NotebookLM bulk publish completed successfully."
					: "NotebookLM bulk publish skipped because no new videos were found."
				: "NotebookLM bulk publish completed with classified failures recorded in bulk_publish_summary.json.",
	});
}

main();
