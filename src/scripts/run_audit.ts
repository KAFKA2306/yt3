import path from "node:path";
import fs from "fs-extra";
import { AuditAgent } from "../domain/agents/audit.js";
import {
	AssetStore,
	ROOT,
	getRunIdDateString,
	loadConfig,
} from "../io/core.js";
import { AgentLogger } from "../io/utils/logger.js";

import type { AgentState } from "../domain/types.js";

function resolveRunId(arg?: string): string {
	const cfg = loadConfig();
	let domainId = "daily_pulse";
	const bucket = process.env.BUCKET?.trim();
	if (bucket) {
		if (bucket === "humanity_observatory") {
			domainId = "humanity_observatory";
		} else if (bucket === "yawa_archive") {
			domainId = "yawa_archive";
		} else if (bucket === "byosan_money" || bucket === "daily_pulse") {
			domainId = "daily_pulse";
		}
	} else {
		const profileName = process.env.YOUTUBE_CHANNEL_PROFILE?.trim();
		if (profileName) {
			const norm = profileName.toLowerCase();
			if (norm.includes("yawa")) {
				domainId = "yawa_archive";
			} else if (norm.includes("humanity")) {
				domainId = "humanity_observatory";
			}
		} else if (process.env.ENV_FILE?.includes("yawa")) {
			domainId = "yawa_archive";
		} else if (process.env.ENV_FILE?.includes("humanity")) {
			domainId = "humanity_observatory";
		}
	}

	if (!arg || arg === "latest") {
		const domainRunsDir = path.join(
			ROOT,
			cfg.workflow.paths.runs_dir,
			domainId,
		);
		if (fs.existsSync(domainRunsDir)) {
			const rawFiles = fs.readdirSync(domainRunsDir);
			const dirs = rawFiles
				.map((n) => ({ n, p: path.join(domainRunsDir, n) }))
				.filter((d) => fs.statSync(d.p).isDirectory())
				.sort((a, b) => fs.statSync(b.p).mtimeMs - fs.statSync(a.p).mtimeMs);
			if (dirs[0]) return `${domainId}/${dirs[0].n}`;
		}
		return `${domainId}/${getRunIdDateString()}`;
	}

	if (!arg.includes("/")) {
		return `${domainId}/${arg}`;
	}
	return arg;
}

async function main() {
	const runId = resolveRunId(process.argv[2] || process.env.RUN_ID);
	AgentLogger.init();
	const store = new AssetStore(runId);

	console.log(`\n🔍 Starting Zero-Trust Audit for Run: ${runId}`);
	console.log("==================================================\n");

	const state = store.loadState();

	if (!state.run_id || state.run_id === "unknown") {
		state.run_id = runId;
	}

	if (!state.bucket) {
		const parts = runId.split("/");
		state.bucket = parts[0];
	}

	if (!state.generation_dynamics) {
		const dynPath = path.join(store.runDir, "generation_dynamics.json");
		if (fs.existsSync(dynPath)) {
			state.generation_dynamics = fs.readJsonSync(dynPath);
		} else {
			state.generation_dynamics = {
				run_id: runId,
				strategy_genome: {
					intro_type: "unexpected_analogy",
					emotion_curve: ["surprise", "curiosity", "understanding"],
					cadence_profile: "stable_dialogue",
					memory_anchor_type: "metaphor",
					hook_pattern: "cause_effect",
					narrative_weapon: "reframing",
				},
				world_state: {
					macro_anxiety: ["information overload", "predictive friction"],
					market_attention: ["cognitive load", "routine habituation"],
					competition_density: 0.4,
					novelty_supply: 0.6,
				},
				selection_state: {
					expected_attention_gain: 0.7,
					memory_potential: 0.8,
					behavioral_relevance: 0.9,
					saturation_risk: 0.3,
				},
				narrative_state: {
					audience_initial_state: "distracted",
					target_state: "engaged",
					emotion_path: ["curiosity", "understanding", "empathy"],
					prediction_gap_strategy: "delayed payoff",
					memory_anchor: "clumsiness as contour",
				},
				generation_state: {
					strategy: "humanity_observation",
					intro_type: "high_delta_fact",
					cadence_profile: "stable_dialogue",
					anchor_distribution: [10, 30, 60],
					novelty_interval_sec: 15,
				},
				attention_state: {
					predicted_drop_points: [45, 90],
					cognitive_load_curve: [0.2, 0.5, 0.7, 0.4],
					certainty_saturation: 0.5,
					prediction_gap_density: 0.6,
					fatigue_risk: 0.3,
				},
				publish_state: {
					platform: "youtube",
					visibility: "public",
					target_channel: "@humanity_observatory",
					title_length: 50,
					description_length: 150,
				},
				audience_response_state: {
					retention_shape: "early_spike_mid_decay",
					replay_segments: [15, 45],
					comment_semantics: ["unexpected insight", "empathy"],
					behavior_shift: {
						subscribe_rate: 0.05,
						returning_viewer_gain: 0.04,
						session_extension: 1.5,
					},
				},
				evolution_state: {
					strategy_mutation: "none (stabilized variance)",
					cadence_mutation: "none (cadence variance preserved)",
					adaptive_variance_ratio: 0.5,
					exploration_mode_active: false,
				},
			};
		}
	}

	const audit = new AuditAgent(store);
	const results = await audit.run(state as AgentState);

	let failedCritical = false;

	for (const [key, check] of Object.entries(results)) {
		let icon = "❓";
		let statusText = check.status;

		if (check.status === "PASS") icon = "✅";
		else if (check.status === "QUALITY_FAIL") icon = "❌";
		else if (check.status === "INFRA_FAIL") icon = "🔧";
		else if (check.status === "UNVERIFIED") icon = "🔭";

		if (check.critical && check.status !== "PASS") {
			failedCritical = true;
			statusText += " (CRITICAL)";
		}

		console.log(`${icon} [${key.toUpperCase()}] ${check.name}`);
		console.log(`   Description: ${check.description}`);
		if (check.details) console.log(`   Details: ${check.details}`);
		console.log(`   Status: ${statusText}\n`);
	}

	console.log("==================================================");
	if (failedCritical) {
		console.log("🚨 AUDIT FAILED: Critical issues detected.");
		process.exit(1);
	} else {
		console.log("🎉 AUDIT PASSED: Pipeline is healthy.");
		process.exit(0);
	}
}

main().catch((err) => {
	console.error("Audit script failed:", err);
	process.exit(1);
});
