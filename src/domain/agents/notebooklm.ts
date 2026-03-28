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

const NotebookCreateSchema = z.object({
	notebook: z.object({
		id: z.string(),
		title: z.string(),
	}),
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

	/**
	 * Create a new notebook
	 */
	async createNotebook(title: string): Promise<string> {
		AgentLogger.info(this.name, "CREATE", "START", `Creating notebook: ${title}`);
		const output = this.shell.execute(
			`notebooklm create "${title}" --json`,
			true,
		);
		if (!output) throw new Error("Failed to create notebook");
		const parsed = NotebookCreateSchema.parse(JSON.parse(output));
		AgentLogger.info(
			this.name,
			"CREATE",
			"SUCCESS",
			`Created notebook: ${parsed.notebook.title} (${parsed.notebook.id})`,
		);
		// Invalidate cache
		this.notebookCache = null;
		return parsed.notebook.id;
	}

	/**
	 * Add a source to a notebook
	 */
	async addSource(
		notebookId: string,
		content: string,
		type?: string,
	): Promise<void> {
		AgentLogger.info(
			this.name,
			"SOURCE",
			"ADD",
			`Adding source to ${notebookId}: ${content.slice(0, 50)}...`,
		);
		const typeArg = type ? `--type ${type}` : "";
		this.shell.execute(
			`notebooklm source add "${content}" -n ${notebookId} ${typeArg}`,
		);
	}

	/**
	 * Perform deep research on a topic and add discovered sources
	 */
	async deepResearch(notebookId: string, query: string): Promise<void> {
		AgentLogger.info(
			this.name,
			"RESEARCH",
			"DEEP",
			`Performing deep research for: ${query}`,
		);
		// Ensure correct notebook context
		this.shell.execute(`notebooklm use ${notebookId}`);
		// Run deep research with English query and wait for completion
		this.shell.execute(
			`notebooklm source add-research "${query}" --mode deep --import-all`,
		);
		AgentLogger.info(
			this.name,
			"RESEARCH",
			"SUCCESS",
			`Deep research completed and sources added for: ${query}`,
		);
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

			// 3. Generate audio
			AgentLogger.info(this.name, "RUN", "GENERATE_AUDIO", "Generating audio...");
			try {
				this.shell.execute(`notebooklm generate audio --wait`);
			} catch (e) {
				AgentLogger.warn(this.name, "RUN", "WARN", "Audio generation command returned an error, checking if it was queued...");
			}
			// Explicitly wait for any pending artifacts to ensure it's done before moving on
			this.shell.execute(`notebooklm artifact wait`);

			// 4. Generate video
			AgentLogger.info(this.name, "RUN", "GENERATE_VIDEO", `Generating video (${videoStyle})...`);
			try {
				this.shell.execute(
					`notebooklm generate video --wait --style ${videoStyle}`,
				);
			} catch (e) {
				AgentLogger.warn(this.name, "RUN", "WARN", "Video generation command returned an error, checking if it was queued...");
			}
			// Explicitly wait again
			this.shell.execute(`notebooklm artifact wait`);

			// 5. Get artifact title from artifact list (latest video or audio title)
			const artifactTitle = this.getLatestVideoTitle(); // This actually gets the latest video title, which is fine for the folder name

			// 6. Create output directory
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

			// 7. Download audio
			const audioFileName = `${this.sanitizeFileName(artifactTitle || "audio")}.wav`;
			const audioPath = path.join(outputDir, audioFileName);
			AgentLogger.info(this.name, "RUN", "DOWNLOAD_AUDIO", `Downloading audio to ${audioPath}...`);
			try {
				this.shell.execute(`notebooklm download audio "${audioPath}" --latest --force`);
			} catch (e) {
				AgentLogger.warn(this.name, "RUN", "WARN", "Failed to download audio");
			}

			// 8. Download video
			const videoFileName = `${this.sanitizeFileName(artifactTitle || "video")}.mp4`;
			const videoPath = path.join(outputDir, videoFileName);
			AgentLogger.info(this.name, "RUN", "DOWNLOAD_VIDEO", `Downloading video to ${videoPath}...`);
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

			return videos.length > 0 ? videos[0]?.title ?? null : null;
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
