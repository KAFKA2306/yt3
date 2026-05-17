import { AuditAgent } from "../domain/agents/audit.js";
import { AssetStore, getRunIdDateString } from "../io/core.js";
import { AgentLogger } from "../io/utils/logger.js";

import type { AgentState } from "../domain/types.js";

async function main() {
	const runId = process.argv[2] || getRunIdDateString();
	AgentLogger.init();
	const store = new AssetStore(runId);

	console.log(`\n🔍 Starting Zero-Trust Audit for Run: ${runId}`);
	console.log("==================================================\n");

	const state = store.loadState();
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
