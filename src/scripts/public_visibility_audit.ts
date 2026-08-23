import path from "node:path";
import fs from "fs-extra";
import { google } from "googleapis";
import {
	createYouTubeOAuthClient,
	getYouTubeProfileForChannel,
	type YouTubeProfileName,
} from "../domain/youtube_profiles.js";
import {
	type YouTubeVisibilityAttestation,
	ensureYouTubeVideoVisibility,
} from "../io/utils/youtube_visibility.js";

type Receipt = {
	youtube?: {
		video_id?: string;
		channel_id?: string;
		channel_title?: string;
		privacy_status?: string;
		published_at?: string;
	};
};

type VisibilityItem = {
	run_id: string;
	receipt_path: string;
	profile: YouTubeProfileName | "unknown";
	video_id: string;
	status: "public" | "updated" | "private" | "missing" | "deleted" | "error";
	privacy_status?: string;
	channel_title?: string;
	details?: string;
	attestation?: YouTubeVisibilityAttestation;
};

const ROOT = process.cwd();
const REPAIR = process.env.PUBLIC_VISIBILITY_REPAIR === "true";
const PROFILE_FILTER = process.env.PUBLIC_VISIBILITY_PROFILE as
	| YouTubeProfileName
	| undefined;
const BUCKET_FILTER = process.env.PUBLIC_VISIBILITY_BUCKET;

function resolveProfileName(receipt: Receipt): YouTubeProfileName | "unknown" {
	return (
		getYouTubeProfileForChannel(
			receipt.youtube?.channel_id,
			receipt.youtube?.channel_title,
		)?.profileName ?? "unknown"
	);
}

function collectReceipts(): Array<{ runId: string; receiptPath: string }> {
	const receipts: Array<{ runId: string; receiptPath: string }> = [];
	const runsRoot = path.join(ROOT, "runs");
	if (!fs.existsSync(runsRoot)) return receipts;
	for (const bucket of fs.readdirSync(runsRoot)) {
		if (BUCKET_FILTER && bucket !== BUCKET_FILTER) continue;
		const bucketDir = path.join(runsRoot, bucket);
		if (!fs.statSync(bucketDir).isDirectory()) continue;
		for (const runName of fs.readdirSync(bucketDir)) {
			const receiptPath = path.join(
				bucketDir,
				runName,
				"publish",
				"receipt.json",
			);
			if (fs.existsSync(receiptPath)) {
				if (PROFILE_FILTER) {
					const receipt = fs.readJsonSync(receiptPath) as Receipt;
					if (resolveProfileName(receipt) !== PROFILE_FILTER) continue;
				}
				receipts.push({
					runId: `${bucket}/${runName}`,
					receiptPath,
				});
			}
		}
	}
	return receipts;
}

