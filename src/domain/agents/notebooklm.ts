import { execSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";

import {
	AgentLogger,
	type AssetStore,
	BaseAgent,
	ROOT,
	RunStage,
} from "../../io/core.js";

const NotebookListSchema = z.object({
	notebooks: z.array(
		z.object({
			id: z.string(),
			title: z.string().optional(),
		}),
	),
});

const ArtifactListSchema = z.object({
	artifacts: z.array(
		z.object({
			type_id: z.string(),
			title: z.string(),
			created_at: z.string(),
		}),
	),
});

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

export interface ShellExecutor {
	execute(command: string, returnOutput?: boolean): string | undefined;
}

export class RealShellExecutor implements ShellExecutor {
	execute(command: string, returnOutput = false): string | undefined {
		if (returnOutput) {
			return execSync(command, { encoding: "utf-8" });
		}
		execSync(command, { stdio: "inherit" });
		return undefined;
	}
}

export class NotebookLMAgent extends BaseAgent {
	private notebookCache: Array<{ id: string; title?: string }> | null = null;
	private shell: ShellExecutor;

	constructor(
		store: AssetStore,
		shell: ShellExecutor = new RealShellExecutor(),
	) {
		super(store, "notebooklm", {
			temperature: 0.1,
		});
		this.shell = shell;
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
			this.shell.execute(`notebooklm use ${notebookId}`);

			// 3. Generate video
			this.shell.execute(
				`notebooklm generate video --wait --style ${videoStyle}`,
			);

			// 4. Get video title from artifact list
			const videoTitle = this.getLatestVideoTitle();

			// 5. Create output directory
			const notebookDirName = this.sanitizeFileName(
				notebookInfo.title || notebookId.slice(0, 8),
			);
			const baseOutputDir =
				this.config.agents?.notebooklm?.output_dir || "runs-nlm";
			const outputDir = path.join(
				ROOT,
				baseOutputDir,
				notebookDirName,
				"videos",
			);
			await fs.ensureDir(outputDir);

			// 6. Download video to specified path
			const videoFileName = `${this.sanitizeFileName(videoTitle || "video")}.mp4`;
			const videoPath = path.join(outputDir, videoFileName);

			this.shell.execute(
				`notebooklm download video "${videoPath}" --latest --force`,
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

	private getNotebookInfo(notebookId: string): {
		id: string;
		title: string | null;
	} {
		// Use cached list if available
		if (!this.notebookCache) {
			const output = this.shell.execute("notebooklm list --json", true);
			if (!output) throw new Error("Failed to get notebook list");
			const parsed = NotebookListSchema.parse(JSON.parse(output));
			this.notebookCache = parsed.notebooks;
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

	private getLatestVideoTitle(): string | null {
		try {
			const output = this.shell.execute(
				"notebooklm artifact list --json",
				true,
			);
			if (!output) return null;

			const parsed = ArtifactListSchema.parse(JSON.parse(output));

			const videos = parsed.artifacts
				.filter((a) => a.type_id === "video")
				.sort(
					(a, b) =>
						new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
				);

			return videos.length > 0 ? videos[0].title : null;
		} catch (error) {
			AgentLogger.warn(
				this.name,
				"RUN",
				"WARN",
				`Failed to get video title: ${error}`,
			);
			return null;
		}
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
