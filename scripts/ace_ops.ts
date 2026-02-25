import path from "node:path";
import { AceAcquirer } from "../src/ace/ace_acquirer.js";
import { AceEvaluator } from "../src/ace/ace_evaluator.js";
import { AceEvolver } from "../src/ace/ace_evolver.js";
import { ContextPlaybook } from "../src/ace/context_playbook.js";
import { ROOT, loadConfig } from "../src/core.js";
async function main() {
	const args = process.argv.slice(2);
	const command = args[0];
	const cfg = loadConfig();
	const logPath = path.isAbsolute(cfg.logging.activity_log_file)
		? cfg.logging.activity_log_file
		: path.join(ROOT, cfg.logging.activity_log_file);
	const playbook = new ContextPlaybook();
	const evaluator = new AceEvaluator();
	const evolver = new AceEvolver();
	const acquirer = new AceAcquirer();
	switch (command) {
		case "evaluate": {
			const currentBullets = playbook.load().bullets.map((b) => b.id);
			const signals = await evaluator.evaluateLatestLogs(
				logPath,
				currentBullets,
			);
			console.log(JSON.stringify(signals, null, 2));
			if (signals.length > 0) {
				await evolver.evolve(signals);
			}
			break;
		}
		case "evolve": {
			console.log("Playbook evolved based on latest signals.");
			break;
		}
		case "acquire": {
			const hypotheses = await acquirer.acquireNewHypotheses();
			await acquirer.commitHypothesesToPlaybook(hypotheses);
			console.log(`Acquired ${hypotheses.length} new hypotheses.`);
			break;
		}
		default:
			console.log("Usage: bun scripts/ace_ops.ts [evaluate|evolve|acquire]");
	}
}
main().catch(console.error);
