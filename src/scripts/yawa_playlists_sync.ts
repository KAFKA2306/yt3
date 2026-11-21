import path from "node:path";
import fs from "fs-extra";
import { google } from "googleapis";
import * as yaml from "js-yaml";
import { z } from "zod";
import { loadYawaCast } from "../domain/yawa_daily.js";
import {
	assertYouTubeChannelMatchesProfile,
	createYouTubeOAuthClient,
	YOUTUBE_PROFILES,
} from "../domain/youtube_profiles.js";
import { ROOT } from "../io/core.js";

const SeriesSchema = z.object({
	series_id: z.string().min(1),
	playlist_title: z.string().min(1),
	playlist_description: z.string().min(1),
	episodes: z.array(
		z.object({
			episode: z.number().int().positive(),
			published_run_id: z.string().min(1).optional(),
		}),
	),
});

type PlaylistItem = { run_id: string; video_id: string; episode?: number };
type PlaylistTarget = {
	key: string;
	kind: "character" | "series";
	title: string;
	description: string;
	items: PlaylistItem[];
};
type PlaylistState = { schema_version: 1; playlists: Record<string, string> };

const playlistUrl = (id: string) =>
	`https://www.youtube.com/playlist?list=${id}`;

function readPlaylistItems(
	youtube: ReturnType<typeof google.youtube>,
	playlistId: string,
): Promise<string[]> {
	return (async () => {
		for (let attempt = 0; attempt < 5; attempt++) {
			try {
				const ids: string[] = [];
				let pageToken: string | undefined;
				do {
					const page = await youtube.playlistItems.list({
						part: ["contentDetails"],
						playlistId,
						maxResults: 50,
						pageToken,
					});
					ids.push(
						...(page.data.items ?? []).flatMap((item) =>
							item.contentDetails?.videoId ? [item.contentDetails.videoId] : [],
						),
					);
					pageToken = page.data.nextPageToken ?? undefined;
				} while (pageToken);
				return ids;
			} catch (error) {
				const status =
					(error as { status?: number; code?: number }).status ??
					(error as { code?: number }).code;
				if (status !== 404 || attempt === 4) throw error;
				await new Promise((resolve) =>
					setTimeout(resolve, 1000 * 2 ** attempt),
				);
			}
		}
		throw new Error(`failed to read playlist ${playlistId}`);
	})();
}

async function readPlaylistItemsUntilIncluded(
	youtube: ReturnType<typeof google.youtube>,
	playlistId: string,
	expectedIds: string[],
): Promise<string[]> {
	let ids: string[] = [];
	for (let attempt = 0; attempt < 5; attempt++) {
		ids = await readPlaylistItems(youtube, playlistId);
		if (expectedIds.every((id) => ids.includes(id))) return ids;
		if (attempt < 4)
			await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
	}
	return ids;
}

