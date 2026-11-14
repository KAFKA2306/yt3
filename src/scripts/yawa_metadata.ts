import path from "node:path";
import fs from "fs-extra";
import { google } from "googleapis";
import { z } from "zod";
import {
	buildDescription,
	buildTags,
	buildTitle,
	loadYawaConfig,
	ScriptMetaSchema,
} from "../domain/yawa_daily.js";
import {
	assertYouTubeChannelMatchesProfile,
	createYouTubeOAuthClient,
	YOUTUBE_PROFILES,
} from "../domain/youtube_profiles.js";
import { ROOT } from "../io/core.js";

const config = loadYawaConfig(ROOT);
const profile = YOUTUBE_PROFILES.yawa;
const MetadataSchema = z.object({
	title: z.string(),
	description: z.string(),
	tags: z.array(z.string()),
});

async function main(): Promise<void> {
	const runName = process.argv[2];
	if (!runName || !/^yawa-\d{4}-\d{2}-\d{2}(-[a-z0-9]+)?$/.test(runName))
		throw new Error("usage: yawa_metadata.ts yawa-YYYY-MM-DD[-slot]");
	const dir = path.join(ROOT, "runs", config.run.bucket, runName);
	const receipt = fs.readJsonSync(path.join(dir, "publish", "receipt.json"));
	const videoId = z.string().min(1).parse(receipt.youtube?.video_id);
	const draft = ScriptMetaSchema.parse(
		fs.readJsonSync(path.join(dir, "script.json")),
	);
	const state = fs.readJsonSync(path.join(dir, "state.json"));
	const previous = MetadataSchema.parse(state.metadata);
	const metadata =
		typeof draft.description === "string" && Array.isArray(draft.tags)
			? MetadataSchema.parse({
					title: buildTitle(draft),
					description: buildDescription(draft, config),
					tags: buildTags(draft),
				})
			: previous;

	const { auth } = await createYouTubeOAuthClient(profile.profileName);
	await assertYouTubeChannelMatchesProfile(auth, profile);
	const youtube = google.youtube({ version: "v3", auth });
	const beforeResponse = await youtube.videos.list({
		part: ["snippet"],
		id: [videoId],
	});
	const before = beforeResponse.data.items?.[0]?.snippet;
	if (!before)
		throw new Error(`video ${videoId} not found on ${profile.profileName}`);

	await youtube.videos.update({
		part: ["snippet"],
		requestBody: {
			id: videoId,
			snippet: {
				title: metadata.title,
				description: metadata.description,
				tags: metadata.tags,
				categoryId: before.categoryId ?? "24",
			},
		},
	});

	const afterResponse = await youtube.videos.list({
		part: ["snippet", "status"],
		id: [videoId],
	});
	const after = afterResponse.data.items?.[0];
	const sameTags =
		[...(after?.snippet?.tags ?? [])].sort().join("\n") ===
		[...metadata.tags].sort().join("\n");
	const verified =
		after?.snippet?.title === metadata.title &&
		(after?.snippet?.description ?? "").trim() ===
			metadata.description.trim() &&
		sameTags;
	const record = {
		at: new Date().toISOString(),
		run_id: `${config.run.bucket}/${runName}`,
		video_id: videoId,
		channel_title: after?.snippet?.channelTitle,
		before: { title: before.title },
		after: { ...metadata, privacy_status: after?.status?.privacyStatus },
		verified,
	};
	fs.ensureDirSync(path.join(dir, "publish"));
	fs.appendFileSync(
		path.join(dir, "publish", "metadata_updates.jsonl"),
		`${JSON.stringify(record)}\n`,
	);
	console.log(
		JSON.stringify({
			run_id: record.run_id,
			video_id: videoId,
			verified,
			title: metadata.title,
		}),
	);
	if (!verified)
		throw new Error(`read-back did not match the new metadata for ${videoId}`);
}

await main();
