import path from "node:path";
import fs from "fs-extra";
import { ScriptSmith } from "./agents/content.js";
import { VisualDirector } from "./agents/media.js";
import { PublishAgent } from "./agents/publish.js";
import { TrendScout } from "./agents/research.js";
import { AssetStore, ROOT, loadConfig } from "./core.js";
import { createGraph } from "./graph.js";
import type { AgentState } from "./types.js";
import { sendAlert } from "./utils/discord.js";
const cfg = loadConfig();
function resolveRunId(arg?: string): string {
	if (!arg || arg === "latest") {
		const d = path.join(ROOT, cfg.workflow.paths.runs_dir);
		if (!fs.existsSync(d)) return new Date().toISOString().split("T")[0] || "";
		const rawFiles = fs.readdirSync(d);
		const dirs = rawFiles
			.map((n) => ({ n, p: path.join(d, n) }))
			.filter((d) => fs.statSync(d.p).isDirectory())
			.sort((a, b) => fs.statSync(b.p).mtimeMs - fs.statSync(a.p).mtimeMs);
		const first = dirs[0];
		return first ? first.n : new Date().toISOString().split("T")[0] || "";
	}
	return arg;
}
async function runStep(
	step: string,
	bucket: string,
	store: AssetStore,
	state: Partial<AgentState>,
): Promise<Partial<AgentState>> {
	const researchCfg = store.cfg.steps.research;
	const agents: Record<string, () => Promise<Partial<AgentState>>> = {
		research: () => {
			const b = bucket || state.bucket || store.cfg.workflow.default_bucket;
			const l = state.limit || researchCfg?.default_limit || 3;
			return new TrendScout(store).run(b, l);
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
			};
		},
		publish: async () => ({
			publish_results: await new PublishAgent(store).run(state as AgentState),
		}),
		all: async () => {
			await createGraph(store).invoke({
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
	if (!fn) throw new Error(`Unknown step: ${step}`);
	return fn();
}
async function main() {
	const args = process.argv.slice(2);
	const step = args[0];
	const runIdArg = args[1];
	const bucketArg = args[2];
	if (!step) {
		console.error("Usage: bun src/step.ts <step> [runId] [bucket]");
		process.exit(1);
	}
	const store = new AssetStore(resolveRunId(runIdArg));
	const res = await runStep(step, bucketArg || "", store, store.loadState());
	if (res) store.updateState(res);
}
main();
