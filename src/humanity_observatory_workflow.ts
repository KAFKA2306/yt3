import path from "node:path";
import fs from "fs-extra";
import { AuditAgent } from "./domain/agents/audit.js";
import { ScriptSmith } from "./domain/agents/content.js";
import { VisualDirector } from "./domain/agents/media.js";
import { PublishAgent } from "./domain/agents/publish.js";
import { TrendScout } from "./domain/agents/research.js";
import { DynamicsOrchestrator } from "./domain/evolution/dynamics_orchestrator.js";
import type { AgentState, GenerationDynamics } from "./domain/types.js";
import { type AssetStore, ROOT, loadConfig } from "./io/core.js";
import { sendAlert } from "./io/utils/discord.js";
import { AgentLogger } from "./io/utils/logger.js";

/**
 * Humanity Observatory Workflow (v1)
 * High-performance, Zero-Trust media production for the "Humanity Observatory" domain.
 */
export async function runHumanityObservatoryWorkflow(
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
			"HUMANITY_OBSERVATORY",
			"RESEARCH",
			"Using cached research results",
		);
		const researchResults = fs.readJsonSync(researchJsonPath);
		state = { ...state, ...researchResults };
	} else {
		AgentLogger.info(
			"SYSTEM",
			"HUMANITY_OBSERVATORY",
			"RESEARCH",
			"Starting research phase...",
		);
		const scout = new TrendScout(store);
		const researchResults = await scout.run("humanity_observatory", 3);
		state = { ...state, ...researchResults };
		fs.writeJsonSync(researchJsonPath, researchResults, { spaces: 2 });
	}

	// Generate Phase 1 Dynamics: world_state & selection_state
	if (
		state.news &&
		state.director_data &&
		(!dynamicsObj.world_state || !dynamicsObj.selection_state)
	) {
		AgentLogger.info(
			"SYSTEM",
			"HUMANITY_OBSERVATORY",
			"DYNAMICS",
			"Synthesizing research dynamics...",
		);
		const { world_state, selection_state } =
			await dynOrch.synthesizeResearchDynamics(state.news, state.director_data);
		dynamicsObj.world_state = world_state;
		dynamicsObj.selection_state = selection_state;
		fs.writeJsonSync(dynPath, dynamicsObj, { spaces: 2 });
	}

	// 2. Scripting (Narrative construction)
	const contentPath = path.join(store.runDir, "content/output.yaml");
	if (fs.existsSync(contentPath)) {
		AgentLogger.info(
			"SYSTEM",
			"HUMANITY_OBSERVATORY",
			"CONTENT",
			"Using cached script & metadata",
		);
		const contentResults = store.load<AgentState>("content", "output");
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
			"HUMANITY_OBSERVATORY",
			"CONTENT",
			"Writing narrative script...",
		);
		const smith = new ScriptSmith(store);
		const contentResults = await smith.run(
			state.news || [],
			{
				...(state.director_data || {
					angle: "General observation",
					title_hook: "Observation",
					key_questions: [],
					search_query: "",
				}),
				channel_type: "humanity_observatory",
			},
			state.memory_context || "",
		);
		state = {
			...state,
			script: contentResults.script,
			metadata: contentResults.metadata,
		};
		store.save("content", "output", contentResults);
		fs.writeJsonSync(
			path.join(store.runDir, "metadata.json"),
			contentResults.metadata,
			{ spaces: 2 },
		);
	}

	// Generate Phase 2 Dynamics: strategy_genome, narrative_state, generation_state & attention_state
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
			"HUMANITY_OBSERVATORY",
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

	// 3. Media Generation (Quiet Visuals & Whisper TTS)
	const videoPath = path.join(
		store.videoDir(),
		store.cfg.workflow.filenames.video,
	);
	if (fs.existsSync(videoPath)) {
		AgentLogger.info(
			"SYSTEM",
			"HUMANITY_OBSERVATORY",
			"MEDIA",
			"Using cached video",
		);
	} else {
		AgentLogger.info(
			"SYSTEM",
			"HUMANITY_OBSERVATORY",
			"MEDIA",
			"Rendering Quiet Visuals...",
		);
		const director = new VisualDirector(store);
		if (!state.script)
			throw new Error("Script is required for media generation");
		const mediaResults = await director.run(
			state.script,
			state.metadata?.title || "Humanity Observatory",
			state.metadata?.thumbnail_title,
			{ style: "quiet_observation", bucket: "humanity_observatory" },
		);
		state = { ...state, ...mediaResults };
		store.save("media", "output", mediaResults);
	}

	// Generate Phase 3 Dynamics: publish_state, audience_response_state & evolution_state
	if (
		state.video_path &&
		(!dynamicsObj.publish_state ||
			!dynamicsObj.audience_response_state ||
			!dynamicsObj.evolution_state)
	) {
		AgentLogger.info(
			"SYSTEM",
			"HUMANITY_OBSERVATORY",
			"DYNAMICS",
			"Synthesizing evolution dynamics...",
		);
		const dynamics = await dynOrch.synthesizeEvolutionDynamics(state);
		dynamicsObj.publish_state = dynamics.publish_state;
		dynamicsObj.audience_response_state = dynamics.audience_response_state;
		dynamicsObj.evolution_state = dynamics.evolution_state;
		fs.writeJsonSync(dynPath, dynamicsObj, { spaces: 2 });
	}

	// 4. Humanity Quality Audit (Zero-Trust Humanity Audit)
	state.generation_dynamics = dynamicsObj as GenerationDynamics;
	store.updateState(state);

	AgentLogger.info(
		"SYSTEM",
		"HUMANITY_OBSERVATORY",
		"AUDIT",
		"Starting Humanity Quality Audit...",
	);
	const auditor = new AuditAgent(store);
	const auditResults = await auditor.run({
		...state,
		bucket: "humanity_observatory",
	});
	state = { ...state, audit_results: auditResults };

	const hasCriticalFailure = Object.values(auditResults).some(
		(r) => r.critical && r.status !== "PASS",
	);

	if (hasCriticalFailure) {
		AgentLogger.error(
			"SYSTEM",
			"HUMANITY_OBSERVATORY",
			"BLOCK",
			"Humanity Audit Failed",
		);
		await sendAlert(
			`🚨 **Humanity Audit Blocked** run \`${state.run_id}\``,
			"audit_fail",
		);
		state.status = "PUBLISH_BLOCKED";
		return state;
	}

	// 5. Publish Gate (Human-in-the-Loop)
	AgentLogger.info(
		"SYSTEM",
		"HUMANITY_OBSERVATORY",
		"PUBLISH",
		"Publish Gate: Passing through semi-autonomous pipeline...",
	);

	const publisher = new PublishAgent(store);
	const publishResults = await publisher.run(state);
	state = { ...state, publish_results: publishResults };

	AgentLogger.info(
		"SYSTEM",
		"HUMANITY_OBSERVATORY",
		"SUCCESS",
		"Workflow completed!",
	);
	state.status = "SUCCESS";
	return state;
}
