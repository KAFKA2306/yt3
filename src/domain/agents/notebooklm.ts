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
			id: z.string(),
			type_id: z.string(),
			type: z.string(),
			title: z.string(),
			status: z.string(),
			created_at: z.string(),
		}),
	),
});

type Artifact = z.infer<typeof ArtifactListSchema>["artifacts"][number];

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
	 * Create a new notebook, or reuse an existing one if the title matches
	 */
	async createNotebook(title: string): Promise<string> {
		AgentLogger.info(
			this.name,
			"CREATE",
			"CHECK",
			`Checking for existing notebook with title: ${title}`,
		);

		const listOutput = this.shell.execute("notebooklm list --json", true);
		if (listOutput) {
			const parsed = NotebookListSchema.parse(JSON.parse(listOutput));
			const existing = parsed.notebooks.find((nb) => nb.title === title);
			if (existing) {
				AgentLogger.info(
					this.name,
					"CREATE",
					"REUSE",
					`Found existing notebook "${title}" (${existing.id}). Reusing...`,
				);
				this.notebookCache = parsed.notebooks;
				return existing.id;
			}
		}

		AgentLogger.info(
			this.name,
			"CREATE",
			"START",
			`Creating notebook: ${title}`,
		);
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
		title?: string,
	): Promise<void> {
		this.shell.execute(`notebooklm use ${notebookId}`);
		const listOutput = this.shell.execute(
			"notebooklm source list --json",
			true,
		);
		if (listOutput) {
			const sources = JSON.parse(listOutput).sources || [];
			const displayTitle = title || content.slice(0, 50);
			const exists = sources.some(
				(s: { title: string }) =>
					s.title === title ||
					s.title === displayTitle ||
					s.title === content.slice(0, 30),
			);
			if (exists) {
				AgentLogger.info(
					this.name,
					"SOURCE",
					"SKIP",
					`Source "${displayTitle}" already exists. Skipping...`,
				);
				return;
			}
		}

		AgentLogger.info(
			this.name,
			"SOURCE",
			"ADD",
			`Adding source to ${notebookId}: ${content.slice(0, 50)}...`,
		);
		const typeArg = type ? `--type ${type}` : "";
		const titleArg = title ? `--title "${title}"` : "";
		try {
			this.shell.execute(
				`notebooklm source add "${content}" -n ${notebookId} ${typeArg} ${titleArg}`,
			);
		} catch (e) {
			AgentLogger.warn(
				this.name,
				"SOURCE",
				"WARN",
				`Failed to add source (RPC error), but it might have been added or we can continue: ${title || content.slice(0, 20)}`,
			);
		}
	}

	/**
	 * Perform deep research on a topic and add discovered sources
	 */
	async deepResearch(notebookId: string, query: string): Promise<void> {
		this.shell.execute(`notebooklm use ${notebookId}`);

		const artifactsOutput = this.shell.execute(
			"notebooklm artifact list --json",
			true,
		);
		const artifacts: Artifact[] = artifactsOutput
			? ArtifactListSchema.parse(JSON.parse(artifactsOutput)).artifacts || []
			: [];

		const hasCompletedReport = artifacts.some(
			(a: Artifact) => a.type === "Report" && a.status === "completed",
		);

		if (hasCompletedReport) {
			AgentLogger.info(
				this.name,
				"RESEARCH",
				"SKIP",
				"Completed research report found. Deep research already performed. Skipping to avoid duplicate...",
			);
			return;
		}

		const sourceOutput = this.shell.execute(
			"notebooklm source list --json",
			true,
		);
		if (sourceOutput) {
			const sources = JSON.parse(sourceOutput).sources || [];
			if (sources.length > 3) {
				AgentLogger.info(
					this.name,
					"RESEARCH",
					"SKIP",
					`Notebook already has ${sources.length} sources. Research likely completed. Skipping duplicate...`,
				);
				return;
			}
		}

		const hasQueuedResearch = artifacts.some(
			(a: Artifact) =>
				(a.type === "Report" &&
					(a.status === "in_progress" || a.status === "queued")) ||
				(a.type_id === "research" && a.status !== "completed"),
		);

		if (hasQueuedResearch) {
			AgentLogger.info(
				this.name,
				"RESEARCH",
				"WAIT",
				"Research is already in progress/queued. Waiting instead of re-requesting...",
			);

			try {
				this.shell.execute("notebooklm artifact wait", true);
			} catch {}
			return;
		}

		AgentLogger.info(
			this.name,
			"RESEARCH",
			"EXEC",
			`Executing deep research for: ${query}`,
		);

		try {
			this.shell.execute(
				`notebooklm source add-research "${query}" --mode deep --import-all`,
			);
			AgentLogger.info(
				this.name,
				"RESEARCH",
				"QUEUED",
				"Research request queued. NotebookLM will process in background.",
			);
		} catch (e) {
			AgentLogger.warn(
				this.name,
				"RESEARCH",
				"ERROR",
				`Failed to queue research: ${String(e).slice(0, 100)}`,
			);
		}
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

			const notebookInfo = this.getNotebookInfo(notebookId);

			this.shell.execute(`notebooklm use ${notebookId}`);

			const artifactsOutput = this.shell.execute(
				"notebooklm artifact list --json",
				true,
			);
			const artifacts: Artifact[] = artifactsOutput
				? ArtifactListSchema.parse(JSON.parse(artifactsOutput)).artifacts || []
				: [];

			const hasAudio = artifacts.some(
				(a: Artifact) =>
					a.type_id === "audio" &&
					(a.status === "completed" ||
						a.status === "in_progress" ||
						a.status === "pending"),
			);
			const hasVideo = artifacts.some(
				(a: Artifact) =>
					a.type_id === "video" &&
					(a.status === "completed" ||
						a.status === "in_progress" ||
						a.status === "pending"),
			);

			if (!hasAudio) {
				AgentLogger.info(
					this.name,
					"RUN",
					"GENERATE_AUDIO",
					"Generating audio...",
				);
				try {
					this.shell.execute("notebooklm generate audio --wait");
				} catch (e) {
					AgentLogger.warn(
						this.name,
						"RUN",
						"WARN",
						"Audio generation command returned an error, checking if it was queued...",
					);
				}
			} else {
				AgentLogger.info(
					this.name,
					"RUN",
					"SKIP",
					"Audio already exists or is in progress. Skipping generation request.",
				);
			}

			if (!hasVideo) {
				AgentLogger.info(
					this.name,
					"RUN",
					"GENERATE_VIDEO",
					`Generating video (${videoStyle})...`,
				);
				try {
					this.shell.execute(
						`notebooklm generate video --wait --style ${videoStyle}`,
					);
				} catch (e) {
					AgentLogger.warn(
						this.name,
						"RUN",
						"WARN",
						"Video generation command returned an error, checking if it was queued...",
					);
				}
			} else {
				AgentLogger.info(
					this.name,
					"RUN",
					"SKIP",
					"Video already exists or is in progress. Skipping generation request.",
				);
			}

			AgentLogger.info(
				this.name,
				"RUN",
				"WAIT",
				"Waiting for all artifacts to complete...",
			);

			// Get artifacts again to find IDs
			const waitArtifactsOutput = this.shell.execute(
				"notebooklm artifact list --json",
				true,
			);
			if (waitArtifactsOutput) {
				const currentArtifacts =
					ArtifactListSchema.parse(JSON.parse(waitArtifactsOutput)).artifacts ||
					[];
				const pending = currentArtifacts.filter(
					(a) =>
						a.status === "pending" ||
						a.status === "in_progress" ||
						a.status === "queued",
				);
				for (const p of pending) {
					AgentLogger.info(
						this.name,
						"RUN",
						"WAIT",
						`Waiting for artifact: ${p.title} (${p.id})...`,
					);
					try {
						this.shell.execute(
							`notebooklm artifact wait ${p.id} --timeout 600`,
						);
					} catch (e) {
						AgentLogger.warn(
							this.name,
							"RUN",
							"WARN",
							`Wait for ${p.id} failed or timed out: ${e}`,
						);
					}
				}
			}

			const artifactTitle = this.getLatestVideoTitle();

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

			const audioFileName = `${this.sanitizeFileName(artifactTitle || "audio")}.wav`;
			const audioPath = path.join(outputDir, audioFileName);
			if (!fs.existsSync(audioPath)) {
				AgentLogger.info(
					this.name,
					"RUN",
					"DOWNLOAD_AUDIO",
					`Downloading audio to ${audioPath}...`,
				);
				try {
					this.shell.execute(
						`notebooklm download audio "${audioPath}" --latest --force`,
					);
				} catch (e) {
					AgentLogger.warn(
						this.name,
						"RUN",
						"WARN",
						"Failed to download audio",
					);
				}
			}

			const videoFileName = `${this.sanitizeFileName(artifactTitle || "video")}.mp4`;
			const videoPath = path.join(outputDir, videoFileName);
			if (!fs.existsSync(videoPath)) {
				AgentLogger.info(
					this.name,
					"RUN",
					"DOWNLOAD_VIDEO",
					`Downloading video to ${videoPath}...`,
				);
				this.shell.execute(
					`notebooklm download video "${videoPath}" --latest --force`,
				);
			}

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
					`Artifacts ready at: ${outputDir}`,
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
		if (!this.notebookCache) {
			const output = this.shell.execute("notebooklm list --json", true);
			if (!output) throw new Error("Failed to get notebook list");
			const parsed = NotebookListSchema.parse(JSON.parse(output));
			this.notebookCache = parsed.notebooks;
		}

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

			return videos.length > 0 ? (videos[0]?.title ?? null) : null;
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
			.replace(/[\\/\:*?"<>|]/g, "_")
			.replace(/\s+/g, "_")
			.replace(/_+/g, "_")
			.replace(/_+$/, "")
			.toLowerCase()
			.slice(0, 200);
	}
}
