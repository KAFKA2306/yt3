/**
 * test_quota_orchestration.ts
 * Verifies the QuotaManager logic and its integration.
 */

import { QuotaManager } from "../src/io/utils/quota_manager.js";
import { AgentLogger as Logger } from "../src/io/utils/logger.js";

async function test() {
	console.log("--- Starting Quota Orchestration Test ---");

	// 1. Mock environment variables if not present
	if (!process.env.GEMINI_API_KEY_1) process.env.GEMINI_API_KEY_1 = "mock_key_1_AIza...";
	if (!process.env.GEMINI_API_KEY_2) process.env.GEMINI_API_KEY_2 = "mock_key_2_AIza...";

	// 2. Test Acquisition & Stickiness
	console.log("\n[Test 1] Initial Acquisition & Stickiness");
	const sessionA = "run_2026-03-08_A";
	const sessionB = "run_2026-03-08_B";

	const keyA1 = QuotaManager.acquireKey(sessionA);
	console.log(`Session A first key: ${keyA1.name}`);

	const keyA2 = QuotaManager.acquireKey(sessionA);
	console.log(`Session A second key (should be same): ${keyA2.name}`);

	const keyB1 = QuotaManager.acquireKey(sessionB);
	console.log(`Session B first key (should be different or healthy): ${keyB1.name}`);

	// 3. Test Header Updates
	console.log("\n[Test 2] Header Updates");
	QuotaManager.updateFromHeaders(keyA1.name, {
		"x-ratelimit-remaining-requests": "10",
		"x-ratelimit-reset-requests": "30s"
	});
	console.log(`Updated ${keyA1.name} quota via headers.`);

	// 4. Test Cooldown & Rotation
	console.log("\n[Test 3] Cooldown & Automatic Rotation");
	QuotaManager.markCooldown(keyA1.name, 5000); // 5s cooldown
	console.log(`Forced ${keyA1.name} into cooldown.`);

	const keyA3 = QuotaManager.acquireKey(sessionA);
	console.log(`Session A key after cooldown (should rotate): ${keyA3.name}`);

	// 5. Verify Ledger File
	console.log("\n[Test 4] Ledger Persistence");
	const ledger = JSON.parse(require("fs").readFileSync("data/state/llm_quotas.json", "utf-8"));
	console.log("Current Ledger State:", JSON.stringify(ledger, null, 2));

	console.log("\n--- Quota Orchestration Test Complete ---");
}

test().catch(console.error);
