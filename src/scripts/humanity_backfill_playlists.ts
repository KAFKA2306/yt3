import path from "node:path";
import fs from "fs-extra";
import { google } from "googleapis";
import {
	type HumanityUseCaseId,
	HumanityUseCaseIdSchema,
	loadMusicConfig,
	YOUTUBE_PLAYLIST_URL,
} from "../domain/humanity_music.js";
import {
	assertYouTubeChannelMatchesProfile,
	createYouTubeOAuthClient,
	YOUTUBE_PROFILES,
} from "../domain/youtube_profiles.js";
import { ROOT } from "../io/core.js";
import { measureAudioBpm } from "./measure_bpm.js";

type ClassificationRow = {
	run_id: string;
	video_id: string;
	title: string;
	bpm: number;
	four_on_the_floor_score: number;
	is_four_on_the_floor: boolean;
	rms_db: number;
	use_case: HumanityUseCaseId;
	reason: string;
};

const ALL_USE_CASES: HumanityUseCaseId[] = [
	"q1_action_boost",
	"q2_focus_boost",
	"q3_daily_flow",
	"q4_night_reset",
];

function classifyTrackUseCase(params: {
	explicitUseCase?: unknown;
	title: string;
	description: string;
	bpm: number;
	isFourOnTheFloor: boolean;
}): { use_case: HumanityUseCaseId; reason: string } {
	const parsed = HumanityUseCaseIdSchema.safeParse(params.explicitUseCase);
	if (parsed.success) {
		return { use_case: parsed.data, reason: "explicit_use_case" };
	}
	const text = `${params.title}\n${params.description}`.toLowerCase();
	const hasActionCue =
		/ユーロビート|eurobeat|edm|覚醒|爆速|家事|ドライブ|筋トレ|疾走|ハイテンション/.test(
			text,
		);
	const hasNightCue =
		/夜更け|深夜|眠|バラード|ballad|ピアノ|静か|雨の夜|クールダウン|リセット|子守/.test(
			text,
		);
	const hasFocusCue =
		/集中|作業|勉強|スイッチ|ブースト|シンセ|エレクトロ|synthwave|electro|focus/.test(
			text,
		);

	if (params.bpm >= 140 || (hasActionCue && params.bpm >= 130)) {
		return {
			use_case: "q1_action_boost",
			reason: `bpm=${params.bpm}${hasActionCue ? "+action_cue" : ""}`,
		};
	}
	if (params.bpm <= 95 || (hasNightCue && params.bpm < 110)) {
		return {
			use_case: "q4_night_reset",
			reason: `bpm=${params.bpm}${hasNightCue ? "+night_cue" : ""}`,
		};
	}
	if (params.bpm >= 110 && (params.isFourOnTheFloor || hasFocusCue)) {
		return {
			use_case: "q2_focus_boost",
			reason: `bpm=${params.bpm}+4otf=${params.isFourOnTheFloor}`,
		};
	}
	return {
		use_case: "q3_daily_flow",
		reason: `bpm=${params.bpm}+daily_flow`,
	};
}

async function listPlaylistVideoIds(
	youtube: ReturnType<typeof google.youtube>,
	playlistId: string,
): Promise<Set<string>> {
	const ids = new Set<string>();
	let pageToken: string | undefined;
	do {
		const page = await youtube.playlistItems.list({
			part: ["contentDetails"],
			playlistId,
			maxResults: 50,
			pageToken,
		});
		for (const item of page.data.items ?? []) {
			const vid = item.contentDetails?.videoId;
			if (vid) ids.add(vid);
		}
		pageToken = page.data.nextPageToken ?? undefined;
	} while (pageToken);
	return ids;
}

