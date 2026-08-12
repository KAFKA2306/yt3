import path from "node:path";
import dotenv from "dotenv";
import fs from "fs-extra";
import { google } from "googleapis";
import {
	YOUTUBE_PROFILES,
	type YouTubeProfileName,
} from "../domain/youtube_profiles.js";

type Receipt = {
	youtube?: {
		video_id?: string;
		channel_id?: string;
		channel_title?: string;
		privacy_status?: string;
		published_at?: string;
	};
};

type MovieStatus = {
	run_id: string;
	receipt_path: string;
	profile: YouTubeProfileName | "unknown";
	video_id: string;
	public_url?: string;
	status: "public" | "private" | "missing" | "deleted" | "error";
	privacy_status?: string;
	channel_title?: string;
	channel_id?: string;
	published_at?: string;
	details?: string;
};

const ROOT = process.cwd();
const PROFILE_FILTER = process.env.MOVIE_STATUS_PROFILE as
	| YouTubeProfileName
	| undefined;
const BUCKET_FILTER = process.env.MOVIE_STATUS_BUCKET;
const AUTH_CACHE = new Map<
	YouTubeProfileName,
	Promise<InstanceType<typeof google.auth.OAuth2>>
>();

function resolveProfileName(receipt: Receipt): YouTubeProfileName | "unknown" {
	const channelId = receipt.youtube?.channel_id;
	if (channelId === "UCYtjO-PYBfdG3MuPLXfhA-Q") return "byosan";
	if (channelId === "UCMDrWHL4Jc6gtmfoqaW7sxg") return "humanity";
	if (channelId === "UCtq3BVv6SBCFjtPiDoetizw") return "yawa";
	const title = receipt.youtube?.channel_title || "";
	if (title.includes("秒算マネー")) return "byosan";
	if (title.includes("人類観測所")) return "humanity";
	if (title.includes("夜話アーカイブ")) return "yawa";
	return "unknown";
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
	return receipts.sort((a, b) => b.runId.localeCompare(a.runId, "en"));
}

async function loadAuth(profileName: YouTubeProfileName) {
	const cached = AUTH_CACHE.get(profileName);
	if (cached)
		return { profile: YOUTUBE_PROFILES[profileName], auth: await cached };

	const profile = YOUTUBE_PROFILES[profileName];
	const authPromise = (async () => {
		dotenv.config({ path: path.join(ROOT, profile.envFile), override: true });
		const auth = new google.auth.OAuth2(
			process.env.YOUTUBE_CLIENT_ID,
			process.env.YOUTUBE_CLIENT_SECRET,
			process.env.YOUTUBE_REDIRECT_URI ||
				"http://localhost:3000/oauth2callback",
		);
		const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
		if (refreshToken) auth.setCredentials({ refresh_token: refreshToken });
		return auth;
	})();
	AUTH_CACHE.set(profileName, authPromise);
	return { profile, auth: await authPromise };
}

async function inspectOne(
	receiptPath: string,
	runId: string,
): Promise<MovieStatus> {
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
				public_url: videoId
					? `https://www.youtube.com/watch?v=${videoId}`
					: undefined,
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
	const publicUrl = `https://www.youtube.com/watch?v=${videoId}`;
	if (profileName === "unknown") {
		return {
			run_id: runId,
			receipt_path: receiptPath,
			profile: "unknown",
			video_id: videoId,
			public_url: publicUrl,
			status: "error",
			channel_title: receipt.youtube?.channel_title ?? undefined,
			details: "unable to resolve profile from receipt",
		};
	}

	const { auth } = await loadAuth(profileName);
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
			public_url: publicUrl,
			status: "missing",
			channel_title: receipt.youtube?.channel_title ?? undefined,
			details: "video not found on YouTube",
		};
	}

	const privacy = item.status?.privacyStatus || "unknown";
	return {
		run_id: runId,
		receipt_path: receiptPath,
		profile: profileName,
		video_id: videoId,
		public_url: publicUrl,
		status: privacy === "public" ? "public" : "private",
		privacy_status: privacy,
		channel_title: item.snippet?.channelTitle ?? undefined,
		channel_id: item.snippet?.channelId ?? undefined,
		published_at: item.snippet?.publishedAt ?? undefined,
		details: item.snippet?.title ?? undefined,
	};
}

function summarize(items: MovieStatus[]): {
	public: number;
	private: number;
	missing: number;
	deleted: number;
	error: number;
} {
	return items.reduce(
		(acc, item) => {
			acc[item.status] += 1;
			return acc;
		},
		{ public: 0, private: 0, missing: 0, deleted: 0, error: 0 },
	);
}

function formatMarkdown(items: MovieStatus[]): string {
	const counts = summarize(items);
	const lines: string[] = [];
	lines.push("# Movie Status");
	lines.push("");
	lines.push(`Generated: ${new Date().toISOString()}`);
	if (PROFILE_FILTER) lines.push(`Profile filter: \`${PROFILE_FILTER}\``);
	if (BUCKET_FILTER) lines.push(`Bucket filter: \`${BUCKET_FILTER}\``);
	lines.push("");
	lines.push("## Summary");
	lines.push(`- Public: ${counts.public}`);
	lines.push(`- Private: ${counts.private}`);
	lines.push(`- Missing: ${counts.missing}`);
	lines.push(`- Deleted: ${counts.deleted}`);
	lines.push(`- Error: ${counts.error}`);
	lines.push("");
	lines.push("## All Movies");
	for (const item of items) {
		lines.push(`### ${item.run_id}`);
		lines.push(`- Status: \`${item.status}\``);
		lines.push(`- Video ID: \`${item.video_id}\``);
		lines.push(`- Profile: \`${item.profile}\``);
		lines.push(`- Receipt: \`${item.receipt_path}\``);
		if (item.public_url) lines.push(`- URL: \`${item.public_url}\``);
		if (item.privacy_status)
			lines.push(`- Privacy: \`${item.privacy_status}\``);
		if (item.channel_title) lines.push(`- Channel: \`${item.channel_title}\``);
		if (item.channel_id) lines.push(`- Channel ID: \`${item.channel_id}\``);
		if (item.published_at)
			lines.push(`- Published at: \`${item.published_at}\``);
		if (item.details) lines.push(`- Details: \`${item.details}\``);
		if (item.status === "missing") {
			lines.push("- Evidence: receipt exists but YouTube item is missing");
		}
		if (item.status === "private") {
			lines.push("- Evidence: video exists but is not public");
		}
		if (item.status === "public") {
			lines.push("- Evidence: YouTube API reports public");
		}
		lines.push("");
	}
	return lines.join("\n");
}

async function main() {
	const receipts = collectReceipts();
	const items: MovieStatus[] = [];
	for (const { receiptPath, runId } of receipts) {
		items.push(await inspectOne(receiptPath, runId));
	}

	const outDir = path.join(ROOT, "logs");
	await fs.ensureDir(outDir);
	await fs.writeJson(path.join(outDir, "movie_status.json"), items, {
		spaces: 2,
	});
	await fs.writeFile(
		path.join(outDir, "movie_status.md"),
		`${formatMarkdown(items)}\n`,
	);
	console.log(formatMarkdown(items));
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