async function inspectOne(
	receiptPath: string,
	runId: string,
): Promise<VisibilityItem> {
	const receipt = fs.readJsonSync(receiptPath) as Receipt;
	const videoId = receipt.youtube?.video_id;
	const deletionPath = path.join(
		path.dirname(receiptPath),
		"deletion_attestation.json",
	);
	if (fs.existsSync(deletionPath)) {
		const deletion = fs.readJsonSync(deletionPath) as {
			status?: string;
			deleted_at?: string;
			title?: string;
		};
		if (
			deletion.status === "deleted" ||
			deletion.status === "already_missing"
		) {
			return {
				run_id: runId,
				receipt_path: receiptPath,
				profile: resolveProfileName(receipt),
				video_id: videoId || "",
				status: "deleted",
				channel_title: receipt.youtube?.channel_title ?? undefined,
				details: deletion.deleted_at
					? `fallback deletion attested at ${deletion.deleted_at}`
					: "fallback deletion attested",
			};
		}
	}
	if (!videoId) {
		return {
			run_id: runId,
			receipt_path: receiptPath,
			profile: "unknown",
			video_id: "",
			status: "error",
			details: "missing video_id",
		};
	}

	const profileName = resolveProfileName(receipt);
	if (profileName === "unknown") {
		return {
			run_id: runId,
			receipt_path: receiptPath,
			profile: "unknown",
			video_id: videoId,
			status: "error",
			channel_title: receipt.youtube?.channel_title ?? undefined,
			details: "unable to resolve profile from receipt",
		};
	}

	const { auth } = await createYouTubeOAuthClient(profileName);
	const youtube = google.youtube({ version: "v3", auth });
	const res = await youtube.videos.list({
		part: ["status", "snippet"],
		id: [videoId],
	});
	const item = res.data.items?.[0];
	if (!item) {
		return {
			run_id: runId,
			receipt_path: receiptPath,
			profile: profileName,
			video_id: videoId,
			status: "missing",
			channel_title: receipt.youtube?.channel_title ?? undefined,
			details: "video not found on YouTube",
		};
	}

	const privacy = item.status?.privacyStatus || "unknown";
	if (privacy !== "public" && REPAIR) {
		const attestation = await ensureYouTubeVideoVisibility(
			auth,
			videoId,
			"public",
		);
		return {
			run_id: runId,
			receipt_path: receiptPath,
			profile: profileName,
			video_id: videoId,
			status: "public",
			privacy_status: attestation.current_privacy_status,
			channel_title: item.snippet?.channelTitle ?? undefined,
			attestation,
			details: "repaired to public",
		};
	}

	return {
		run_id: runId,
		receipt_path: receiptPath,
		profile: profileName,
		video_id: videoId,
		status: privacy === "public" ? "public" : "private",
		privacy_status: privacy,
		channel_title: item.snippet?.channelTitle ?? undefined,
		details: item.snippet?.title ?? undefined,
	};
}

function formatMarkdown(items: VisibilityItem[]): string {
	const lines: string[] = [];
	lines.push("# Public Visibility Audit");
	lines.push("");
	lines.push(`Generated: ${new Date().toISOString()}`);
	lines.push(`Repair mode: ${REPAIR ? "enabled" : "disabled"}`);
	if (PROFILE_FILTER) lines.push(`Profile filter: \`${PROFILE_FILTER}\``);
	if (BUCKET_FILTER) lines.push(`Bucket filter: \`${BUCKET_FILTER}\``);
	lines.push("");
	for (const item of items) {
		lines.push(`## ${item.run_id}`);
		lines.push(`- Status: \`${item.status}\``);
		lines.push(`- Video: \`${item.video_id}\``);
		lines.push(`- Profile: \`${item.profile}\``);
		lines.push(`- Receipt: \`${item.receipt_path}\``);
		if (item.privacy_status)
			lines.push(`- Privacy: \`${item.privacy_status}\``);
		if (item.channel_title) lines.push(`- Channel: \`${item.channel_title}\``);
		if (item.details) lines.push(`- Details: \`${item.details}\``);
		if (item.attestation) {
			lines.push(`- Verified at: \`${item.attestation.verified_at}\``);
		}
		lines.push("");
	}
	return lines.join("\n");
}

async function main() {
	const receipts = collectReceipts();
	const items: VisibilityItem[] = [];
	for (const { receiptPath, runId } of receipts) {
		items.push(await inspectOne(receiptPath, runId));
	}
	const outDir = path.join(ROOT, "logs");
	await fs.ensureDir(outDir);
	await fs.writeJson(path.join(outDir, "public_visibility_audit.json"), items, {
		spaces: 2,
	});
	await fs.writeFile(
		path.join(outDir, "public_visibility_audit.md"),
		`${formatMarkdown(items)}\n`,
	);
	console.log(formatMarkdown(items));
	const hasProblems = items.some(
		(item) => item.status !== "public" && item.status !== "deleted",
	);
	if (hasProblems && !REPAIR) {
		process.exit(1);
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
