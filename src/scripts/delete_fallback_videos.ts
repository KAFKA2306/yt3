import path from "node:path";
import dotenv from "dotenv";
import fs from "fs-extra";
import { google } from "googleapis";

type FallbackDeletion = {
	run_id: string;
	video_id: string;
	title: string;
	receipt_path: string;
	attestation_path: string;
	status: "deleted" | "already_missing" | "error";
	deleted_at: string;
	error?: string;
};

const ROOT = process.cwd();
const TARGET_TITLE = "Fallback Daily Pulse";

function collectTargets(): FallbackDeletion[] {
	const runsRoot = path.join(ROOT, "runs", "pulse_nlm");
	if (!fs.existsSync(runsRoot)) return [];
	const targets: FallbackDeletion[] = [];
	for (const runName of fs.readdirSync(runsRoot)) {
		const runDir = path.join(runsRoot, runName);
		if (!fs.statSync(runDir).isDirectory()) continue;
		const receiptPath = path.join(runDir, "publish", "receipt.json");
		const visibilityPath = path.join(
			runDir,
			"publish",
			"visibility_attestation.json",
		);
		if (!fs.existsSync(receiptPath) || !fs.existsSync(visibilityPath)) continue;
		const receipt = fs.readJsonSync(receiptPath) as {
			youtube?: { video_id?: string; channel_title?: string };
		};
		const visibility = fs.readJsonSync(visibilityPath) as {
			title?: string;
		};
		const videoId = receipt.youtube?.video_id;
		if (!videoId || visibility.title !== TARGET_TITLE) continue;
		targets.push({
			run_id: `pulse_nlm/${runName}`,
			video_id: videoId,
			title: visibility.title,
			receipt_path: receiptPath,
			attestation_path: path.join(
				runDir,
				"publish",
				"deletion_attestation.json",
			),
			status: "deleted",
			deleted_at: new Date().toISOString(),
		});
	}
	return targets.sort((a, b) => a.run_id.localeCompare(b.run_id, "en"));
}

async function createYouTubeClient() {
	dotenv.config({
		path: path.join(ROOT, "config/.env.byosan"),
		override: true,
	});
	const auth = new google.auth.OAuth2(
		process.env.YOUTUBE_CLIENT_ID,
		process.env.YOUTUBE_CLIENT_SECRET,
		process.env.YOUTUBE_REDIRECT_URI || "http://localhost:3000/oauth2callback",
	);
	const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
	if (!refreshToken) {
		throw new Error("YOUTUBE_REFRESH_TOKEN is required to delete videos");
	}
	auth.setCredentials({ refresh_token: refreshToken });
	return google.youtube({ version: "v3", auth });
}

async function deleteTarget(
	youtube: ReturnType<typeof google.youtube>,
	target: FallbackDeletion,
): Promise<FallbackDeletion> {
	const deletedAt = new Date().toISOString();
	try {
		await youtube.videos.delete({ id: target.video_id });
		return { ...target, status: "deleted", deleted_at: deletedAt };
	} catch (error) {
		const err = error as { code?: number; message?: string };
		if (err.code === 404) {
			return { ...target, status: "already_missing", deleted_at: deletedAt };
		}
		return {
			...target,
			status: "error",
			deleted_at: deletedAt,
			error: err.message || String(error),
		};
	}
}

async function main() {
	const targets = collectTargets();
	const youtube = await createYouTubeClient();
	const results: FallbackDeletion[] = [];
	for (const target of targets) {
		const result = await deleteTarget(youtube, target);
		results.push(result);
		await fs.writeJson(result.attestation_path, result, { spaces: 2 });
	}

	const outDir = path.join(ROOT, "logs");
	await fs.ensureDir(outDir);
	await fs.writeJson(
		path.join(outDir, "fallback_video_deletion.json"),
		results,
		{
			spaces: 2,
		},
	);
	console.log(JSON.stringify(results, null, 2));

	if (results.some((item) => item.status === "error")) {
		process.exit(1);
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
