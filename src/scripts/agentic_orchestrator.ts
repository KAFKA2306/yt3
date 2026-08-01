import { spawn } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { sendAlert } from "../io/utils/discord.js";
import { AgentLogger } from "../io/utils/logger.js";

const ROOT = process.cwd();

async function runTask(taskName: string): Promise<boolean> {
	AgentLogger.info("SYSTEM", "LOOP", "TASK_START", `Running task: ${taskName}`);
	return new Promise((resolve) => {
		const proc = spawn("task", [taskName], {
			stdio: "inherit",
			env: { ...process.env, FORCE_COLOR: "1" },
		});
		proc.on("close", (code) => {
			if (code === 0) {
				AgentLogger.info(
					"SYSTEM",
					"LOOP",
					"TASK_DONE",
					`Task ${taskName} exited 0 and completed.`,
				);
				resolve(true);
			} else {
				AgentLogger.error(
					"SYSTEM",
					"LOOP",
					"TASK_FAIL",
					`Task ${taskName} failed with code ${code}`,
				);
				resolve(false);
			}
		});
	});
}

async function main() {
	AgentLogger.init();
	AgentLogger.info(
		"SYSTEM",
		"LOOP",
		"START",
		"Starting Unified Unified Unified Loop...",
	);

	// 1. Health Check
	const healthy = await runTask("harness:doctor:quick");
	if (!healthy) {
		const msg =
			"Harness doctor failed. The execution environment is unhealthy.";
		AgentLogger.error("SYSTEM", "LOOP", "BLOCKED", msg);
		await sendAlert(`🚨 **YT3 Health Alert**: ${msg}`, "error");
		console.error(
			`FAILED: ${msg}\nActionable next step: Run 'task harness:doctor:quick' manually and fix configuration/dependencies.`,
		);
		process.exit(1);
	}

	// 2. High-quality daily feature (Byosan Money)
	AgentLogger.info(
		"SYSTEM",
		"LOOP",
		"CHECK",
		"Starting the structured 秒算マネー daily feature loop...",
	);
	const byosanSuccess = await runTask("byosan:daily");

	// 3. Humanity Observatory (Humanity Observatory)
	AgentLogger.info(
		"SYSTEM",
		"LOOP",
		"CHECK",
		"Starting Humanity Observatory workflow...",
	);
	const humanitySuccess = await runTask("run:humanity");

	// 4. Audit
	AgentLogger.info("SYSTEM", "LOOP", "AUDIT", "Running end-of-day audit...");
	const auditSuccess = await runTask("audit:today");

	// Read audit report to verify if today's runs passed
	let auditPassed = false;
	const auditReportJsonPath = path.join(ROOT, "logs", "audit_today.json");
	if (fs.existsSync(auditReportJsonPath)) {
		try {
			const report = fs.readJsonSync(auditReportJsonPath) as {
				reports: Array<{ audit_passed: boolean; evidence_ready: boolean }>;
			};
			// All reports must have audit_passed === true and evidence_ready === true
			auditPassed = report.reports.every(
				(r) => r.audit_passed && r.evidence_ready,
			);
		} catch (e) {
			AgentLogger.error(
				"SYSTEM",
				"LOOP",
				"FAIL",
				`Failed to parse audit_today.json: ${(e as Error).message}`,
			);
		}
	}

	const overallSuccess =
		byosanSuccess && humanitySuccess && auditSuccess && auditPassed;

	if (overallSuccess) {
		AgentLogger.info(
			"SYSTEM",
			"LOOP",
			"FINISH",
			"Unified Agentic Loop completed successfully.",
		);
		process.exit(0);
	} else {
		const failures: string[] = [];
		if (!byosanSuccess) failures.push("byosan:daily task failed");
		if (!humanitySuccess) failures.push("run:humanity task failed");
		if (!auditSuccess) failures.push("audit:today task failed");
		if (!auditPassed)
			failures.push("today's audit checks failed or evidence is not ready");

		const msg = `Unified Agentic Loop failed due to: ${failures.join(", ")}`;
		AgentLogger.error("SYSTEM", "LOOP", "FAIL", msg);

		await sendAlert(`❌ **YT3 Loop Failure**: ${msg}`, "error");

		console.error(`FAILED: ${msg}`);
		console.error("Actionable next steps:");
		console.error(
			"1. Inspect daily logs in logs/daily/ to check task error messages.",
		);
		console.error(
			"2. Run 'task audit:today' or view logs/audit_today.md to see missing files/evidence.",
		);
		console.error(
			"3. Resolve any blockages (e.g. check quotas, API status, or run manually).",
		);

		process.exit(1);
	}
}

main().catch(async (err) => {
	AgentLogger.error("SYSTEM", "LOOP", "CRASH", err.message);
	await sendAlert(
		"🔥 **YT3 Loop Crash**: The meta-orchestrator failed.",
		"error",
		{ message: err.message },
	);
	process.exit(1);
});
