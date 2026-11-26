import path from "node:path";
import fs from "fs-extra";
import { google } from "googleapis";
import * as yaml from "js-yaml";
import {
	type HumanityUseCaseId,
	loadMusicConfig,
	parseHumanityUseCases,
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
	use_cases: HumanityUseCaseId[];
	use_case_reason: string;
	bpm: number;
	four_on_the_floor_score: number;
	is_four_on_the_floor: boolean;
	rms_db: number;
};

const ALL_USE_CASES: HumanityUseCaseId[] = [
	"q1_action_boost",
	"q2_focus_boost",
	"q3_daily_flow",
	"q4_night_reset",
];

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

async function listPlaylistVideoIdsUntilIncluded(
	youtube: ReturnType<typeof google.youtube>,
	playlistId: string,
	expectedIds: Set<string>,
): Promise<Set<string>> {
	let ids = new Set<string>();
	for (let attempt = 0; attempt < 5; attempt++) {
		ids = await listPlaylistVideoIds(youtube, playlistId);
		if ([...expectedIds].every((id) => ids.has(id))) return ids;
		if (attempt < 4)
			await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
	}
	return ids;
}

async function main() {
	const args = process.argv.slice(2);
	const apply = args.includes("--apply");
	let scopedUseCase: HumanityUseCaseId | undefined;
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--apply") continue;
		if (arg === "--use-case") {
			const value = args[++index];
			if (!value || !ALL_USE_CASES.includes(value as HumanityUseCaseId))
				throw new Error("invalid --use-case: " + (value ?? "<missing>"));
			scopedUseCase = value as HumanityUseCaseId;
			continue;
		}
		throw new Error("unexpected argument: " + arg);
	}
	const useCasesToSync = scopedUseCase ? [scopedUseCase] : ALL_USE_CASES;
	const config = loadMusicConfig(ROOT);
	let youtube: ReturnType<typeof google.youtube> | undefined;
	if (apply) {
		const domain = yaml.load(
			fs.readFileSync(
				path.join(ROOT, "config", "domains", "humanity_observatory.yaml"),
				"utf8",
			),
		) as { daily_publish?: { publish_approved?: boolean } };
		if (domain.daily_publish?.publish_approved !== true)
			throw new Error(
				"Humanity playlist writes require daily_publish.publish_approved=true",
			);
		const profile = YOUTUBE_PROFILES.humanity;
		const { auth } = await createYouTubeOAuthClient(profile.profileName);
		await assertYouTubeChannelMatchesProfile(auth, profile);
		youtube = google.youtube({ version: "v3", auth });
	}
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
					metadata?: { title?: string };
				})
			: {};
		const title = state.metadata?.title ?? name;

		let authoring: unknown;
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
					authoring = fs.readJsonSync(creativePath);
				}
			}
		}

		try {
			const bpmInfo = measureAudioBpm(videoPath);
			const useCases = parseHumanityUseCases(authoring);
			rows.push({
				run_id: `humanity_observatory/${name}`,
				video_id: pub.video_id,
				title,
				use_cases: useCases,
				use_case_reason: useCases.length
					? "creative_authoring"
					: "no_explicit_use_case",
				bpm: bpmInfo.bpm,
				four_on_the_floor_score: bpmInfo.four_on_the_floor_score,
				is_four_on_the_floor: bpmInfo.is_four_on_the_floor,
				rms_db: bpmInfo.rms_db,
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
	for (const row of rows)
		for (const useCase of row.use_cases) counts[useCase]++;
	const unassigned = rows.filter((row) => row.use_cases.length === 0).length;

	fs.writeJsonSync(
		manifestPath,
		{
			generated_at: new Date().toISOString(),
			total_public_music_videos: rows.length,
			counts,
			unassigned,
			rows,
		},
		{ spaces: 2 },
	);

	console.log(
		`[humanity:playlists:sync] public=${rows.length} assigned=${rows.length - unassigned} unassigned=${unassigned} memberships=${JSON.stringify(counts)} apply=${apply}`,
	);

	if (!apply) return;
	if (!youtube)
		throw new Error("Humanity YouTube client was not initialized for apply");

	const ucState: Record<string, string> = fs.existsSync(ucStatePath)
		? (fs.readJsonSync(ucStatePath) as Record<string, string>)
		: {};

	for (const ucId of useCasesToSync) {
		const meta = config.use_case_playlists[ucId];
		if (!ucState[ucId]) {
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
		} else {
			const currentPlaylist = await youtube.playlists.list({
				part: ["snippet", "status"],
				id: [ucState[ucId]],
			});
			const current = currentPlaylist.data.items?.[0];
			const currentMatches =
				current?.snippet?.title === meta.title &&
				current.snippet.description === meta.description &&
				current.status?.privacyStatus === config.youtube_playlist.privacy;
			if (!currentMatches) {
				await youtube.playlists.update({
					part: ["snippet"],
					requestBody: {
						id: ucState[ucId],
						snippet: { title: meta.title, description: meta.description },
					},
				});
				console.log("[updated] " + ucId + " metadata");
			} else {
				console.log("[unchanged] " + ucId + " metadata already matches");
			}
		}

		let observed: {
			snippet?: { title?: string | null; description?: string | null };
			status?: { privacyStatus?: string | null };
		} | undefined;
		for (let attempt = 0; attempt < 5; attempt++) {
			const playlist = await youtube.playlists.list({
				part: ["snippet", "status"],
				id: [ucState[ucId]],
			});
			observed = playlist.data.items?.[0];
			if (
				observed?.snippet?.title === meta.title &&
				observed.snippet.description === meta.description &&
				observed.status?.privacyStatus === config.youtube_playlist.privacy
			)
				break;
			if (attempt < 4)
				await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
		}
		if (
			observed?.snippet?.title !== meta.title ||
			observed.snippet.description !== meta.description ||
			observed.status?.privacyStatus !== config.youtube_playlist.privacy
		)
			throw new Error(
				ucId + ": playlist metadata read-back did not match: " +
					JSON.stringify({
						expected: {
							title: meta.title,
							description: meta.description,
							privacyStatus: config.youtube_playlist.privacy,
						},
						observed: {
							title: observed?.snippet?.title,
							description: observed?.snippet?.description,
							privacyStatus: observed?.status?.privacyStatus,
						},
					}),
			);
		console.log("[verified] " + ucId + " metadata read-back");
	}

	const existingByUc = new Map<HumanityUseCaseId, Set<string>>();
	for (const ucId of useCasesToSync) {
		const pid = ucState[ucId];
		if (pid) existingByUc.set(ucId, await listPlaylistVideoIds(youtube, pid));
	}

	let inserted = 0;
	let skipped = 0;
	if (apply) {
		for (const row of rows) {
			for (const ucId of row.use_cases) {
				if (!useCasesToSync.includes(ucId)) continue;
				const pid = ucState[ucId];
				const existing = existingByUc.get(ucId);
				if (!pid || existing?.has(row.video_id)) {
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
	}

	const urls: Record<string, string> = {};
	for (const ucId of useCasesToSync) {
		if (ucState[ucId]) urls[ucId] = `${YOUTUBE_PLAYLIST_URL}${ucState[ucId]}`;
	}
	console.log(
		JSON.stringify(
			{
				total_classified: rows.length,
				inserted,
				skipped_already_present: skipped,
				counts,
				unassigned,
				playlists: urls,
			},
			null,
			2,
		),
	);

	for (const ucId of useCasesToSync) {
		const expected = new Set(
			rows
				.filter((row) => row.use_cases.includes(ucId))
				.map((row) => row.video_id),
		);
		if (expected.size === 0) continue;
		const playlistId = ucState[ucId];
		if (!playlistId)
			throw new Error(`${ucId}: playlist ID is missing from saved state`);
		const observed = await listPlaylistVideoIdsUntilIncluded(
			youtube,
			playlistId,
			expected,
		);
		const missing = [...expected].filter((videoId) => !observed.has(videoId));
		if (missing.length > 0)
			throw new Error(
				`${ucId}: playlist read-back is missing ${missing.length} explicitly assigned video(s)`,
			);
		console.log(`[verified] ${ucId} explicit_memberships=${expected.size}`);
	}
}

main();
