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
import type { AssetStore } from "./io/core.js";

import { AgentLogger } from "./io/utils/logger.js";

import { sendAlert } from "./io/utils/discord.js";

/**
 * Sequential Pipeline: Decision-free execution of the video production loop.
 * Each stage produces artifacts and persists state.
 */
export async function runSequentialWorkflow(
	store: AssetStore,
	initialState: Partial<AgentState>,
) {
	let state: AgentState = { ...initialState } as AgentState;
	const dynOrch = new DynamicsOrchestrator(store);
	const dynPath = path.join(store.runDir, "generation_dynamics.json");
	const dynamicsObj: Partial<GenerationDynamics> = fs.existsSync(dynPath)
		? fs.readJsonSync(dynPath)
		: {};

	// 1. Research (Trend discovery)
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
			state.bucket,
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

	// Generate Phase 1 Dynamics: world_state & selection_state
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

	// 2. Script & Metadata (Narrative synthesis)
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
	}

	// Generate Phase 2 Dynamics: narrative_state, generation_state & attention_state
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

	// 3. Media (TTS & Video Rendering)
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

		// Map computed durations to cached script lines to satisfy Quality Audit requirements
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

	// 4. Audit (Strict Zero-Trust Quality Gate)
	// Inject current dynamics into AgentState so AuditAgent can inspect it!
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

	// Save audit/result.json
	fs.writeJsonSync(
		path.join(store.runDir, "audit", "result.json"),
		auditResults,
		{ spaces: 2 },
	);

	// Check Audit PASS/FAIL
	const hasCriticalFailure = Object.values(auditResults).some(
		(r) => r.critical && r.status !== "PASS",
	);
	if (hasCriticalFailure) {
		const failingChecks = Object.values(auditResults)
			.filter((r) => r.critical && r.status !== "PASS")
			.map((r) => r.name);

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

		state.status = "PUBLISH_BLOCKED";
		return state;
	}

	// 5. Publish (Upload to YouTube)
	AgentLogger.info("SYSTEM", "WORKFLOW", "STEP", "Starting Publication...");
	const publisher = new PublishAgent(store);
	const publishResults = await publisher.run(state);
	state = { ...state, publish_results: publishResults };

	// Save publish/receipt.json
	fs.writeJsonSync(
		path.join(store.runDir, "publish", "receipt.json"),
		publishResults,
		{ spaces: 2 },
	);

	// Finalize generation dynamics: publish_state, audience_response_state, evolution_state
	AgentLogger.info(
		"SYSTEM",
		"WORKFLOW",
		"DYNAMICS",
		"Finalizing dynamics & calculating mutations...",
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

	state.status = "SUCCESS";
	return state;
}