async function main() {
	const args = process.argv.slice(2);
	const apply = args.includes("--apply");
	const verifyOnly = args.includes("--verify-only");
	const unexpectedArgs = args.filter(
		(arg) => arg !== "--apply" && arg !== "--verify-only",
	);
	if (unexpectedArgs.length > 0)
		throw new Error(`unexpected arguments: ${unexpectedArgs.join(" ")}`);
	if (apply && verifyOnly)
		throw new Error("--apply and --verify-only cannot be combined");
	const runRoot = path.join(ROOT, "runs", "yawa_archive");
	const seriesRoot = path.join(ROOT, "docs", "yawa", "series");
	const statePath = path.join(ROOT, "data", "state", "yawa", "playlists.json");
	const cast = loadYawaCast(ROOT);
	const knownCharacterIds = new Set(
		cast.characters.map((character) => character.id),
	);
	const seriesById = new Map<string, z.infer<typeof SeriesSchema>>();
	const legacyRunSeries = new Map<
		string,
		{ series_id: string; episode: number }
	>();
	for (const file of fs
		.readdirSync(seriesRoot)
		.filter((name) => name.endsWith(".json"))
		.sort()) {
		const series = SeriesSchema.parse(
			fs.readJsonSync(path.join(seriesRoot, file)),
		);
		if (seriesById.has(series.series_id))
			throw new Error(`duplicate series_id: ${series.series_id}`);
		seriesById.set(series.series_id, series);
		for (const episode of series.episodes) {
			if (episode.published_run_id) {
				if (legacyRunSeries.has(episode.published_run_id))
					throw new Error(
						`run mapped to multiple series episodes: ${episode.published_run_id}`,
					);
				legacyRunSeries.set(episode.published_run_id, {
					series_id: series.series_id,
					episode: episode.episode,
				});
			}
		}
	}

	const targets = new Map<string, PlaylistTarget>();
	for (const character of cast.characters) {
		const key = `character:${character.id}`;
		targets.set(key, {
			key,
			kind: "character",
			title: character.playlist_title,
			description: character.playlist_description,
			items: [],
		});
	}
	for (const series of seriesById.values()) {
		const key = `series:${series.series_id}`;
		targets.set(key, {
			key,
			kind: "series",
			title: series.playlist_title,
			description: series.playlist_description,
			items: [],
		});
	}

	const seenVideos = new Set<string>();
	let publicVideosWithoutCanonicalCast = 0;
	for (const entry of fs
		.readdirSync(runRoot, { withFileTypes: true })
		.filter((item) => item.isDirectory())
		.sort((a, b) => a.name.localeCompare(b.name))) {
		const dir = path.join(runRoot, entry.name);
		const publishPath = path.join(dir, "publish", "state.json");
		if (!fs.existsSync(publishPath)) continue;
		const publication = fs.readJsonSync(publishPath) as {
			phase?: string;
			observed_visibility?: string;
			video_id?: string;
		};
		if (
			publication.phase !== "VERIFIED" ||
			publication.observed_visibility !== "public" ||
			!publication.video_id ||
			seenVideos.has(publication.video_id)
		)
			continue;
		seenVideos.add(publication.video_id);

		const statePathForRun = path.join(dir, "state.json");
		const state = fs.existsSync(statePathForRun)
			? (fs.readJsonSync(statePathForRun) as {
					series_id?: string;
					series_episode?: number;
				})
			: {};
		const scriptPath = path.join(dir, "script.json");
		const script = fs.existsSync(scriptPath)
			? (fs.readJsonSync(scriptPath) as {
					voices?: Array<{ id?: string; character_id?: string }>;
				})
			: {};
		const runItem = { run_id: entry.name, video_id: publication.video_id };
		const characterIds = new Set(
			(script.voices ?? [])
				.map((voice) => voice.character_id || voice.id || "")
				.filter((id) => knownCharacterIds.has(id)),
		);
		for (const id of characterIds)
			targets.get(`character:${id}`)?.items.push(runItem);
		if (characterIds.size === 0) publicVideosWithoutCanonicalCast++;

		const legacy = legacyRunSeries.get(entry.name);
		const seriesId = state.series_id ?? legacy?.series_id;
		const episode = state.series_episode ?? legacy?.episode;
		if (seriesId) {
			const series = seriesById.get(seriesId);
			if (!series)
				throw new Error(`${entry.name}: unknown series_id '${seriesId}'`);
			if (!episode || !series.episodes.some((item) => item.episode === episode))
				throw new Error(
					`${entry.name}: episode is missing from series '${seriesId}'`,
				);
			targets.get(`series:${seriesId}`)?.items.push({ ...runItem, episode });
		}
	}

	for (const target of targets.values()) {
		if (target.kind === "character")
			target.items.sort((a, b) => b.run_id.localeCompare(a.run_id));
		else target.items.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
	}
	const planned = [...targets.values()].filter(
		(target) => target.items.length > 0,
	);
	console.log(
		JSON.stringify(
			{
				apply,
				public_video_count: seenVideos.size,
				public_videos_without_canonical_cast: publicVideosWithoutCanonicalCast,
				playlists: planned.map((target) => ({
					key: target.key,
					title: target.title,
					items: target.items.length,
				})),
			},
			null,
			2,
		),
	);
	if (!apply && !verifyOnly) return;

	if (apply) {
		const domain = yaml.load(
			fs.readFileSync(
				path.join(ROOT, "config", "domains", "yawa_archive.yaml"),
				"utf8",
			),
		) as { daily_publish?: { publish_approved?: boolean } };
		if (domain.daily_publish?.publish_approved !== true)
			throw new Error(
				"Yawa playlist writes require daily_publish.publish_approved=true",
			);
	}

	const profile = YOUTUBE_PROFILES.yawa;
	const { auth } = await createYouTubeOAuthClient(profile.profileName);
	await assertYouTubeChannelMatchesProfile(auth, profile);
	const youtube = google.youtube({ version: "v3", auth });
	const savedState: PlaylistState = fs.existsSync(statePath)
		? (fs.readJsonSync(statePath) as PlaylistState)
		: { schema_version: 1, playlists: {} };
	const ownedPlaylists = new Map<string, string>();
	let pageToken: string | undefined;
	do {
		const page = await youtube.playlists.list({
			part: ["id", "snippet", "status"],
			mine: true,
			maxResults: 50,
			pageToken,
		});
		for (const playlist of page.data.items ?? []) {
			if (playlist.id && playlist.snippet?.title)
				ownedPlaylists.set(playlist.snippet.title, playlist.id);
		}
		pageToken = page.data.nextPageToken ?? undefined;
	} while (pageToken);

	for (const target of planned) {
		let playlistId = savedState.playlists[target.key];
		if (!playlistId && verifyOnly)
			throw new Error(`${target.key}: no saved playlist ID to verify`);
		if (!playlistId) {
			const matches = [...ownedPlaylists.entries()].filter(
				([title]) => title === target.title,
			);
			if (matches.length > 1)
				throw new Error(
					`multiple owned playlists have title '${target.title}'`,
				);
			playlistId = matches[0]?.[1];
		}
		if (!playlistId) {
			const created = await youtube.playlists.insert({
				part: ["snippet", "status"],
				requestBody: {
					snippet: { title: target.title, description: target.description },
					status: { privacyStatus: "public" },
				},
			});
			playlistId = created.data.id ?? undefined;
			if (!playlistId) throw new Error(`failed to create ${target.key}`);
			savedState.playlists[target.key] = playlistId;
			fs.ensureDirSync(path.dirname(statePath));
			fs.writeJsonSync(statePath, savedState, { spaces: 2 });
			console.log(`[created] ${target.key} ${playlistUrl(playlistId)}`);
		} else if (apply) {
			await youtube.playlists.update({
				part: ["snippet"],
				requestBody: {
					id: playlistId,
					snippet: { title: target.title, description: target.description },
				},
			});
			savedState.playlists[target.key] = playlistId;
			fs.ensureDirSync(path.dirname(statePath));
			fs.writeJsonSync(statePath, savedState, { spaces: 2 });
		}

		const currentIds = await readPlaylistItems(youtube, playlistId);
		const insertOrder =
			target.kind === "character" ? [...target.items].reverse() : target.items;
		if (apply) {
			for (const item of insertOrder) {
				if (currentIds.includes(item.video_id)) continue;
				const position =
					target.kind === "character"
						? 0
						: Math.min(Math.max(0, (item.episode ?? 1) - 1), currentIds.length);
				await youtube.playlistItems.insert({
					part: ["snippet"],
					requestBody: {
						snippet: {
							playlistId,
							position,
							resourceId: {
								kind: "youtube#video",
								videoId: item.video_id,
							},
						},
					},
				});
				currentIds.splice(position, 0, item.video_id);
			}
		}

		const expected = target.items.map((item) => item.video_id);
		const readBack = await readPlaylistItemsUntilIncluded(
			youtube,
			playlistId,
			expected,
		);
		const positions = expected.map((id) => readBack.indexOf(id));
		if (positions.some((position) => position < 0))
			throw new Error(
				`${target.key}: one or more public videos are missing after sync`,
			);
		if (
			positions.some(
				(position, index) =>
					index > 0 && position <= (positions[index - 1] ?? -1),
			)
		)
			throw new Error(
				`${target.key}: playlist order does not match its canonical order`,
			);
		const playlistReadBack = await youtube.playlists.list({
			part: ["snippet", "status"],
			id: [playlistId],
		});
		const observed = playlistReadBack.data.items?.[0];
		if (
			observed?.snippet?.title !== target.title ||
			observed.snippet.description !== target.description ||
			observed.status?.privacyStatus !== "public"
		)
			throw new Error(
				`${target.key}: playlist metadata read-back did not match`,
			);
		console.log(
			`[verified] ${target.key} items=${expected.length} ${playlistUrl(playlistId)}`,
		);
	}
}

await main();
