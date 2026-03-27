import path from "node:path";
import fs from "fs-extra";
import { execSync } from "node:child_process";

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

	constructor(store: AssetStore) {
		const cfg = loadConfig();
		super(store, RunStage.MEDIA, {
			temperature: 0.1,
		});
		this.config = cfg;
	}

	async run(
		notebook_ids: string[],
		videoStyle: string = "whiteboard",
	): Promise<NotebookLMResult> {
		this.logInput({ notebooks: notebook_ids.length, style: videoStyle });

		const videos: NotebookVideo[] = [];

		for (const notebookId of notebook_ids) {
			try {
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
					"notebooklm",
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
					videos.push({
						notebook_id: notebookId,
						notebook_title: notebookInfo.title || "Untitled",
						video_path: videoPath,
						generated_at: new Date().toISOString(),
					});

					AgentLogger.info(
						this.name,
						"RUN",
						"SUCCESS",
						`Downloaded video to: ${videoPath}`,
					);
				} else {
					throw new Error(`Video file not found at ${videoPath}`);
				}
			} catch (error) {
				AgentLogger.error(
					this.name,
					"RUN",
					"FAILED",
					`Error processing notebook ${notebookId}: ${error}`,
				);
				throw error;
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
		returnOutput: boolean = false,
	): string | undefined {
		try {
			const fullCommand = `notebooklm ${command}`;
			if (returnOutput) {
				return execSync(fullCommand, { encoding: "utf-8" });
			}
			execSync(fullCommand, { stdio: "inherit" });
			return undefined;
		} catch (error) {
			throw new Error(`NotebookLM CLI error: ${error}`);
		}
	}

	private getNotebookInfo(
		notebookId: string,
	): { id: string; title: string | null } {
		try {
			const output = execSync("notebooklm list --json", {
				encoding: "utf-8",
			});
			const data = JSON.parse(output);

			// Find notebook by ID (full or partial match)
			const notebook = data.find(
				(nb: { id: string; title?: string }) =>
					nb.id === notebookId || nb.id.startsWith(notebookId),
			);

			if (notebook) {
				return {
					id: notebook.id,
					title: notebook.title || null,
				};
			}

			throw new Error(`Notebook ${notebookId} not found in list`);
		} catch (error) {
			throw new Error(`Failed to fetch notebook info: ${error}`);
		}
	}

	private sanitizeFileName(title: string): string {
		return title
			.replace(/[\/\\:*?"<>|]/g, "_")
			.replace(/\s+/g, "_")
			.toLowerCase()
			.slice(0, 200);
	}
}
