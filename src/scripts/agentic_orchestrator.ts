import { spawn } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { sendAlert } from "../io/utils/discord.js";
import { AgentLogger } from "../io/utils/logger.js";

async function runTask(taskName: string): Promise<boolean> {
	AgentLogger.info("SYSTEM", "LOOP", "TASK_START", `Running task: ${taskName}`);
	return new Promise((resolve) => {
		const proc = spawn("task", [taskName], {
			stdio: "inherit",
			env: { ...process.env, FORCE_COLOR: "1" },
		});
		proc.on("close", (code) => {
			const ok = code === 0;
			const message = `Task ${taskName} exited ${code ?? "null"}.`;
			if (ok) AgentLogger.info("SYSTEM", "LOOP", "TASK_DONE", message);
			else AgentLogger.error("SYSTEM", "LOOP", "TASK_FAIL", message);
			resolve(ok);
		});
	});
}

function auditPassed(): boolean {
	const reportPath = path.join(process.cwd(), "logs", "audit_today.json");
	if (!fs.existsSync(reportPath)) return false;
	try {
		const report = fs.readJsonSync(reportPath) as {
			reports?: Array<{ audit_passed: boolean; evidence_ready: boolean }>;
		};
		return Boolean(
			report.reports?.length &&
				report.reports.every((item) => item.audit_passed && item.evidence_ready),
		);
	} catch {
		return false;
	}
}

async function main() {
	AgentLogger.init();
	const results = new Map<string, boolean>();
	for (const taskName of ["byosan:daily", "run:humanity", "audit:today"]) {
		results.set(taskName, await runTask(taskName));
	}

	const failures = [...results]
		.filter(([, ok]) => !ok)
		.map(([taskName]) => `${taskName} failed`);
	if (!auditPassed()) failures.push("audit evidence is not ready");

	if (failures.length === 0) {
		AgentLogger.info("SYSTEM", "LOOP", "FINISH", "Daily loop completed.");
		return;
	}

	const message = `Daily loop failed: ${failures.join(", ")}`;
	AgentLogger.error("SYSTEM", "LOOP", "FAIL", message);
	await sendAlert(`❌ **YT3 Loop Failure**: ${message}`, "error");
	process.exit(1);
}

main().catch(async (error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	AgentLogger.error("SYSTEM", "LOOP", "CRASH", message);
	await sendAlert("🔥 **YT3 Loop Crash**", "error", { message });
	process.exit(1);
});
