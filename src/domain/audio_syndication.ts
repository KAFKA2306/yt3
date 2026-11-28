import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import sharp from "sharp";

export type AudioProduct = "byosan" | "yawa" | "humanity";
export type AudioEpisode = {
	product: AudioProduct;
	runId: string;
	runDir: string;
	title: string;
	description: string;
	date: string;
	audioPath: string;
	artworkPath?: string;
	guid: string;
};
type RunState = {
	status?: string;
	phase?: string;
	metadata?: { title?: unknown; description?: unknown };
	title?: unknown;
	description?: unknown;
	thumbnail_path?: string;
};

const ROOT = process.cwd();
const REPO = "KAFKA2306/yt3";
const PRODUCTS: Record<
	AudioProduct,
	{ bucket: string; artist: string; tag: string; cover: string }
> = {
	byosan: {
		bucket: "byosan_money",
		artist: "秒算マネー",
		tag: "audio-byosan",
		cover: "秒算マネー",
	},
	yawa: {
		bucket: "yawa_archive",
		artist: "夜話アーカイブ",
		tag: "audio-yawa",
		cover: "夜話アーカイブ",
	},
	humanity: {
		bucket: "humanity_observatory",
		artist: "人類観測所",
		tag: "audio-humanity",
		cover: "人類観測所",
	},
};

function readJson(file: string): RunState | undefined {
	try {
		return fs.readJsonSync(file) as RunState;
	} catch {
		return undefined;
	}
}

function firstFile(paths: string[]): string | undefined {
	return paths.find(
		(file) =>
			fs.existsSync(file) &&
			fs.statSync(file).isFile() &&
			fs.statSync(file).size > 0,
	);
}

