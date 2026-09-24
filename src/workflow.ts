import path from "node:path";
import fs from "fs-extra";
import { AuditAgent } from "./domain/agents/audit.js";
import { ScriptSmith } from "./domain/agents/content.js";
import type { MediaResult } from "./domain/agents/media.js";
import { PublishAgent } from "./domain/agents/publish.js";
import { TrendScout } from "./domain/agents/research.js";
import {
	type CanonicalProductionResult,
	runCanonicalEpisodeProduction,
} from "./domain/episode/production.js";
import type { AgentState, ContentResult } from "./domain/types.js";
import { type AssetStore, appendLoopMemory } from "./io/core.js";
import { sendAlert } from "./io/utils/discord.js";
import { AgentLogger } from "./io/utils/logger.js";
import {
	classifyFailureMessage,
	resolveDailyLogPath,
	writeRunEvidence,
} from "./io/utils/stability.js";

export async function runSequentialWorkflow(
	store: AssetStore,
	initialState: Partial<AgentState>,
) {
	let state: AgentState = { ...initialState } as AgentState;
	const bucket = state.bucket || store.domainId;
	state.bucket = bucket;

	const researchJsonPath = path.join(store.runDir, "research.json");
	if (fs.existsSync(researchJsonPath)) {
		AgentLogger.info(
			"SYSTEM",
			"WORKFLOW",
			"STEP",
			"Skipping Research (cached research.json found)",
		);
		const researchResults = fs.readJsonSync(researchJsonPath);
		state = {
			...state,
			news: researchResults.news,
			director_data: researchResults.director_data,
			memory_context: researchResults.memory_context,
		};
	} else {
		AgentLogger.info("SYSTEM", "WORKFLOW", "STEP", "Starting Research...");
		const research = new TrendScout(store);
		const researchResults = await research.run(
			bucket,
			state.limit,
			state.mission_file,
		);
		state = {
			...state,
			news: researchResults.news,
			director_data: researchResults.director_data,
			memory_context: researchResults.memory_context,
		};
		fs.writeJsonSync(researchJsonPath, researchResults, { spaces: 2 });
	}

	const metadataJsonPath = path.join(store.runDir, "metadata.json");
	const contentOutputPath = path.join(
		store.runDir,
		"content",
		store.cfg.workflow.filenames.output,
	);
	if (fs.existsSync(metadataJsonPath) && fs.existsSync(contentOutputPath)) {
		AgentLogger.info(
			"SYSTEM",
			"WORKFLOW",
			"STEP",
			"Skipping Content Synthesis (cached metadata & script found)",
		);
		const contentResults = store.load<ContentResult>("content", "output");
		if (!contentResults)
			throw new Error("Failed to load cached content results");
		state = {
			...state,
			script: contentResults.script,
			metadata: contentResults.metadata,
		};
	} else {
		AgentLogger.info(
			"SYSTEM",
			"WORKFLOW",
			"STEP",
			"Starting Content Synthesis...",
		);
		if (!state.director_data)
			throw new Error("Missing director_data for content synthesis");
		const scriptSmith = new ScriptSmith(store);
		const contentResults = await scriptSmith.run(
			state.news || [],
			state.director_data,
			state.memory_context || "",
		);
		state = {
			...state,
			script: contentResults.script,
			metadata: contentResults.metadata,
		};
		store.save("content", "output", contentResults);
		fs.writeJsonSync(metadataJsonPath, contentResults.metadata, { spaces: 2 });
		invalidateMediaArtifacts(store);
	}

	const videoPath = path.join(
		store.videoDir(),
		store.cfg.workflow.filenames.video,
	);
	const mediaOutputPath = path.join(
		store.runDir,
		"media",
		store.cfg.workflow.filenames.output,
	);
	const canonicalResultPath = path.join(
		store.runDir,
		"episode",
		"production-result.json",
	);
	if (
		fs.existsSync(videoPath) &&
		fs.existsSync(mediaOutputPath) &&
		fs.existsSync(canonicalResultPath)
	) {
		AgentLogger.info(
			"SYSTEM",
			"WORKFLOW",
			"STEP",
			"Skipping Canonical Episode Production (verified canonical cache found)",
		);
		const mediaResults = store.load<MediaResult>("media", "output");
		if (!mediaResults) throw new Error("Failed to load cached media results");
		state = { ...state, ...mediaResults };
		applyCanonicalDurations(state, store);
	} else {
		AgentLogger.info(
			"SYSTEM",
			"WORKFLOW",
			"STEP",
			"Starting Canonical Episode Production...",
		);
		if (!state.script)
			throw new Error("Missing script for canonical production");
		if (!state.metadata)
			throw new Error("Missing metadata for canonical production");
		const canonical = await runCanonicalEpisodeProduction(store, state);
		const mediaResults: MediaResult = {
			audio_paths: canonical.audio_paths,
			thumbnail_path: canonical.thumbnail_path,
			video_path: canonical.video_path,
		};
		state = { ...state, ...mediaResults };
		store.save("media", "output", mediaResults);
	}

	store.updateState(state);

	AgentLogger.info("SYSTEM", "WORKFLOW", "STEP", "Starting Quality Audit...");
	const auditor = new AuditAgent(store);
	const auditResults = await auditor.run(state);
	state = { ...state, audit_results: auditResults };
	fs.writeJsonSync(
		path.join(store.runDir, "audit", "result.json"),
		auditResults,
		{ spaces: 2 },
	);

	const hasCriticalFailure = Object.values(auditResults).some(
		(result) => result.critical && result.status !== "PASS",
	);
	if (hasCriticalFailure) {
		const failingChecks = Object.values(auditResults)
			.filter((result) => result.critical && result.status !== "PASS")
			.map((result) => result.name);

		appendLoopMemory(store, {
			run_id: state.run_id,
			bucket,
			stage: "audit",
			kind: "failure",
			summary:
				"Critical audit failure blocked publish. Cache invalidation was triggered so the next run must regenerate from fresh state.",
			signals: failingChecks,
			fixes: [
				"regenerate content and canonical episode media rather than reusing stale artifacts",
				"treat failing audit checks as state invalidation, not just a notification",
				"retain the failing check names as operator diagnostic evidence",
			],
			timestamp: new Date().toISOString(),
		});
		AgentLogger.error(
			"SYSTEM",
			"WORKFLOW",
			"BLOCK",
			`Publish blocked by Audit failure: ${failingChecks.join(", ")}`,
		);
		await sendAlert(
			`🚨 **Publish Blocked** for run \`${state.run_id}\``,
			"audit_fail",
			{
				reason: "Critical Audit Failure",
				checks: failingChecks.join(", "),
			},
		);
		invalidateContentArtifacts(store);
		state.status = "PUBLISH_BLOCKED";
		writeRunEvidence(store.runDir, {
			run_id: state.run_id,
			bucket,
			status: state.status,
			disposition: "blocked",
			log_path: resolveDailyLogPath(state.run_id),
			evidence_paths: [
				path.join(store.runDir, "state.json"),
				path.join(store.runDir, "audit", "result.json"),
				path.join(store.runDir, "episode", "qa.json"),
			],
			artifact_paths: [],
			note: "Publish was blocked by critical audit checks and the canonical content cache was invalidated.",
		});
		return state;
	}

	AgentLogger.info("SYSTEM", "WORKFLOW", "STEP", "Starting Publication...");
	const publisher = new PublishAgent(store);
	let publishResults: Awaited<ReturnType<PublishAgent["run"]>> | undefined;
	try {
		publishResults = await publisher.run(state);
		state = { ...state, publish_results: publishResults };
	} catch (err) {
		const error = err as Error;
		const failure = classifyFailureMessage(error.message);
		appendLoopMemory(store, {
			run_id: state.run_id,
			bucket,
			stage: "publish",
			kind: "failure",
			summary:
				"Publish step was classified and recorded instead of surfacing as an ambiguous crash.",
			signals: [error.message],
			fixes: [
				"keep publish-blocked evidence in the run directory",
				"retry only when the failure is retryable",
			],
			timestamp: new Date().toISOString(),
		});
		state.status =
			failure.disposition === "blocked"
				? "PUBLISH_BLOCKED"
				: failure.disposition === "pending"
					? "PENDING"
					: failure.disposition === "retryable"
						? "RETRYABLE"
						: "FAILED";
		writeRunEvidence(store.runDir, {
			run_id: state.run_id,
			bucket,
			status: state.status,
			disposition: failure.disposition,
			log_path: resolveDailyLogPath(state.run_id),
			evidence_paths: [
				path.join(store.runDir, "state.json"),
				path.join(store.runDir, "episode", "production-result.json"),
			],
			artifact_paths: [],
			failure,
			note: "Publish exception was caught and classified in workflow.ts.",
		});
		if (failure.disposition === "fatal") throw error;
		return state;
	}

	const receiptPath = path.join(store.runDir, "publish", "receipt.json");
	const existingReceipt = fs.existsSync(receiptPath)
		? fs.readJsonSync(receiptPath)
		: {};
	fs.writeJsonSync(
		receiptPath,
		{
			...existingReceipt,
			...publishResults,
			canonical_episode: buildCanonicalReceiptTrace(store),
		},
		{ spaces: 2 },
	);

	store.updateState(state);

	appendLoopMemory(store, {
		run_id: state.run_id,
		bucket,
		stage: "publish",
		kind: "success",
		summary:
			"Run completed successfully. Keep the audience framing, title shape, canonical episode, and audit-safe structure that passed this cycle.",
		signals: [
			state.metadata?.title || state.script?.title || "successful publish",
			"canonical episode passed",
			"audit passed",
			"publish succeeded",
		],
		fixes: [
			"reuse the same audience-fitting angle if the topic family repeats",
			"retain this run as operator diagnostic evidence, not prompt authority",
		],
		timestamp: new Date().toISOString(),
	});

	state.status = "SUCCESS";
	writeRunEvidence(store.runDir, {
		run_id: state.run_id,
		bucket,
		status: state.status,
		disposition: "success",
		log_path: resolveDailyLogPath(state.run_id),
		evidence_paths: [
			path.join(store.runDir, "state.json"),
			path.join(store.runDir, "episode", "episode.json"),
			path.join(store.runDir, "episode", "production-result.json"),
			path.join(store.runDir, "episode", "qa.json"),
			path.join(store.runDir, "publish", "state.json"),
			receiptPath,
		],
		artifact_paths: [state.video_path || ""].filter(Boolean),
		note: "Sequential workflow completed successfully through the canonical episode production path.",
	});
	return state;
}

