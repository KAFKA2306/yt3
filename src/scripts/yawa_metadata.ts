import path from "node:path";
import fs from "fs-extra";
import { google } from "googleapis";
import {
	buildDescription,
	buildTitle,
	loadPool,
	loadYawaConfig,
	ScriptDraftSchema,
} from "../domain/yawa_daily.js";
import {
	assertYouTubeChannelMatchesProfile,
	createYouTubeOAuthClient,
	YOUTUBE_PROFILES,
} from "../domain/youtube_profiles.js";
import { ROOT } from "../io/core.js";

const config = loadYawaConfig(ROOT);
const profile = YOUTUBE_PROFILES.yawa;

function probeSeconds(file: string): number {
	const result = Bun.spawnSync([
		"ffprobe",
		"-v",
		"error",
		"-show_entries",
		"format=duration",
		"-of",
		"csv=p=0",
		file,
	]);
	if (result.exitCode !== 0) throw new Error(`ffprobe failed for ${file}`);
	return Number(result.stdout.toString().trim());
}

/**
 * 公開済みの yawa 動画のメタデータを、現在の規則（タイトル・説明文・タグ）に書き換える。
 * 書き換えの前後を YouTube から読み直して確認し、結果を run の台帳（jsonl）に追記する。
 */
async function main() {
	const runName = process.argv[2];
	if (!runName || !/^yawa-\d{4}-\d{2}-\d{2}(-[a-z0-9]+)?$/.test(runName))
		throw new Error("usage: yawa_metadata.ts yawa-YYYY-MM-DD[-slot]");
	const dir = path.join(ROOT, "runs", config.run.bucket, runName);
	const receipt = fs.readJsonSync(path.join(dir, "publish", "receipt.json"));
	const videoId: string = receipt.youtube.video_id;
	if (!videoId) throw new Error(`${runName} has no published video id`);
	const draft = ScriptDraftSchema.parse(
		fs.readJsonSync(path.join(dir, "script.json")),
	);
	const selection = fs.readJsonSync(path.join(dir, "selection.json"));
	const entry = loadPool(ROOT, config).find((e) => e.id === selection.id);
	if (!entry) throw new Error(`selection ${selection.id} is not in the pool`);
	const seconds = probeSeconds(path.join(dir, "video.mp4"));

	const title = buildTitle(draft, config);
	const description = buildDescription(draft, entry, config, seconds);
	const tags = config.metadata.tags;

	const { auth } = await createYouTubeOAuthClient(profile.profileName);
	await assertYouTubeChannelMatchesProfile(auth, profile);
	const youtube = google.youtube({ version: "v3", auth });

	const beforeRes = await youtube.videos.list({
		part: ["snippet"],
		id: [videoId],
	});
	const before = beforeRes.data.items?.[0]?.snippet;
	if (!before)
		throw new Error(`video ${videoId} not found on ${profile.profileName}`);

	await youtube.videos.update({
		part: ["snippet"],
		requestBody: {
			id: videoId,
			snippet: {
				title,
				description,
				tags,
				categoryId: before.categoryId ?? "24",
			},
		},
	});

	const afterRes = await youtube.videos.list({
		part: ["snippet", "status"],
		id: [videoId],
	});
	const after = afterRes.data.items?.[0];
	// YouTube returns tags in its own order, so compare them as a set; trim the description, which YouTube may trim.
	const sameTags =
		[...(after?.snippet?.tags ?? [])].sort().join("\n") ===
		[...tags].sort().join("\n");
	const verified =
		after?.snippet?.title === title &&
		(after?.snippet?.description ?? "").trim() === description.trim() &&
		sameTags;

	const record = {
		at: new Date().toISOString(),
		run_id: `${config.run.bucket}/${runName}`,
		video_id: videoId,
		channel_title: after?.snippet?.channelTitle,
		before: {
			title: before.title,
			description_sha256: before.description
				? sha256Text(before.description)
				: null,
		},
		after: {
			title,
			description_sha256: sha256Text(description),
			tags,
			privacy_status: after?.status?.privacyStatus,
		},
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
			title,
		}),
	);
	if (!verified)
		throw new Error(`read-back did not match the new metadata for ${videoId}`);
}

function sha256Text(text: string): string {
	return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

await main();
