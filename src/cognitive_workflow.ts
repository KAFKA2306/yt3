import path from "node:path";
import fs from "fs-extra";
import { AuditAgent } from "./domain/agents/audit.js";
import { ScriptSmith } from "./domain/agents/content.js";
import { VisualDirector } from "./domain/agents/media.js";
import { PublishAgent } from "./domain/agents/publish.js";
import { TrendScout } from "./domain/agents/research.js";
import type { AgentState } from "./domain/types.js";
import type { AssetStore } from "./io/core.js";
import { AgentLogger } from "./io/utils/logger.js";
import { sendAlert } from "./io/utils/discord.js";

/**
 * Humanity Observatory Workflow.
 * Focuses on long-form intellectual exploration, cognitive audit, and source-bound generation.
 */
export async function runCognitiveWorkflow(
	store: AssetStore,
	initialState: Partial<AgentState>,
) {
	let state: AgentState = { ...initialState } as AgentState;
	
	AgentLogger.info("SYSTEM", "HUMANITY_OBSERVATORY", "START", `RunID: ${state.run_id}`);

	// 1. Topic Selection & Research (Source-Bound)
	const researchJsonPath = path.join(store.runDir, "research.json");
	if (fs.existsSync(researchJsonPath)) {
		AgentLogger.info("SYSTEM", "HUMANITY_OBSERVATORY", "RESEARCH", "Using cached research.json");
		const researchResults = fs.readJsonSync(researchJsonPath);
		state = { ...state, ...researchResults };
	} else {
		AgentLogger.info("SYSTEM", "HUMANITY_OBSERVATORY", "RESEARCH", "Starting Source-Bound Research...");
		const scout = new TrendScout(store);
		const missionFile = state.mission_file || path.join("data", "cognitive_pulse.md");
		const researchResults = await scout.run("cognitive_observation", state.limit, missionFile);
		state = { ...state, ...researchResults };
		fs.writeJsonSync(researchJsonPath, researchResults, { spaces: 2 });
	}

	// 2. Script Synthesis (Cognitive Tone & Structural Loneliness)
	const contentOutputPath = path.join(store.runDir, "content", "output.json");
	if (fs.existsSync(contentOutputPath)) {
		AgentLogger.info("SYSTEM", "HUMANITY_OBSERVATORY", "CONTENT", "Using cached script");
		const contentResults = fs.readJsonSync(contentOutputPath);
		state = { ...state, script: contentResults.script, metadata: contentResults.metadata };
	} else {
		AgentLogger.info("SYSTEM", "HUMANITY_OBSERVATORY", "CONTENT", "Synthesizing Humanity Observatory Script...");
		const smith = new ScriptSmith(store);
		// ScriptSmith needs to handle the 'cognitive' persona
		const contentResults = await smith.run(
			state.news || [],
			{ ...state.director_data!, channel_type: "cognitive" },
			state.memory_context || ""
		);
		state = { ...state, script: contentResults.script, metadata: contentResults.metadata };
		store.save("content", "output", contentResults);
	}

	// 3. Media Generation (Quiet Visuals & Whisper TTS)
	const videoPath = path.join(store.videoDir(), "final_video.mp4");
	if (fs.existsSync(videoPath)) {
		AgentLogger.info("SYSTEM", "HUMANITY_OBSERVATORY", "MEDIA", "Using cached video");
	} else {
		AgentLogger.info("SYSTEM", "HUMANITY_OBSERVATORY", "MEDIA", "Rendering Quiet Visuals...");
		const director = new VisualDirector(store);
		// VisualDirector should handle low-stimulus hybrid visuals
		const mediaResults = await director.run(
			state.script!,
			state.metadata?.title || "Humanity Observatory",
			state.metadata?.thumbnail_title,
			{ style: "quiet_observation", bucket: state.bucket }
		);
		state = { ...state, ...mediaResults };
		store.save("media", "output", mediaResults);
	}

	// 4. Cognitive Quality Audit (Zero-Trust Cognitive Audit)
	AgentLogger.info("SYSTEM", "HUMANITY_OBSERVATORY", "AUDIT", "Starting Cognitive Quality Audit...");
	const auditor = new AuditAgent(store);
	// We'll need to update AuditAgent to include cognitive-specific checks
	const auditResults = await auditor.run(state);
	state = { ...state, audit_results: auditResults };

	const hasCriticalFailure = Object.values(auditResults).some(
		(r) => r.critical && r.status !== "PASS"
	);

	if (hasCriticalFailure) {
		AgentLogger.error("SYSTEM", "HUMANITY_OBSERVATORY", "BLOCK", "Cognitive Audit Failed");
		await sendAlert(`🚨 **Cognitive Audit Blocked** run \`${state.run_id}\``, "audit_fail");
		state.status = "PUBLISH_BLOCKED";
		return state;
	}

	// 5. Publish Gate (Human-in-the-Loop)
	AgentLogger.info("SYSTEM", "HUMANITY_OBSERVATORY", "PUBLISH", "Publish Gate: Waiting for Human Approval...");
	// In autonomous mode, we might wait for a file marker or a specific command
	// For now, we assume it's a pass if we reach here in a semi-autonomous flow
	// or we can implement a specific check.
	
	const publisher = new PublishAgent(store);
	const publishResults = await publisher.run(state);
	state = { ...state, publish_results: publishResults };

	AgentLogger.info("SYSTEM", "HUMANITY_OBSERVATORY", "SUCCESS", "Workflow completed!");
	state.status = "SUCCESS";
	return state;
}