function applyCanonicalDurations(state: AgentState, store: AssetStore): void {
	if (!state.script) return;
	const timelinePath = path.join(
		store.runDir,
		"episode",
		"compiled",
		"ja",
		"timeline.json",
	);
	if (!fs.existsSync(timelinePath))
		throw new Error("canonical cache is missing measured timeline evidence");
	const timeline = fs.readJsonSync(timelinePath) as Array<{
		startMs: number;
		endMs: number;
	}>;
	if (timeline.length !== state.script.lines.length)
		throw new Error(
			"canonical cached timeline does not match script dialogue count",
		);
	for (let index = 0; index < state.script.lines.length; index++) {
		const line = state.script.lines[index];
		const timing = timeline[index];
		if (line && timing) line.duration = (timing.endMs - timing.startMs) / 1000;
	}
}

function buildCanonicalReceiptTrace(
	store: AssetStore,
): Record<string, unknown> {
	const resultPath = path.join(
		store.runDir,
		"episode",
		"production-result.json",
	);
	if (!fs.existsSync(resultPath))
		throw new Error(
			"publish receipt cannot be finalized without canonical production result",
		);
	const result = fs.readJsonSync(resultPath) as CanonicalProductionResult;
	if (!fs.existsSync(result.episode_manifest_path))
		throw new Error(
			"publish receipt cannot be finalized without canonical episode manifest",
		);
	const manifest = fs.readJsonSync(result.episode_manifest_path) as Record<
		string,
		unknown
	>;
	return {
		episode_path: result.episode_path,
		manifest_path: result.episode_manifest_path,
		episode_sha256: manifest.episode_sha256,
		timeline_sha256: manifest.timeline_sha256,
		main_video_path: result.video_path,
		short_video_path: result.short_video_path,
		locale_video_paths: result.locale_video_paths,
		qa_path: result.canonical_qa_path,
		asr_report_path: result.asr_report_path,
	};
}

