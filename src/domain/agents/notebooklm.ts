import { execSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";

import {
	AgentLogger,
	type AssetStore,
	BaseAgent,
	RunStage,
	loadConfig,
} from "../../io/core.js";
import type { AppConfig } from "../types.js";

export interface NotebookVideo {
	notebook_id: string;
	notebook_title: string;
	video_path: string;
	generated_at: string;
}

export interface NotebookLMResult {
	videos: NotebookVideo[];
	total_generated: number;
}

export class NotebookLMAgent extends BaseAgent {
	override config: AppConfig;
	private notebookCache: Array<{ id: string; title?: string }> | null = null;

	constructor(store: AssetStore) {
		const cfg = loadConfig();
		super(store, RunStage.MEDIA, {
			temperature: 0.1,
		});
		this.config = cfg;
	}

	async run(
		notebook_ids: string[],
		videoStyle = "whiteboard",
	): Promise<NotebookLMResult> {
		this.logInput({ notebooks: notebook_ids.length, style: videoStyle });

		let videos: NotebookVideo[] = [];

		for (const notebookId of notebook_ids) {
			AgentLogger.info(
				this.name,
				"RUN",
				"PROCESS",
				`Processing notebook: ${notebookId}`,
			);

			// 1. Get notebook details
			const notebookInfo = this.getNotebookInfo(notebookId);

			// 2. Set notebook context
			this.executeNotebooklmCommand(`use ${notebookId}`);

			// 3. Generate video
			const generationOutput = this.executeNotebooklmCommand(
				`generate video --wait --style ${videoStyle}`,
				true,
			);

			// 4. Create output directory
			const dirName = this.sanitizeFileName(
				notebookInfo.title || notebookId.slice(0, 8),
			);
			const outputDir = path.join(
			this.store.runDir,
			dirName,
			"videos",
		);
			await fs.ensureDir(outputDir);

			// 5. Download video to specified path
			const videoFileName = `video_${new Date().toISOString().slice(0, 10)}.mp4`;
			const videoPath = path.join(outputDir, videoFileName);

			this.executeNotebooklmCommand(
				`download video "${videoPath}" --latest --force`,
			);

			if (await fs.pathExists(videoPath)) {
				videos = [
					...videos,
					{
						notebook_id: notebookId,
						notebook_title: notebookInfo.title || "Untitled",
						video_path: videoPath,
						generated_at: new Date().toISOString(),
					},
				];

				AgentLogger.info(
					this.name,
					"RUN",
					"SUCCESS",
					`Downloaded video to: ${videoPath}`,
				);
			} else {
				throw new Error(`Video file not found at ${videoPath}`);
			}
		}

		this.logOutput({
			total_generated: videos.length,
			videos,
		});

		return {
			videos,
			total_generated: videos.length,
		};
	}

	private executeNotebooklmCommand(
		command: string,
		returnOutput = false,
	): string | undefined {
		const fullCommand = `notebooklm ${command}`;
		if (returnOutput) {
			return execSync(fullCommand, { encoding: "utf-8" });
		}
		execSync(fullCommand, { stdio: "inherit" });
		return undefined;
	}

	private getNotebookInfo(notebookId: string): {
		id: string;
		title: string | null;
	} {
		// Use cached list if available
		if (!this.notebookCache) {
			const output = execSync("notebooklm list --json", {
				encoding: "utf-8",
			});
			const parsed = JSON.parse(output) as Array<{
				id: string;
				title?: string;
			}>;
			this.notebookCache = parsed;
		}

		// Find notebook by ID (full or partial match)
		const notebook = this.notebookCache?.find(
			(nb) => nb.id === notebookId || nb.id.startsWith(notebookId),
		);

		if (notebook) {
			return {
				id: notebook.id,
				title: notebook.title || null,
			};
		}

		throw new Error(`Notebook ${notebookId} not found in list`);
	}

	private sanitizeFileName(title: string): string {
		return title
			.replace(/[\\/\:*?"<>|]/g, "_") // Replace special characters
			.replace(/\s+/g, "_") // Replace spaces
			.replace(/_+/g, "_") // Collapse multiple underscores to single
			.replace(/_+$/, "") // Remove trailing underscores
			.toLowerCase()
			.slice(0, 200);
	}
}
