import { readFile } from "node:fs/promises";
import path from "node:path";
import { auditExperienceOssCandidateRegistry } from "../domain/experience/oss_candidate_registry.js";

const REGISTRY_PATH = "config/channels/byosan/oss-candidates.json";

export async function auditExperienceOssCandidates(
	root = process.cwd(),
): Promise<void> {
	const registry = JSON.parse(
		await readFile(path.resolve(root, REGISTRY_PATH), "utf8"),
	);
	const report = await auditExperienceOssCandidateRegistry(registry, root);
	console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) await auditExperienceOssCandidates();
