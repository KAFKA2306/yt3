import path from "node:path";
import fs from "fs-extra";
import { NotebookLMAgent } from "./domain/agents/notebooklm.js";
import { PublishAgent } from "./domain/agents/publish.js";
import { AssetStore, getRunIdDateString, ROOT } from "./io/core.js";
import { AgentLogger } from "./io/utils/logger.js";
import type { AgentState } from "./domain/types.js";

async function main() {
	const runId = `boj-nlm-${getRunIdDateString()}`;
	const store = new AssetStore(runId);
	AgentLogger.init();

	AgentLogger.info("SYSTEM", "BOJ_WORKFLOW", "START", "Starting Autonomous BoJ Revision Workflow");

	const nlmAgent = new NotebookLMAgent(store);
	const publishAgent = new PublishAgent(store);

	const title = "日本銀行：需給ギャップ・潜在成長率の推計方法見直しと労働需給指標の活用 (2026)";
	const bojContent = `
日本銀行調査統計局では、マクロ的な需給バランスや長い目で見た日本経済の成長力を捉える指標として、「需給ギャップと潜在成長率」を公表しています。今般、これらの指標について、GDP統計の2020年基準への改定や近年の経済構造の変化などを踏まえ、推計方法の見直しを実施しました。

需給ギャップの推計値を用いてマクロ的な需給バランスを把握することは、経済・物価情勢を的確に判断していくうえで引き続き重要ですが、近年は、労働供給制約の強まりを背景に、労働投入量の変動や労働市場の需給バランスが、労働集約的なセクターの経済活動や物価動向に及ぼす影響度合いが大きくなっていると窺われます。

こうした点を踏まえ、賃金・物価の予測力という観点からみて、需給ギャップと補完的にモニタリングしていくことが適当とみられる労働需給関連指標についても、需給ギャップ・潜在成長率と合わせ、四半期に一度、「需給ギャップ・潜在成長率および労働需給関連指標」のページ内で公表を行うこととします。
	`.trim();

	try {
		// 1. Create Notebook
		const notebookId = await nlmAgent.createNotebook(title);

		// 2. Add BoJ Source
		await nlmAgent.addSource(notebookId, bojContent, "text");

		// 3. Deep Research (English for broader context)
		const deepQuery = "Bank of Japan output gap potential growth rate revision March 2026 labor supply demand indicators";
		await nlmAgent.deepResearch(notebookId, deepQuery);

		// 4. Generate & Download Video
		const result = await nlmAgent.run([notebookId], "whiteboard");
		if (result.videos.length === 0) throw new Error("No video generated");
		
		const video = result.videos[0];
		if (!video) throw new Error("Video object is undefined");

		// 5. Publish to YouTube
		AgentLogger.info("SYSTEM", "BOJ_WORKFLOW", "PUBLISH", `Publishing to YouTube: ${video.video_path}`);
		
		const state: AgentState = {
			run_id: runId,
			bucket: "boj_analysis",
			video_path: video.video_path,
			metadata: {
				title: title,
				description: `日本銀行（日銀）が2026年3月に発表した「需給ギャップと潜在成長率」の推計方法見直しについて、NotebookLMのAI解説をお届けします。労働需給指標の補完的活用など、今後の金融政策判断における重要ポイントを深掘りします。`,
				thumbnail_title: "日銀：需給ギャップ\n推計方法を見直し",
				tags: ["日銀", "日本銀行", "経済", "金融政策", "潜在成長率", "需給ギャップ", "NotebookLM"],
			}
		};

		const publishResult = await publishAgent.run(state);

		AgentLogger.info("SYSTEM", "BOJ_WORKFLOW", "SUCCESS", "Autonomous BoJ workflow completed!", {
			context: { youtube_id: publishResult.youtube?.video_id }
		});

	} catch (err: any) {
		AgentLogger.error("SYSTEM", "BOJ_WORKFLOW", "FAILED", err.message);
		process.exit(1);
	}
}

main();