export function xmlEscape(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function run(command: string, args: string[]): string {
	return execFileSync(command, args, {
		cwd: ROOT,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function probe(file: string): { duration: number; audio: boolean } {
	const result = JSON.parse(
		run("ffprobe", [
			"-v",
			"error",
			"-show_entries",
			"format=duration:stream=codec_type",
			"-of",
			"json",
			file,
		]),
	) as {
		format?: { duration?: string };
		streams?: Array<{ codec_type?: string }>;
	};
	return {
		duration: Number(result.format?.duration ?? 0),
		audio: Boolean(
			result.streams?.some((stream) => stream.codec_type === "audio"),
		),
	};
}

function resolveEpisode(product: AudioProduct, runId: string): AudioEpisode {
	if (!/^[A-Za-z0-9._-]+$/.test(runId))
		throw new Error(`Invalid run id: ${runId}`);
	const runDir = path.join(ROOT, "runs", PRODUCTS[product].bucket, runId);
	const state = readJson(path.join(runDir, "state.json"));
	if (!state) throw new Error(`Missing run state: ${product}/${runId}`);
	const metadata =
		state.metadata ?? readJson(path.join(runDir, "metadata.json")) ?? {};
	const productMeta =
		product === "yawa"
			? (readJson(path.join(runDir, "script.json")) ?? {})
			: product === "humanity"
				? (readJson(path.join(runDir, "song.json")) ?? {})
				: {};
	const title = String(metadata.title ?? productMeta.title ?? "").trim();
	if (!title || title.length > 300)
		throw new Error(`Missing or invalid title: ${product}/${runId}`);
	const audioPath =
		product === "byosan"
			? firstFile([path.join(runDir, "media/audio/full.wav")])
			: product === "yawa"
				? firstFile([path.join(runDir, "final_mix.wav")])
				: firstFile([
						path.join(runDir, "video.mp4"),
						path.join(runDir, "song/audio.flac"),
						path.join(runDir, "song/audio.wav"),
						path.join(runDir, "audio.flac"),
						path.join(runDir, "audio.wav"),
					]);
	if (!audioPath) throw new Error(`Missing master audio: ${product}/${runId}`);
	const audioInfo = probe(audioPath);
	const publishState = readJson(path.join(runDir, "publish/state.json"));
	if (
		!isEligibleRun(
			state,
			title,
			audioInfo.duration,
			audioInfo.audio,
			true,
			publishState?.phase,
		)
	)
		throw new Error(`Invalid or incomplete run: ${product}/${runId}`);
	const artworkPath = firstFile(
		[
			state.thumbnail_path,
			path.join(runDir, "cover.png"),
			path.join(runDir, "cover.jpg"),
			path.join(runDir, "thumbnail.png"),
			path.join(runDir, "thumbnail.jpg"),
			path.join(runDir, "artwork.png"),
			path.join(runDir, "artwork.jpg"),
		].filter((file): file is string => Boolean(file)),
	);
	const date =
		/20\d{2}-\d{2}-\d{2}/.exec(runId)?.[0] ??
		fs
			.statSync(path.join(runDir, "state.json"))
			.mtime.toISOString()
			.slice(0, 10);
	const description =
		String(metadata.description ?? state.description ?? "")
			.replace(/(?:\/home\/[^\s]+|runs\/[^\s]+|\.json\b)/gu, "")
			.trim()
			.slice(0, 2000) || title;
	return {
		product,
		runId,
		runDir,
		title,
		description,
		date,
		audioPath,
		artworkPath,
		guid: `yt3:${product}:${runId}`,
	};
}

export function isEligibleRun(
	state: RunState,
	title: string,
	duration: number,
	hasAudio: boolean,
	metadataExists = true,
	publishPhase?: string,
): boolean {
	const published = publishPhase === "VERIFIED";
	const prepared = state.status === "READY" || state.status === undefined;
	return (
		metadataExists &&
		title.trim().length > 0 &&
		title.length <= 300 &&
		(prepared || published) &&
		duration > 5 &&
		hasAudio
	);
}

export function findEligibleEpisodes(product?: AudioProduct): AudioEpisode[] {
	const selected = product
		? [product]
		: (Object.keys(PRODUCTS) as AudioProduct[]);
	const result: AudioEpisode[] = [];
	for (const name of selected) {
		const dir = path.join(ROOT, "runs", PRODUCTS[name].bucket);
		if (!fs.existsSync(dir)) continue;
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			try {
				result.push(resolveEpisode(name, entry.name));
			} catch {
				/* Partial and test runs are intentionally ineligible. */
			}
		}
	}
	return result.sort(
		(a, b) => a.date.localeCompare(b.date) || a.runId.localeCompare(b.runId),
	);
}

function safeName(value: string): string {
	return (
		value
			.normalize("NFKC")
			.replace(/[^\p{L}\p{N}._-]+/gu, "_")
			.replace(/^_+|_+$/gu, "")
			.slice(0, 100) || "episode"
	);
}
function rssDate(value: string): string {
	return new Date(`${value}T12:00:00Z`).toUTCString();
}
function durationText(seconds: number): string {
	const n = Math.floor(seconds);
	return `${Math.floor(n / 3600)}:${String(Math.floor((n % 3600) / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

function gh(args: string[]): string {
	return run("gh", args);
}
function ghInput(args: string[], input: string): string {
	return execFileSync("gh", args, {
		cwd: ROOT,
		encoding: "utf8",
		input,
		stdio: ["pipe", "pipe", "pipe"],
	}).trim();
}
function tryGh(args: string[]): string | undefined {
	try {
		return gh(args);
	} catch {
		return undefined;
	}
}
function pageApi(
	method: string,
	endpoint: string,
	fields: string[] = [],
): string {
	return gh(["api", "--method", method, endpoint, ...fields]);
}

function remoteContent(
	pathname: string,
): { text: string; sha: string } | undefined {
	const raw = tryGh(["api", `repos/${REPO}/contents/${pathname}?ref=gh-pages`]);
	if (!raw) return undefined;
	const item = JSON.parse(raw) as {
		content?: string;
		encoding?: string;
		sha: string;
	};
	if (item.encoding !== "base64" || !item.content) return undefined;
	return {
		text: Buffer.from(item.content.replaceAll("\n", ""), "base64").toString(
			"utf8",
		),
		sha: item.sha,
	};
}

function putContent(
	pathname: string,
	content: Uint8Array,
	message: string,
): void {
	const existing = remoteContent(pathname);
	const body = {
		message,
		content: Buffer.from(content).toString("base64"),
		branch: "gh-pages",
		...(existing ? { sha: existing.sha } : {}),
	};
	ghInput(
		[
			"api",
			"--method",
			"PUT",
			`repos/${REPO}/contents/${pathname}`,
			"--input",
			"-",
		],
		JSON.stringify(body),
	);
}

function ensurePages(): void {
	const ref = tryGh(["api", `repos/${REPO}/git/ref/heads/gh-pages`]);
	if (!ref) {
		const main = JSON.parse(
			gh(["api", `repos/${REPO}/git/ref/heads/main`]),
		) as { object: { sha: string } };
		pageApi("POST", `repos/${REPO}/git/refs`, [
			"-f",
			"ref=refs/heads/gh-pages",
			"-f",
			`sha=${main.object.sha}`,
		]);
	}
	let pages = tryGh(["api", `repos/${REPO}/pages`]);
	if (!pages) {
		try {
			pageApi("POST", `repos/${REPO}/pages`, [
				"-f",
				"source[branch]=gh-pages",
				"-f",
				"source[path]=/",
			]);
		} catch {
			/* Concurrent create; verify below. */
		}
		pages = tryGh(["api", `repos/${REPO}/pages`]);
	}
	if (!pages) throw new Error("GitHub Pages is unavailable for KAFKA2306/yt3");
	const value = JSON.parse(pages) as {
		source?: { branch?: string; path?: string };
	};
	if (value.source?.branch !== "gh-pages" || value.source?.path !== "/") {
		pageApi("PUT", `repos/${REPO}/pages`, [
			"-f",
			"source[branch]=gh-pages",
			"-f",
			"source[path]=/",
		]);
	}
}

function ensureRelease(tag: string): void {
	if (tryGh(["release", "view", tag, "--repo", REPO])) return;
	gh([
		"release",
		"create",
		tag,
		"--repo",
		REPO,
		"--title",
		`YT3 audio: ${tag}`,
		"--notes",
		"Automatically syndicated yt3 audio episodes.",
	]);
}

async function makeCover(
	product: AudioProduct,
	artworkPath?: string,
): Promise<Buffer> {
	const image = artworkPath
		? sharp(artworkPath)
		: (() => {
				const label = xmlEscape(PRODUCTS[product].cover);
				return sharp(
					Buffer.from(
						`<svg width="1400" height="1400"><rect width="1400" height="1400" fill="#f5f1e9"/><circle cx="700" cy="600" r="310" fill="#b8a7e6" opacity=".7"/><text x="700" y="1050" text-anchor="middle" font-size="72" fill="#344054">${label}</text></svg>`,
					),
				);
			})();
	for (const quality of [88, 80, 72, 64]) {
		const output = await image
			.clone()
			.resize(1400, 1400, { fit: "cover" })
			.jpeg({ quality, mozjpeg: true })
			.toBuffer();
		if (output.length < 500_000) return output;
	}
	throw new Error(`Could not create <500 KB cover for ${product}`);
}

export function itemXml(
	episode: AudioEpisode,
	assetName: string,
	bytes: number,
	seconds: number,
): string {
	const tag = PRODUCTS[episode.product].tag;
	const url = `https://github.com/${REPO}/releases/download/${tag}/${assetName}`;
	return `  <item>\n    <title>${xmlEscape(episode.title)}</title>\n    <guid isPermaLink="false">${xmlEscape(episode.guid)}</guid>\n    <enclosure url="${url}" length="${bytes}" type="audio/mp4" />\n    <itunes:duration>${durationText(seconds)}</itunes:duration>\n    <description>${xmlEscape(episode.description)}</description>\n    <pubDate>${rssDate(episode.date)}</pubDate>\n  </item>`;
}

function readItems(xml: string): string[] {
	return [...xml.matchAll(/<item>[\s\S]*?<\/item>/gu)].map((item) => item[0]);
}
function decodeXml(value: string): string {
	return value
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'");
}
function hasGuid(item: string, guid: string): boolean {
	return item.includes(`<guid isPermaLink="false">${xmlEscape(guid)}</guid>`);
}

export function dedupeRssItems(items: string[], incoming: string[]): string[] {
	const result = [...items];
	for (const item of incoming) {
		const guid =
			/<guid isPermaLink="false">([\s\S]*?)<\/guid>/u.exec(item)?.[1] ?? "";
		const existingIndex = result.findIndex((existing) =>
			hasGuid(existing, decodeXml(guid)),
		);
		if (existingIndex >= 0) result.splice(existingIndex, 1);
		result.unshift(item);
	}
	return result;
}

function publishFeed(
	product: AudioProduct,
	episodes: AudioEpisode[],
	cover: Buffer,
	newItems: string[],
): void {
	const prefix = `https://kafka2306.github.io/yt3/${product}`;
	const current = remoteContent(`${product}/feed.xml`)?.text ?? "";
	const items = dedupeRssItems(readItems(current), newItems);
	const config = PRODUCTS[product];
	const latest = [...episodes].reverse()[0];
	const title = config.cover;
	const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">\n<channel>\n  <title>${xmlEscape(title)}</title>\n  <link>${prefix}/</link>\n  <description>${xmlEscape(`${title} official audio feed`)}</description>\n  <language>ja</language>\n  <itunes:author>${xmlEscape(config.artist)}</itunes:author>\n  <itunes:explicit>false</itunes:explicit>\n  <itunes:image href="${prefix}/cover.jpg" />\n  <image><url>${prefix}/cover.jpg</url><title>${xmlEscape(title)}</title><link>${prefix}/</link></image>\n${items.join("\n")}\n</channel>\n</rss>\n`;
	putContent(
		`${product}/cover.jpg`,
		cover,
		`audio: update ${product} podcast cover`,
	);
	putContent(
		`${product}/feed.xml`,
		Buffer.from(xml),
		`audio: update ${product} podcast feed`,
	);
	putContent(
		"index.html",
		Buffer.from(
			`<!doctype html><html lang="ja"><meta charset="utf-8"><title>YT3 Audio</title><h1>YT3 Audio Feeds</h1><ul><li><a href="byosan/feed.xml">秒算マネー</a></li><li><a href="yawa/feed.xml">夜話アーカイブ</a></li><li><a href="humanity/feed.xml">人類観測所</a></li></ul></html>`,
		),
		"audio: update feed index",
	);
	void latest;
}

function cacheStatePath(): string {
	return path.join(
		process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local/state"),
		"yt3/audio-sync.json",
	);
}
function saveReceipt(
	episode: AudioEpisode,
	state: Record<string, unknown>,
): void {
	const file = path.join(episode.runDir, "audio_sync/state.json");
	fs.ensureDirSync(path.dirname(file));
	fs.writeJsonSync(
		file,
		{
			run_id: episode.runId,
			product: episode.product,
			guid: episode.guid,
			updated_at: new Date().toISOString(),
			...state,
		},
		{ spaces: 2 },
	);
}

export async function syncAudioEpisodes(
	episodes: AudioEpisode[],
): Promise<{ synced: number; skipped: number }> {
	const statePath = cacheStatePath();
	const state = (readJson(statePath) ?? {}) as RunState &
		Record<string, unknown>;
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yt3-audio-sync-"));
	let synced = 0;
	let skipped = 0;
	try {
		for (const product of ["byosan", "yawa", "humanity"] as AudioProduct[]) {
			const selected = episodes.filter(
				(episode) => episode.product === product,
			);
			if (!selected.length) continue;
			ensureRelease(PRODUCTS[product].tag);
			const cover = await makeCover(product, selected.at(-1)?.artworkPath);
			const newItems: string[] = [];
			for (const episode of selected) {
				try {
					const source = probe(episode.audioPath);
					const output = path.join(tempDir, `${product}-${episode.runId}.m4a`);
					const args = ["-y", "-v", "error", "-i", episode.audioPath];
					if (product === "humanity" && episode.artworkPath) {
						const embeddedCover = await makeCover(product, episode.artworkPath);
						const coverPath = path.join(
							tempDir,
							`${product}-${episode.runId}-artwork.jpg`,
						);
						fs.writeFileSync(coverPath, embeddedCover);
						args.push("-i", coverPath);
					}
					args.push("-map", "0:a:0");
					if (
						product === "humanity" &&
						episode.audioPath.toLowerCase().endsWith(".mp4")
					)
						args.push("-c:a", "copy");
					else
						args.push(
							"-c:a",
							"aac",
							"-b:a",
							product === "humanity" ? "192k" : "128k",
						);
					if (product !== "humanity") args.push("-ac", "1");
					else args.push("-ac", "2");
					if (product === "humanity" && episode.artworkPath)
						args.push(
							"-map",
							"1:v:0",
							"-c:v",
							"mjpeg",
							"-disposition:v:0",
							"attached_pic",
						);
					else args.push("-vn");
					args.push(
						"-movflags",
						"+faststart",
						"-metadata",
						`title=${episode.title}`,
						"-metadata",
						`artist=${PRODUCTS[product].artist}`,
						"-metadata",
						`album=${PRODUCTS[product].artist}`,
						"-metadata",
						`date=${episode.date}`,
						"-metadata",
						`comment=${episode.guid}`,
						output,
					);
					run("ffmpeg", args);
					const encodedInfo = probe(output);
					if (!encodedInfo.audio || encodedInfo.duration <= 5)
						throw new Error("encoded M4A failed audio duration validation");
					const bytes = fs.statSync(output).size;
					if (!bytes) throw new Error("encoded audio is empty");
					const asset = `${product}-${episode.runId}.m4a`;
					gh([
						"release",
						"upload",
						PRODUCTS[product].tag,
						output,
						"--repo",
						REPO,
						"--clobber",
					]);
					newItems.push(itemXml(episode, asset, bytes, source.duration));
					if (product === "humanity") {
						const targetDir =
							process.env.YT3_HUMANITY_MUSIC_DIR ||
							"/mnt/c/Users/100ca/Music/yt3-humanity";
						const target = path.join(
							targetDir,
							`${episode.runId}_${safeName(episode.title)}.m4a`,
						);
						copyIfChanged(output, target);
					}
					state[episode.guid] = {
						asset,
						bytes,
						synced_at: new Date().toISOString(),
					};
					saveReceipt(episode, { status: "SYNCED", asset, bytes });
					synced++;
				} catch (error) {
					saveReceipt(episode, {
						status: "RETRYABLE_FAILURE",
						error: error instanceof Error ? error.message : String(error),
					});
					throw error;
				}
			}
			ensurePages();
			publishFeed(product, selected, cover, newItems);
			if (!newItems.length) skipped += selected.length;
		}
		fs.ensureDirSync(path.dirname(statePath));
		fs.writeJsonSync(statePath, state, { spaces: 2 });
		return { synced, skipped };
	} finally {
		fs.removeSync(tempDir);
	}
}

export function selectRun(product: AudioProduct, runId: string): AudioEpisode {
	return resolveEpisode(product, runId);
}

export async function syncRunIsolated(
	product: AudioProduct,
	runId: string,
): Promise<void> {
	let episode: AudioEpisode | undefined;
	try {
		episode = selectRun(product, runId);
		await syncAudioEpisodes([episode]);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		try {
			if (episode)
				saveReceipt(episode, { status: "RETRYABLE_FAILURE", error: message });
			else if (
				/^[A-Za-z0-9._-]+$/u.test(runId) &&
				fs.existsSync(
					path.join(
						ROOT,
						"runs",
						PRODUCTS[product].bucket,
						runId,
						"state.json",
					),
				)
			) {
				const runDir = path.join(ROOT, "runs", PRODUCTS[product].bucket, runId);
				fs.ensureDirSync(path.join(runDir, "audio_sync"));
				fs.writeJsonSync(
					path.join(runDir, "audio_sync/state.json"),
					{
						product,
						run_id: runId,
						guid: `yt3:${product}:${runId}`,
						status: "RETRYABLE_FAILURE",
						error: message,
						updated_at: new Date().toISOString(),
					},
					{ spaces: 2 },
				);
			}
		} catch (receiptError) {
			console.error(
				`[audio-sync] could not write retry receipt for ${product}/${runId}: ${receiptError instanceof Error ? receiptError.message : String(receiptError)}`,
			);
		}
		console.error(
			`[audio-sync] ${product}/${runId} remains retryable: ${message}`,
		);
	}
}

export async function syncRun(
	product: AudioProduct,
	runId: string,
): Promise<void> {
	const episode = selectRun(product, runId);
	try {
		await syncAudioEpisodes([episode]);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		saveReceipt(episode, { status: "RETRYABLE_FAILURE", error: message });
		throw error;
	}
}

export function copyIfChanged(source: string, target: string): boolean {
	if (
		fs.existsSync(target) &&
		createHash("sha256").update(fs.readFileSync(target)).digest("hex") ===
			createHash("sha256").update(fs.readFileSync(source)).digest("hex")
	)
		return false;
	fs.ensureDirSync(path.dirname(target));
	fs.copyFileSync(source, target);
	return true;
}
