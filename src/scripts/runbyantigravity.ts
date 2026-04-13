import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../io/core.js";

const cfg = loadConfig();
function generateRunId(): string {
	const date = new Date().toISOString().split("T")[0];
	return `run_${date}_antigravity`;
}
function ensureRunDirs(runId: string) {
	const base = path.join(cfg.workflow.paths.runs_dir, runId);
	const sub = ["research", "content", "media", "video", "publish"];
	fs.mkdirSync(base, { recursive: true });
	for (const s of sub) {
		fs.mkdirSync(path.join(base, s), { recursive: true });
	}
	return base;
}
function envCheck() {
	const nodeVer = execSync("node -v").toString().trim();
	if (!nodeVer.startsWith("v20") && !nodeVer.startsWith("v22"))
		throw new Error("Node >=20 required");
	const pkgList = execSync("npm list typescript tsx").toString();
	if (!pkgList.includes("typescript") || !pkgList.includes("tsx"))
		throw new Error("Missing deps");
}
function runStep(step: string, runId: string, bucket = "") {
	execSync(`bun src/step.ts ${step} ${runId} ${bucket}`, { stdio: "inherit" });
}
function main() {
	envCheck();
	const runId = generateRunId();
	ensureRunDirs(runId);
	runStep("research", runId);
	runStep("content", runId);
	runStep("media", runId);
	runStep("publish", runId);
	execSync("npx tsx scripts/generate_thumb_manual.ts", { stdio: "inherit" });
}
main();
