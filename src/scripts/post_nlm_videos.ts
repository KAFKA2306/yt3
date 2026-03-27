import path from "node:path";
import fs from "fs-extra";
import { PublishAgent } from "../domain/agents/publish.js";
import { AssetStore, getRunIdDateString, ROOT } from "../io/core.js";
import { AgentLogger } from "../io/utils/logger.js";
import type { AgentState } from "../domain/types.js";

async function main() {
	const runId = `publish-bulk-${getRunIdDateString()}`;
	const store = new AssetStore(runId);
	AgentLogger.init();

	const publishAgent = new PublishAgent(store);
	const nlmBaseDir = path.join(ROOT, "runs-nlm");

	if (!fs.existsSync(nlmBaseDir)) {
		console.error("runs-nlm directory not found");
		return;
	}

	const notebooks = fs.readdirSync(nlmBaseDir);

	for (const notebook of notebooks) {
		const videoDir = path.join(nlmBaseDir, notebook, "videos");
		if (!fs.existsSync(videoDir)) continue;

		const videos = fs.readdirSync(videoDir).filter(f => f.endsWith(".mp4"));

		for (const videoFile of videos) {
			const videoPath = path.join(videoDir, videoFile);
			
			// Generate human-readable title from filename/dirname
			// Replace underscores with spaces, but don't force Title Case which ruins Japanese/Mixed strings
			const displayTitle = videoFile
				.replace(".mp4", "")
				.replace(/_/g, " ");
			
			const notebookTitle = notebook.replace(/_/g, " ");

			AgentLogger.info("SYSTEM", "BULK_PUBLISH", "START", `Publishing: ${displayTitle}`);

			const state: AgentState = {
				run_id: runId,
				bucket: "notebooklm_bulk",
				video_path: videoPath,
				metadata: {
					title: `${displayTitle}`,
					description: `NotebookLM Deep Dive: ${displayTitle}\n\nNotebook: ${notebookTitle}`,
					thumbnail_title: displayTitle,
					tags: ["Finance", "Economy", "NotebookLM", "AI", "Analysis", "日本語"],
				}
			};

			try {
				const result = await publishAgent.run(state);
				AgentLogger.info("SYSTEM", "BULK_PUBLISH", "SUCCESS", `Published ${displayTitle}`, {
					context: { video_id: result.youtube?.video_id }
				});
			} catch (err: any) {
				AgentLogger.error("SYSTEM", "BULK_PUBLISH", "FAILED", `Failed to publish ${displayTitle}: ${err.message}`);
			}
		}
	}
}

main();
