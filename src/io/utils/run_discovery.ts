import path from "node:path";
import fs from "fs-extra";

export function isCanonicalActiveRunDir(runDir: string): boolean {
	const statePath = path.join(runDir, "state.json");
	if (!fs.existsSync(statePath)) return false;
	try {
		const state = fs.readJsonSync(statePath) as {
			run_id?: unknown;
			bucket?: unknown;
		};
		return (
			typeof state.run_id === "string" &&
			state.run_id.length > 0 &&
			typeof state.bucket === "string" &&
			state.bucket.length > 0
		);
	} catch {
		return false;
	}
}

export function isCanonicalActiveRunId(root: string, runId: string): boolean {
	if (!runId.includes("/")) return false;
	return isCanonicalActiveRunDir(path.join(root, "runs", runId));
}