async function reorderPlaylistNewestFirst(
	youtube: ReturnType<typeof google.youtube>,
	playlistId: string,
	newestFirstVideoIds: string[],
): Promise<number> {
	const itemByVideoId = new Map<string, string>();
	let pageToken: string | undefined;
	do {
		const page = await youtube.playlistItems.list({
			part: ["id", "contentDetails"],
			playlistId,
			maxResults: 50,
			pageToken,
		});
		for (const item of page.data.items ?? []) {
			const vid = item.contentDetails?.videoId;
			if (vid && item.id) itemByVideoId.set(vid, item.id);
		}
		pageToken = page.data.nextPageToken ?? undefined;
	} while (pageToken);

	let updated = 0;
	for (let pos = 0; pos < newestFirstVideoIds.length; pos++) {
		const vid = newestFirstVideoIds[pos];
		if (!vid) continue;
		const itemId = itemByVideoId.get(vid);
		if (!itemId) continue;
		await youtube.playlistItems.update({
			part: ["snippet"],
			requestBody: {
				id: itemId,
				snippet: {
					playlistId,
					position: pos,
					resourceId: { kind: "youtube#video", videoId: vid },
				},
			},
		});
		updated++;
	}
	return updated;
}

async function main() {
	const apply = process.argv.includes("--apply");
	const reorderNewestFirst = process.argv.includes("--reorder-newest-first");
	const config = loadMusicConfig(ROOT);
	const runsRoot = path.join(ROOT, "runs", "humanity_observatory");
	const stateDir = path.join(ROOT, "data", "state", "humanity");
	const ucStatePath = path.join(stateDir, "use_case_playlists.json");
	const manifestPath = path.join(stateDir, "playlist_classification.json");
	fs.ensureDirSync(stateDir);

	const runDirs = fs
		.readdirSync(runsRoot)
		.filter((name) => name.startsWith("music-"))
		.sort();

	const rows: ClassificationRow[] = [];
	const seenVideoIds = new Set<string>();

	for (const name of runDirs) {
		const dir = path.join(runsRoot, name);
		const pubPath = path.join(dir, "publish", "state.json");
		const videoPath = path.join(dir, "video.mp4");
		if (!fs.existsSync(pubPath) || !fs.existsSync(videoPath)) continue;

		const pub = fs.readJsonSync(pubPath) as {
			phase?: string;
			observed_visibility?: string;
			video_id?: string;
		};
		if (
			pub.phase !== "VERIFIED" ||
			pub.observed_visibility !== "public" ||
			!pub.video_id ||
			seenVideoIds.has(pub.video_id)
		) {
			continue;
		}
		seenVideoIds.add(pub.video_id);

		const statePath = path.join(dir, "state.json");
		const state = fs.existsSync(statePath)
			? (fs.readJsonSync(statePath) as {
					metadata?: { title?: string; description?: string };
				})
			: {};
		const title = state.metadata?.title ?? name;
		const description = state.metadata?.description ?? "";

		let explicitUseCase: unknown;
		const songPath = path.join(dir, "song.json");
		if (fs.existsSync(songPath)) {
			const songId = (fs.readJsonSync(songPath) as { id?: string }).id;
			if (songId) {
				const creativePath = path.join(
					ROOT,
					config.output_dir,
					songId,
					"creative_authoring.json",
				);
				if (fs.existsSync(creativePath)) {
					explicitUseCase = (
						fs.readJsonSync(creativePath) as { use_case?: unknown }
					).use_case;
				}
			}
		}

		try {
			const bpmInfo = measureAudioBpm(videoPath);
			const classified = classifyTrackUseCase({
				explicitUseCase,
				title,
				description,
				bpm: bpmInfo.bpm,
				isFourOnTheFloor: bpmInfo.is_four_on_the_floor,
			});
			rows.push({
				run_id: `humanity_observatory/${name}`,
				video_id: pub.video_id,
				title,
				bpm: bpmInfo.bpm,
				four_on_the_floor_score: bpmInfo.four_on_the_floor_score,
				is_four_on_the_floor: bpmInfo.is_four_on_the_floor,
				rms_db: bpmInfo.rms_db,
				use_case: classified.use_case,
				reason: classified.reason,
			});
		} catch (err) {
			console.error(
				`[skip] ${name}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	const counts: Record<HumanityUseCaseId, number> = {
		q1_action_boost: 0,
		q2_focus_boost: 0,
		q3_daily_flow: 0,
		q4_night_reset: 0,
	};
	for (const r of rows) counts[r.use_case]++;

	fs.writeJsonSync(
		manifestPath,
		{
			generated_at: new Date().toISOString(),
			total_public_music_videos: rows.length,
			counts,
			rows,
		},
		{ spaces: 2 },
	);

	console.log(
		`[humanity:playlists:sync] classified=${rows.length} counts=${JSON.stringify(counts)} apply=${apply}`,
	);

	if (!apply && !reorderNewestFirst) return;

	const profile = YOUTUBE_PROFILES.humanity;
	const { auth } = await createYouTubeOAuthClient(profile.profileName);
	await assertYouTubeChannelMatchesProfile(auth, profile);
	const youtube = google.youtube({ version: "v3", auth });

	const ucState: Record<string, string> = fs.existsSync(ucStatePath)
		? (fs.readJsonSync(ucStatePath) as Record<string, string>)
		: {};

	for (const ucId of ALL_USE_CASES) {
		if (!ucState[ucId]) {
			const meta = config.use_case_playlists[ucId];
			const created = await youtube.playlists.insert({
				part: ["snippet", "status"],
				requestBody: {
					snippet: {
						title: meta.title,
						description: meta.description,
					},
					status: { privacyStatus: config.youtube_playlist.privacy },
				},
			});
			if (!created.data.id) {
				throw new Error(`Failed to create playlist for ${ucId}`);
			}
			ucState[ucId] = created.data.id;
			fs.writeJsonSync(ucStatePath, ucState, { spaces: 2 });
			console.log(
				`[created] ${ucId} => ${YOUTUBE_PLAYLIST_URL}${created.data.id}`,
			);
		}
	}

	const existingByUc = new Map<HumanityUseCaseId, Set<string>>();
	for (const ucId of ALL_USE_CASES) {
		const pid = ucState[ucId];
		if (!pid) continue;
		existingByUc.set(ucId, await listPlaylistVideoIds(youtube, pid));
	}

	let inserted = 0;
	let skipped = 0;
	if (apply) {
		for (const row of rows) {
			const pid = ucState[row.use_case];
			if (!pid) continue;
			const existing = existingByUc.get(row.use_case);
			if (existing?.has(row.video_id)) {
				skipped++;
				continue;
			}
			await youtube.playlistItems.insert({
				part: ["snippet"],
				requestBody: {
					snippet: {
						playlistId: pid,
						position: 0,
						resourceId: { kind: "youtube#video", videoId: row.video_id },
					},
				},
			});
			existing?.add(row.video_id);
			inserted++;
		}
	}

	const reorderedCounts: Record<string, number> = {};
	if (reorderNewestFirst) {
		for (const ucId of ALL_USE_CASES) {
			const pid = ucState[ucId];
			if (!pid) continue;
			const newestFirstIds = rows
				.filter((r) => r.use_case === ucId)
				.reverse()
				.map((r) => r.video_id);
			reorderedCounts[ucId] = await reorderPlaylistNewestFirst(
				youtube,
				pid,
				newestFirstIds,
			);
		}
	}

	const urls: Record<string, string> = {};
	for (const ucId of ALL_USE_CASES) {
		if (ucState[ucId]) urls[ucId] = `${YOUTUBE_PLAYLIST_URL}${ucState[ucId]}`;
	}
	console.log(
		JSON.stringify(
			{
				total_classified: rows.length,
				inserted,
				skipped_already_present: skipped,
				reordered_newest_first: reorderedCounts,
				counts,
				playlists: urls,
			},
			null,
			2,
		),
	);
}

main();
