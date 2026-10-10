import { spawn } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import {
	parsePublishJobFile,
	publishJobFingerprint,
	readUploadIntent,
	readVerifiedReceipt,
} from "../domain/publish_contract.js";
import { getYouTubeProfile } from "../domain/youtube_profiles.js";
import { loadConfig } from "../io/core.js";

function runIdForJob(job: ReturnType<typeof parsePublishJobFile>): string {
	if (job.run_id.includes("/")) {
		if (!job.run_id.startsWith(`${job.bucket}/`)) {
			throw new Error(
				`Publish job run_id must belong to bucket '${job.bucket}': ${job.run_id}`,
			);
		}
		return job.run_id;
	}
	return `${job.bucket}/${job.run_id}`;
}

function envFileForProfile(
	profile: ReturnType<typeof getYouTubeProfile>,
): string {
	return profile.envFile;
}

async function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: process.cwd(),
			env,
			stdio: "inherit",
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`${command} exited with ${code ?? "null"}`));
		});
	});
}

async function main() {
	const jobArg = process.argv.find((arg) => arg.startsWith("--job="));
	const jobPath = jobArg?.slice("--job=".length) || process.argv[2];
	if (!jobPath) {
		throw new Error(
			"Usage: bun src/scripts/publish_job.ts --job=<publish-job.yaml>",
		);
	}

	const job = parsePublishJobFile(jobPath);
	const profile = getYouTubeProfile(job.profile);
	if (job.bucket !== profile.bucket) {
		throw new Error(
			`Publish job profile/bucket mismatch: profile='${job.profile}' expects '${profile.bucket}' but job has '${job.bucket}'`,
		);
	}
	if (job.target_visibility !== "private" && !job.allow_publicize) {
		throw new Error(
			"Publish job must explicitly set allow_publicize=true for a non-private target",
		);
	}

	const runId = runIdForJob(job);
	const cfg = loadConfig(job.bucket);
	const runIdPart = runId.split("/").pop();
	if (!runIdPart) throw new Error(`Invalid publish job run_id: ${runId}`);
	const runDir = path.join(
		process.cwd(),
		cfg.workflow.paths.runs_dir,
		job.bucket,
		runIdPart,
	);
	const fingerprint = publishJobFingerprint(job);
	const receipt = readVerifiedReceipt(runDir);
	const intent = readUploadIntent(runDir);
	if (receipt) {
		if (receipt.job_fingerprint !== fingerprint) {
			throw new Error(
				`Publish receipt fingerprint mismatch: receipt='${receipt.job_fingerprint}' job='${fingerprint}'`,
			);
		}
		console.log(
			"Existing verified receipt found; running remote read-back audit without videos.insert.",
		);
	} else if (intent) {
		throw new Error(
			`UNCERTAIN_REMOTE_COMMIT: ${intent.job_fingerprint} has upload intent but no verified receipt; videos.insert is forbidden`,
		);
	}

	const childEnv: NodeJS.ProcessEnv = {
		...process.env,
		ENV_FILE: envFileForProfile(profile),
		YOUTUBE_CHANNEL_PROFILE: job.profile,
		BUCKET: job.bucket,
		RUN_ID: runId,
		YOUTUBE_PUBLISH_JOB_PATH: path.resolve(jobPath),
	};
	if (job.mission_file) childEnv.MISSION_FILE = path.resolve(job.mission_file);
	if (job.target_visibility !== "private")
		childEnv.YOUTUBE_ALLOW_PUBLICIZE = "true";
	else childEnv.YOUTUBE_ALLOW_PUBLICIZE = undefined;

	if (receipt) {
		await run("bun", ["src/step.ts", "publish", runId], childEnv);
	} else {
		await run("task", ["run"], childEnv);
	}

	const verified = readVerifiedReceipt(runDir);
	if (!verified || verified.job_fingerprint !== fingerprint) {
		throw new Error(
			`PUBLISH_RESULT=FAIL: verified receipt missing or fingerprint mismatch at ${path.join(runDir, "publish", "receipt.json")}`,
		);
	}
	console.log("PUBLISH_RESULT=PASS");
	console.log(`JOB_FINGERPRINT=${fingerprint}`);
	console.log(`RUN_ID=${runId}`);
	console.log(`VIDEO_ID=${verified.youtube.video_id}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	console.error("PUBLISH_RESULT=FAIL");
	process.exit(1);
});
