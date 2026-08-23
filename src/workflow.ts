import path from "node:path";
import fs from "fs-extra";
import { AuditAgent } from "./domain/agents/audit.js";
import { ScriptSmith } from "./domain/agents/content.js";
import { type MediaResult, VisualDirector } from "./domain/agents/media.js";
import { PublishAgent } from "./domain/agents/publish.js";
import { TrendScout } from "./domain/agents/research.js";
import { DynamicsOrchestrator } from "./domain/evolution/dynamics_orchestrator.js";
import type {
	AgentState,
	ContentResult,
	GenerationDynamics,
} from "./domain/types.js";
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
	const dynOrch = new DynamicsOrchestrator(store);
	const dynPath = path.join(store.runDir, "generation_dynamics.json");
	const dynamicsObj: Partial<GenerationDynamics> = fs.existsSync(dynPath)
		? fs.readJsonSync(dynPath)
		: {};

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

	if (
		state.director_data &&
		(!dynamicsObj.world_state || !dynamicsObj.selection_state)
	) {
		AgentLogger.info(
			"SYSTEM",
			"WORKFLOW",
			"DYNAMICS",
			"Synthesizing research dynamics...",
		);
		const { world_state, selection_state } =
			await dynOrch.synthesizeResearchDynamics(
				state.news || [],
				state.director_data,
			);
		dynamicsObj.world_state = world_state;
		dynamicsObj.selection_state = selection_state;
		fs.writeJsonSync(dynPath, dynamicsObj, { spaces: 2 });
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

	if (
		state.script &&
		state.metadata &&
		(!dynamicsObj.strategy_genome ||
			!dynamicsObj.narrative_state ||
			!dynamicsObj.generation_state ||
			!dynamicsObj.attention_state)
	) {
		AgentLogger.info(
			"SYSTEM",
			"WORKFLOW",
			"DYNAMICS",
			"Synthesizing narrative dynamics...",
		);
		const {
			strategy_genome,
			narrative_state,
			generation_state,
			attention_state,
		} = await dynOrch.synthesizeNarrativeDynamics(state.script, state.metadata);
		dynamicsObj.strategy_genome = strategy_genome;
		dynamicsObj.narrative_state = narrative_state;
		dynamicsObj.generation_state = generation_state;
		dynamicsObj.attention_state = attention_state;
		fs.writeJsonSync(dynPath, dynamicsObj, { spaces: 2 });
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
	if (fs.existsSync(videoPath) && fs.existsSync(mediaOutputPath)) {
		AgentLogger.info(
			"SYSTEM",
			"WORKFLOW",
			"STEP",
			"Skipping Media Rendering (cached video & media output found)",
		);
		const mediaResults = store.load<MediaResult>("media", "output");
		if (!mediaResults) throw new Error("Failed to load cached media results");
		state = { ...state, ...mediaResults };

		if (state.script && mediaResults.audio_paths) {
			const { execSync } = require("node:child_process");
			for (let i = 0; i < state.script.lines.length; i++) {
				const line = state.script.lines[i];
				const audioPath = mediaResults.audio_paths[i];
				if (line && audioPath && fs.existsSync(audioPath)) {
					try {
						const durationStr = execSync(
							`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
							{ encoding: "utf-8" },
						).trim();
						line.duration = Number.parseFloat(durationStr) || 0;
					} catch {
						line.duration = 0;
					}
				}
			}
		}
	} else {
		AgentLogger.info(
			"SYSTEM",
			"WORKFLOW",
			"STEP",
			"Starting Media Rendering...",
		);
		if (!state.script) throw new Error("Missing script for media rendering");
		const media = new VisualDirector(store);
		const mediaResults = await media.run(
			state.script,
			state.metadata?.title || state.script.title,
			state.metadata?.thumbnail_title,
		);
		state = { ...state, ...mediaResults };
		store.save("media", "output", mediaResults);
	}

	state.generation_dynamics = dynOrch.calculateEvolution(
		dynamicsObj.world_state as NonNullable<typeof dynamicsObj.world_state>,
		dynamicsObj.selection_state as NonNullable<
			typeof dynamicsObj.selection_state
		>,
		dynamicsObj.strategy_genome as NonNullable<
			typeof dynamicsObj.strategy_genome
		>,
		dynamicsObj.narrative_state as NonNullable<
			typeof dynamicsObj.narrative_state
		>,
		dynamicsObj.generation_state as NonNullable<
			typeof dynamicsObj.generation_state
		>,
		dynamicsObj.attention_state as NonNullable<
			typeof dynamicsObj.attention_state
		>,
		undefined,
	);
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
				"regenerate content and media rather than reusing stale artifacts",
				"treat failing audit checks as state invalidation, not just a notification",
				"prime the next loop with the specific failing check names",
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
			],
			artifact_paths: [],
			note: "Publish was blocked by critical audit checks and the content cache was invalidated.",
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
			evidence_paths: [path.join(store.runDir, "state.json")],
			artifact_paths: [],
			failure,
			note: "Publish exception was caught and classified in workflow.ts.",
		});
		if (failure.disposition === "fatal") throw error;
		return state;
	}

	fs.writeJsonSync(
		path.join(store.runDir, "publish", "receipt.json"),
		publishResults,
		{ spaces: 2 },
	);

	const finalDynamics = dynOrch.calculateEvolution(
		dynamicsObj.world_state as NonNullable<typeof dynamicsObj.world_state>,
		dynamicsObj.selection_state as NonNullable<
			typeof dynamicsObj.selection_state
		>,
		dynamicsObj.strategy_genome as NonNullable<
			typeof dynamicsObj.strategy_genome
		>,
		dynamicsObj.narrative_state as NonNullable<
			typeof dynamicsObj.narrative_state
		>,
		dynamicsObj.generation_state as NonNullable<
			typeof dynamicsObj.generation_state
		>,
		dynamicsObj.attention_state as NonNullable<
			typeof dynamicsObj.attention_state
		>,
		state.publish_results,
	);
	fs.writeJsonSync(dynPath, finalDynamics, { spaces: 2 });
	state.generation_dynamics = finalDynamics;
	store.updateState(state);

	appendLoopMemory(store, {
		run_id: state.run_id,
		bucket,
		stage: "publish",
		kind: "success",
		summary:
			"Run completed successfully. Keep the audience framing, title shape, and audit-safe structure that passed this cycle.",
		signals: [
			state.metadata?.title || state.script?.title || "successful publish",
			"audit passed",
			"publish succeeded",
		],
		fixes: [
			"reuse the same audience-fitting angle if the topic family repeats",
			"treat this run as a positive exemplar in future memory context",
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
			path.join(store.runDir, "publish", "state.json"),
			path.join(store.runDir, "publish", "receipt.json"),
		],
		artifact_paths: [state.video_path || ""].filter(Boolean),
		note: "Sequential workflow completed successfully with canonical publication evidence.",
	});
	return state;
}

function invalidateContentArtifacts(store: AssetStore) {
	const paths = [
		path.join(store.runDir, "content", store.cfg.workflow.filenames.output),
		path.join(store.runDir, "metadata.json"),
		path.join(store.runDir, "media", store.cfg.workflow.filenames.output),
		path.join(store.videoDir(), store.cfg.workflow.filenames.video),
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
	];
	for (const targetPath of paths) {
		if (fs.existsSync(targetPath)) fs.removeSync(targetPath);
	}
}
