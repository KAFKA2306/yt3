import path from "node:path";
import fs from "fs-extra";
import { google, type youtube_v3 } from "googleapis";
import yaml from "js-yaml";
import { z } from "zod";
import { buildByosanDescription } from "../domain/byosan/description.js";
import { parseAndAuditByosanFeatureSpec } from "../domain/byosan/feature_spec.js";
import { planSpeechParts } from "../domain/byosan/production_audit.js";
import {
	getByosanProductionConfig,
	getByosanSpeechPlan,
} from "../domain/byosan/production_config.js";
import {
	YOUTUBE_PROFILES,
	assertYouTubeChannelMatchesProfile,
	createYouTubeOAuthClient,
} from "../domain/youtube_profiles.js";
import { ROOT } from "../io/core.js";

const config = getByosanProductionConfig();
const RUN = config.feature_production.run_layout;
const profile = YOUTUBE_PROFILES.byosan;
const DRY_FLAG = "--dry";

const ReceiptSchema = z.object({
	youtube: z.object({ video_id: z.string().min(1) }),
});

const ContentOutputSchema = z.object({
	script: z.object({
		lines: z.array(
			z.object({
				text: z.string().min(1),
				duration: z.number().positive(),
			}),
		),
	}),
});

type YouTube = ReturnType<typeof google.youtube>;

type VideoState = {
	title: string;
	tags: string[];
	categoryId: string;
	privacyStatus: string;
	description: string;
	thumbnails: string;
};

type VideoField = keyof VideoState;

type VideoSummary = {
	title: string;
	tags: string[];
	category_id: string;
	privacy_status: string;
	description_sha256: string;
	thumbnails_sha256: string;
};

type Stage = "attempted" | "updated" | "verified" | "mismatch";

function readVideoState(video: youtube_v3.Schema$Video): VideoState {
	const { snippet, status } = video;
	if (!snippet?.title || !snippet.categoryId || !status?.privacyStatus) {
		throw new Error("video response lacks snippet or status fields");
	}
	return {
		title: snippet.title,
		tags: snippet.tags ?? [],
		categoryId: snippet.categoryId,
		privacyStatus: status.privacyStatus,
		description: snippet.description ?? "",
		thumbnails: JSON.stringify(snippet.thumbnails ?? null),
	};
}

async function fetchVideoState(
	youtube: YouTube,
	videoId: string,
): Promise<VideoState> {
	const response = await youtube.videos.list({
		part: ["snippet", "status"],
		id: [videoId],
	});
	const item = response.data.items?.[0];
	if (!item)
		throw new Error(`video ${videoId} not found on ${profile.profileName}`);
	return readVideoState(item);
}

function changedFields(before: VideoState, after: VideoState): VideoField[] {
	const fields: VideoField[] = [
		"title",
		"tags",
		"categoryId",
		"privacyStatus",
		"description",
		"thumbnails",
	];
	return fields.filter(
		(field) =>
			JSON.stringify(normalizeField(before, field)) !==
			JSON.stringify(normalizeField(after, field)),
	);
}

function normalizeField(state: VideoState, field: VideoField): unknown {
	if (field === "tags") return [...state.tags].sort();
	if (field === "description") return state.description.trim();
	return state[field];
}

function summarize(state: VideoState): VideoSummary {
	return {
		title: state.title,
		tags: state.tags,
		category_id: state.categoryId,
		privacy_status: state.privacyStatus,
		description_sha256: sha256Text(state.description),
		thumbnails_sha256: sha256Text(state.thumbnails),
	};
}

function sha256Text(text: string): string {
	return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

async function rewriteDescription(
	runDir: string,
	runId: string,
	videoId: string,
	description: string,
): Promise<void> {
	const { auth } = await createYouTubeOAuthClient(profile.profileName);
	await assertYouTubeChannelMatchesProfile(auth, profile);
	const youtube = google.youtube({ version: "v3", auth });

	let stage: Stage = "attempted";
	let before: VideoState | null = null;
	let after: VideoState | null = null;
	try {
		before = await fetchVideoState(youtube, videoId);
		await youtube.videos.update({
			part: ["snippet"],
			requestBody: {
				id: videoId,
				snippet: {
					title: before.title,
					description,
					tags: before.tags,
					categoryId: before.categoryId,
				},
			},
		});
		stage = "updated";
		after = await fetchVideoState(youtube, videoId);
		const verified =
			after.description.trim() === description.trim() &&
			changedFields(before, after).every((field) => field === "description");
		stage = verified ? "verified" : "mismatch";
	} finally {
		fs.appendFileSync(
			path.join(runDir, RUN.publish_dir, "metadata_updates.jsonl"),
			`${JSON.stringify({
				at: new Date().toISOString(),
				run_id: runId,
				video_id: videoId,
				stage,
				verified: stage === "verified",
				changed_fields: before && after ? changedFields(before, after) : null,
				before: before ? summarize(before) : null,
				after: after ? summarize(after) : null,
			})}\n`,
		);
	}
	console.log(
		JSON.stringify({
			run_id: runId,
			video_id: videoId,
			verified: stage === "verified",
			changed_fields: before && after ? changedFields(before, after) : null,
		}),
	);
	if (stage !== "verified") {
		throw new Error(
			`read-back did not match the rewritten description for ${videoId}`,
		);
	}
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const dry = args.includes(DRY_FLAG);
	const runId = args.find((arg) => arg !== DRY_FLAG);
	if (!runId) {
		throw new Error(
			"usage: byosan_metadata.ts byosan_money/YYYY-MM-DD-slot [--dry]",
		);
	}
	const runDir = path.join(ROOT, config.workflow.paths.runs_dir, runId);
	const spec = parseAndAuditByosanFeatureSpec(
		fs.readJsonSync(path.join(runDir, RUN.source_dir, "feature_spec.json")),
	);
	if (spec.runId !== runId) {
		throw new Error(`run ${runId} holds feature spec for ${spec.runId}`);
	}
	const content = ContentOutputSchema.parse(
		yaml.load(
			fs.readFileSync(
				path.join(runDir, RUN.content_dir, RUN.content_output),
				"utf8",
			),
		),
	);
	const parts = planSpeechParts(spec.segments, getByosanSpeechPlan());
	const lines = content.script.lines;
	if (lines.length !== parts.length) {
		throw new Error(
			`BYOSAN_TIMELINE_MISMATCH: ${lines.length} script lines for ${parts.length} speech parts`,
		);
	}
	const timeline = parts.map((part, index) => {
		const line = lines[index];
		if (!line || line.text !== part.segment.text) {
			throw new Error(`BYOSAN_TIMELINE_MISMATCH: speech part ${index}`);
		}
		return { headline: part.segment.headline, duration: line.duration };
	});
	const description = buildByosanDescription(spec, timeline, config.chapters);
	if (dry) {
		console.log(description);
		return;
	}
	const receipt = ReceiptSchema.parse(
		fs.readJsonSync(path.join(runDir, RUN.publish_dir, "receipt.json")),
	);
	await rewriteDescription(
		runDir,
		runId,
		receipt.youtube.video_id,
		description,
	);
}

await main();
