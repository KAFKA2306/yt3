import { execSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";

const PROGRESS_FILE = "asmr/yawa-archive/MASTER_PROGRESS.md";

async function main() {
	if (!fs.existsSync(PROGRESS_FILE)) {
		console.error(`Progress file not found: ${PROGRESS_FILE}`);
		process.exit(1);
	}

	const content = fs.readFileSync(PROGRESS_FILE, "utf-8");
	const lines = content.split("\n");
	const newLines = [...lines];

	console.log("🚀 Starting ASMR Batch Publication...");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		// Match table rows: | Project | Script | Video | YT | Path |
		// Status: ⏳ (Pending), ✅ (Done)
		if (line.includes("|") && line.includes("⏳")) {
			const parts = line.split("|").map((p) => p.trim());
			if (parts.length < 6) continue;

			const projectName = parts[1]?.replace(/\*\*/g, "");
			const archivePath = parts[5]?.replace(/`/g, "");
			if (!projectName || !archivePath) continue;

			if (!archivePath || !fs.existsSync(archivePath)) {
				console.warn(
					`[SKIP] Path not found for ${projectName}: ${archivePath}`,
				);
				continue;
			}

			console.log(`\n📦 Publishing project: ${projectName}`);
			console.log(`📂 Path: ${archivePath}`);

			try {
				// AssetStore expects runId relative to runs_dir.
				// Archive path is like "asmr/yawa-archive/amaoto-shelter/runs/2026-05-10/"
				// Relative from "runs/" it is "../asmr/yawa-archive/..."
				const runId = path.join("..", archivePath);

				console.log(`▶️ Executing: task publish:yawa RUN_ID="${runId}"`);

				// Use spawnSync or execSync. We want to wait for each.
				execSync(`task publish:yawa RUN_ID="${runId}"`, { stdio: "inherit" });

				console.log(`✅ Successfully published: ${projectName}`);

				// Update status in the line
				newLines[i] = line.replace("⏳", "✅ Done");

				// Write back immediately to prevent data loss if crash
				fs.writeFileSync(PROGRESS_FILE, newLines.join("\n"));
			} catch (error) {
				console.error(`❌ Failed to publish ${projectName}:`, error);
				// Continue to next
			}
		}
	}

	console.log("\n✨ Batch Publication Finished.");
}

main().catch(console.error);
