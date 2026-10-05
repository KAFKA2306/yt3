import { readFile } from "node:fs/promises";
import path from "node:path";
import { auditExperienceOssCandidateRegistry } from "../domain/experience/oss_candidate_registry.js";

const REGISTRY_PATH = "config/channels/byosan/oss-candidates.json";

export async function auditExperienceOssCandidates(
	root = process.cwd(),
): Promise<number> {
	try {
		const registry = JSON.parse(
			await readFile(path.resolve(root, REGISTRY_PATH), "utf8"),
		);
		const report = await auditExperienceOssCandidateRegistry(registry, root);
		console.log(JSON.stringify(report, null, 2));
		return 0;
	} catch (error) {
		console.error(
			JSON.stringify(
				{
					status: "FAIL",
					message: error instanceof Error ? error.message : String(error),
				},
				null,
				2,
			),
		);
		return 1;
	}
}

if (import.meta.main) process.exitCode = await auditExperienceOssCandidates();
