import fs from "fs-extra";
import path from "node:path";
import { glob } from "glob";

const REQUIRED_KEYWORDS = ["EDSA", "芸術", "心理学", "研究", "キャラクター", "ドキュメント"];

async function auditCompliance(runDir: string) {
	const metadataPath = path.join(runDir, "youtube_metadata.md");
	const scriptPath = path.join(runDir, "script_master.md");

	console.log(`Auditing: ${runDir}`);

	if (!(await fs.pathExists(metadataPath))) {
		console.error(`  ❌ Missing youtube_metadata.md`);
		return false;
	}

	const metadata = await fs.readFile(metadataPath, "utf-8");
	const hasEDSA = REQUIRED_KEYWORDS.some((kw) => metadata.includes(kw));

	if (!hasEDSA) {
		console.error(`  ❌ Metadata lacks EDSA context`);
		return false;
	}

	if (await fs.pathExists(scriptPath)) {
		const script = await fs.readFile(scriptPath, "utf-8");
		if (!script.includes("EDSA") && !script.includes("Artistic Intent")) {
			console.warn(`  ⚠️  Script lacks EDSA/Artistic Intent header`);
		}
	}

	console.log(`  ✅ Compliance Passed`);
	return true;
}

async function main() {
	const searchPath = process.argv[2] || "asmr/yawa-archive/**/runs/*";
	const runDirs = await glob(searchPath);

	let total = 0;
	let passed = 0;

	for (const dir of runDirs) {
		if (fs.statSync(dir).isDirectory()) {
			total++;
			if (await auditCompliance(dir)) {
				passed++;
			}
		}
	}

	console.log(`\nAudit Summary: ${passed}/${total} passed`);
	if (passed < total) {
		process.exit(1);
	}
}

main().catch(console.error);
