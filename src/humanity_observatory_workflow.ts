import path from "node:path";
import fs from "fs-extra";
import { AuditAgent } from "./domain/agents/audit.js";
import { ScriptSmith } from "./domain/agents/content.js";
import { type MediaResult, VisualDirector } from "./domain/agents/media.js";
import { PublishAgent } from "./domain/agents/publish.js";
import { TrendScout } from "./domain/agents/research.js";
import type { AgentState } from "./domain/types.js";
import { type AssetStore, ROOT, loadConfig } from "./io/core.js";
import { sendAlert } from "./io/utils/discord.js";
import { AgentLogger } from "./io/utils/logger.js";
import {
	classifyFailureMessage,
	resolveDailyLogPath,
	writeRunEvidence,
} from "./io/utils/stability.js";

/**
 * Humanity Observatory Workflow (v1)
 * High-performance, Zero-Trust media production for the "Humanity Observatory" domain.
 */
const HUMANITY_MEDIA_VERSION = "humanity-scenes-v1";

export async function runHumanityObservatoryWorkflow(
	store: AssetStore,
	initialState: Partial<AgentState>,
) {
	let state: AgentState = { ...initialState } as AgentState;

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
		const researchResults = await scout.run(
			"humanity_observatory",
			3,
			state.mission_file,
		);
		state = { ...state, ...researchResults };
		fs.writeJsonSync(researchJsonPath, researchResults, { spaces: 2 });
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

	// 3. Media Generation (Quiet Visuals & Whisper TTS)
	const videoPath = path.join(
		store.videoDir(),
		store.cfg.workflow.filenames.video,
	);
	const cachedMediaResults = fs.existsSync(videoPath)
		? store.load<MediaResult>("media", "output")
		: null;
	if (cachedMediaResults?.asset_version === HUMANITY_MEDIA_VERSION) {
		AgentLogger.info(
			"SYSTEM",
			"HUMANITY_OBSERVATORY",
			"MEDIA",
			"Using cached video",
		);
		state = { ...state, ...cachedMediaResults };

		// Map computed durations to cached script lines to satisfy Quality Audit requirements
		if (state.script && cachedMediaResults.audio_paths) {
			const { execSync } = require("node:child_process");
			for (let i = 0; i < state.script.lines.length; i++) {
				const line = state.script.lines[i];
				const audioPath = cachedMediaResults.audio_paths[i];
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
		if (fs.existsSync(videoPath)) {
			AgentLogger.info(
				"SYSTEM",
				"HUMANITY_OBSERVATORY",
				"MEDIA",
				"Cached video is stale for the current scene set; regenerating",
			);
		}
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

	// 4. Humanity Quality Audit (Zero-Trust Humanity Audit)
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
		writeRunEvidence(store.runDir, {
			run_id: state.run_id,
			bucket: state.bucket || "humanity_observatory",
			status: state.status,
			disposition: "blocked",
			log_path: resolveDailyLogPath(state.run_id),
			evidence_paths: [
				path.join(store.runDir, "state.json"),
				path.join(store.runDir, "audit", "result.json"),
			],
			artifact_paths: [],
			note: "Humanity audit blocked publish and evidence was written.",
		});
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
	try {
		const publishResults = await publisher.run(state);
		state = { ...state, publish_results: publishResults };
	} catch (err) {
		const error = err as Error;
		const failure = classifyFailureMessage(error.message);
		AgentLogger.warn(
			"SYSTEM",
			"HUMANITY_OBSERVATORY",
			"PUBLISH_FAILURE",
			`Publish step classified as ${failure.disposition}: ${error.message}`,
		);
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
			bucket: state.bucket || "humanity_observatory",
			status: state.status,
			disposition: failure.disposition,
			log_path: resolveDailyLogPath(state.run_id),
			evidence_paths: [path.join(store.runDir, "state.json")],
			artifact_paths: [],
			failure,
			note: "Humanity publish exception was caught and classified in the workflow.",
		});
		if (failure.disposition === "fatal") {
			throw error;
		}
		return state;
	}

	AgentLogger.info(
		"SYSTEM",
		"HUMANITY_OBSERVATORY",
		"SUCCESS",
		"Workflow completed!",
	);
	state.status = "SUCCESS";
	writeRunEvidence(store.runDir, {
		run_id: state.run_id,
		bucket: state.bucket || "humanity_observatory",
		status: state.status,
		disposition: "success",
		log_path: resolveDailyLogPath(state.run_id),
		evidence_paths: [
			path.join(store.runDir, "state.json"),
			path.join(store.runDir, "publish", "receipt.json"),
		],
		artifact_paths: [state.video_path || ""].filter(Boolean),
		note: "Humanity workflow completed successfully with state evidence.",
	});
	return state;
}
