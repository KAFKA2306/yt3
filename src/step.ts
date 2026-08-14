import path from "node:path";
import fs from "fs-extra";
import { ScriptSmith } from "./domain/agents/content.js";
import { VisualDirector } from "./domain/agents/media.js";
import { PublishAgent } from "./domain/agents/publish.js";
import { TrendScout } from "./domain/agents/research.js";
import type { AgentState } from "./domain/types.js";
import { createGraph } from "./graph.js";
import { AssetStore, ROOT, loadConfig } from "./io/core.js";
import { sendAlert } from "./io/utils/discord.js";
import {
	classifyFailureMessage,
	resolveDailyLogPath,
	writeRunEvidence,
} from "./io/utils/stability.js";

const cfg = loadConfig();

function resolveRunId(arg?: string): string {
	// Map profile to domainId (Zero-Fat mapping)
	let domainId = "daily_pulse";
	const profileName = process.env.YOUTUBE_CHANNEL_PROFILE?.trim();
	if (profileName) {
		const norm = profileName.toLowerCase();
		if (norm.includes("byosan")) {
			domainId = "byosan_money";
		} else if (norm.includes("yawa")) {
			domainId = "yawa_archive";
		} else if (norm.includes("humanity")) {
			domainId = "humanity_observatory";
		}
	} else if (process.env.ENV_FILE?.includes("byosan")) {
		domainId = "byosan_money";
	} else if (process.env.ENV_FILE?.includes("yawa")) {
		domainId = "yawa_archive";
	} else if (process.env.ENV_FILE?.includes("humanity")) {
		domainId = "humanity_observatory";
	}

	if (!arg || arg === "latest") {
		// 1. Try domain-separated runs dir first
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

		// 2. Use current date when no prior run exists.
		return `${domainId}/${new Date().toISOString().split("T")[0]}`;
	}

	// Auto-prefix with domainId if missing slash
	if (!arg.includes("/")) {
		return `${domainId}/${arg}`;
	}
	return arg;
}
import { AuditAgent } from "./domain/agents/audit.js";

async function runStep(
	step: string,
	bucket: string,
	store: AssetStore,
	state: Partial<AgentState>,
	publishVideoPath?: string,
): Promise<Partial<AgentState>> {
	const researchCfg = store.cfg.steps.research;
	const agents: Record<string, () => Promise<Partial<AgentState>>> = {
		research: () => {
			const b = bucket || state.bucket || store.cfg.workflow.default_bucket;
			const l = state.limit || researchCfg?.default_limit || 3;
			return new TrendScout(store).run(b, l, state.mission_file);
		},
		content: () => {
			if (!state.director_data) throw new Error("director_data is missing");
			return new ScriptSmith(store).run(
				state.news || [],
				state.director_data,
				state.memory_context || "",
			);
		},
		media: async () => {
			if (!state.script) throw new Error("script is missing");
			const res = await new VisualDirector(store).run(
				state.script,
				state.metadata?.thumbnail_title || state.script.title || "",
			);
			return {
				audio_paths: res.audio_paths,
				thumbnail_path: res.thumbnail_path,
				video_path: res.video_path,
				script: res.script,
			};
		},
		audit: async () => {
			const results = await new AuditAgent(store).run(state as AgentState);
			return { audit_results: results };
		},
		publish: async () => {
			const runId =
				(state as AgentState).run_id ||
				`${store.domainId}/${path.basename(store.runDir)}`;
			const bucketName =
				(state as AgentState).bucket || bucket || store.domainId;
			try {
				const publish_results = await new PublishAgent(store).run({
					...(state as AgentState),
					publish_video_path: publishVideoPath || state.publish_video_path,
				});
				store.updateState({ publish_results });
				writeRunEvidence(store.runDir, {
					run_id: runId,
					bucket: bucketName,
					status: "SUCCESS",
					disposition: "success",
					log_path: resolveDailyLogPath(runId),
					evidence_paths: [
						path.join(store.runDir, "state.json"),
						path.join(store.runDir, "publish", "receipt.json"),
					],
					artifact_paths: [
						publishVideoPath ||
							state.publish_video_path ||
							state.video_path ||
							"",
					].filter(Boolean),
					note: "Standalone publish step completed successfully with receipt evidence.",
				});
				return { publish_results };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const failure = classifyFailureMessage(message);
				writeRunEvidence(store.runDir, {
					run_id: runId,
					bucket: bucketName,
					status:
						failure.disposition === "blocked"
							? "PUBLISH_BLOCKED"
							: failure.disposition === "retryable"
								? "RETRYABLE"
								: failure.disposition === "pending"
									? "PENDING"
									: "FAILED",
					disposition: failure.disposition,
					log_path: resolveDailyLogPath(runId),
					evidence_paths: [path.join(store.runDir, "state.json")],
					artifact_paths: [
						publishVideoPath ||
							state.publish_video_path ||
							state.video_path ||
							"",
					].filter(Boolean),
					failure,
					note: "Standalone publish step failed and was classified.",
				});
				throw error;
			}
		},
		all: async () => {
			const graph = createGraph(store) as {
				invoke: (s: AgentState) => Promise<AgentState>;
			};
			await graph.invoke({
				run_id: store.runDir.split("/").pop() || "unknown",
				bucket: state.bucket || bucket,
			});
			await sendAlert(
				`Workflow finished: ${state.bucket || "unknown"}`,
				"success",
			);
			return {};
		},
	};
	const fn = agents[step];
	if (!fn) {
		console.log(`Available steps: ${Object.keys(agents).join(", ")}`);
		throw new Error(`Unknown step: ${step}`);
	}
	return fn();
}
async function main() {
	const args = process.argv.slice(2);
	const step = args[0];
	const runIdArg = args[1];
	const bucketArg = args[2];
	const publishVideoPathArg = args[3];
	if (!step) {
		console.error(
			"Usage: bun src/step.ts <step> [runId] [bucket] [publishVideoPath]",
		);
		process.exit(1);
	}
	const store = new AssetStore(resolveRunId(runIdArg));
	const res = await runStep(
		step,
		bucketArg || "",
		store,
		store.loadState(),
		publishVideoPathArg,
	);
	if (res) store.updateState(res);
}
main();
