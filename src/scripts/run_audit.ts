import { AssetStore, getRunIdDateString } from "../io/core.js";
import { AuditAgent } from "../domain/agents/audit.js";
import { AgentLogger } from "../io/utils/logger.js";

async function main() {
    const runId = process.argv[2] || getRunIdDateString();
    AgentLogger.init();
    const store = new AssetStore(runId);
    
    console.log(`\n🔍 Starting Zero-Trust Audit for Run: ${runId}`);
    console.log("==================================================\n");

    const state = store.loadState();
    const audit = new AuditAgent(store);
    const results = await audit.run(state as any);

    let failedCritical = false;
    
    for (const [key, check] of Object.entries(results)) {
        const icon = check.passed ? "✅" : (check.critical ? "❌" : "⚠️");
        const status = check.passed ? "PASSED" : (check.critical ? "FAILED (CRITICAL)" : "WARNING");
        
        console.log(`${icon} [${key.toUpperCase()}] ${check.name}`);
        console.log(`   Description: ${check.description}`);
        if (check.details) console.log(`   Details: ${check.details}`);
        console.log(`   Status: ${status}\n`);

        if (!check.passed && check.critical) failedCritical = true;
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

main().catch(err => {
    console.error("Audit script failed:", err);
    process.exit(1);
});