function invalidateContentArtifacts(store: AssetStore) {
	const paths = [
		path.join(store.runDir, "content", store.cfg.workflow.filenames.output),
		path.join(store.runDir, "metadata.json"),
		path.join(store.runDir, "media", store.cfg.workflow.filenames.output),
		path.join(store.videoDir(), store.cfg.workflow.filenames.video),
		path.join(store.runDir, "episode"),
	];
	for (const targetPath of paths) {
		if (fs.existsSync(targetPath)) fs.removeSync(targetPath);
	}
}

function invalidateMediaArtifacts(store: AssetStore) {
	const mediaDir = path.join(store.runDir, "media");
	const paths = [
		path.join(mediaDir, store.cfg.workflow.filenames.output),
		path.join(mediaDir, "audio", "manifest.json"),
		path.join(mediaDir, "audio"),
		path.join(mediaDir, "thumbnail.png"),
		path.join(mediaDir, "video", store.cfg.workflow.filenames.video),
		path.join(mediaDir, "video"),
		path.join(store.runDir, store.cfg.workflow.filenames.thumbnail),
		path.join(store.runDir, store.cfg.workflow.filenames.subtitles),
		path.join(store.runDir, "episode"),
	];
	for (const targetPath of paths) {
		if (fs.existsSync(targetPath)) fs.removeSync(targetPath);
	}
}
