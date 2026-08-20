import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import { getYouTubeProfile } from "../domain/youtube_profiles.js";
import { type AgentState, AssetStore } from "../io/core.js";

type DancerManifest = {
	schema_version: number;
	run_id: string;
	selected?: { video_path?: string; video_sha256?: string };
	thumbnail?: {
		path?: string;
		size_bytes?: number;
		mime_type?: string;
		source_video_sha256?: string;
	};
	metadata?: {
		title?: string;
		description?: string;
		tags?: string[];
		thumbnail_title?: string;
		path?: string;
	};
	caption_path?: string | null;
	publish_at?: string | null;
	compliance?: { passed?: boolean; contains_synthetic_media?: boolean };
};

function sha256(filePath: string): string {
	const hash = crypto.createHash("sha256");
	hash.update(fs.readFileSync(filePath));
	return hash.digest("hex");
}

function requireFile(rawPath: string | undefined, label: string): string {
	if (!rawPath) throw new Error(`Dancer manifest is missing ${label}`);
	const resolved = path.resolve(rawPath);
	if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile())
		throw new Error(`${label} does not exist: ${resolved}`);
	return resolved;
}

function main() {
	const manifestArg = process.argv[2];
	const profileArg = process.argv[3];
	if (!manifestArg || !profileArg) {
		throw new Error(
			"Usage: bun src/scripts/import_dancer_artifact.ts <manifest.json> <byosan|yawa|humanity>",
		);
	}
	process.env.YOUTUBE_CHANNEL_PROFILE = profileArg;
	const profile = getYouTubeProfile(profileArg);
	const manifestPath = requireFile(manifestArg, "manifest path");
	const manifest = fs.readJsonSync(manifestPath) as DancerManifest;
	if (manifest.schema_version !== 1)
		throw new Error(
			`Unsupported dancer manifest schema: ${manifest.schema_version}`,
		);
	if (!manifest.run_id || !/^dancer-[a-f0-9]{20}$/.test(manifest.run_id))
		throw new Error(`Invalid dancer run id: ${manifest.run_id || "missing"}`);
	if (manifest.compliance?.passed !== true)
		throw new Error(
			"Dancer manifest did not pass the rights/provenance compliance gate",
		);
	const videoPath = requireFile(
		manifest.selected?.video_path,
		"selected video",
	);
	const expectedVideoHash = manifest.selected?.video_sha256;
	if (!expectedVideoHash || sha256(videoPath) !== expectedVideoHash)
		throw new Error("Dancer selected video SHA-256 does not match manifest");
	if (manifest.thumbnail?.source_video_sha256 !== expectedVideoHash)
		throw new Error(
			"Dancer thumbnail provenance does not match selected video hash",
		);
	const thumbnailPath = requireFile(manifest.thumbnail?.path, "thumbnail");
	const thumbnailSize = fs.statSync(thumbnailPath).size;
	if (thumbnailSize > 2 * 1024 * 1024)
		throw new Error(
			`Dancer thumbnail exceeds YouTube 2 MB limit: ${thumbnailSize} bytes`,
		);
	const thumbnailExtension = path.extname(thumbnailPath).toLowerCase();
	if (![".jpg", ".jpeg", ".png"].includes(thumbnailExtension))
		throw new Error(`Unsupported thumbnail format: ${thumbnailExtension}`);
	const metadata = manifest.metadata;
	if (
		!metadata?.title ||
		!metadata.description ||
		!metadata.thumbnail_title ||
		!Array.isArray(metadata.tags)
	) {
		throw new Error("Dancer manifest metadata is incomplete");
	}
	const captionPath = manifest.caption_path
		? requireFile(manifest.caption_path, "caption")
		: undefined;

	const runId = `${profile.bucket}/${manifest.run_id}`;
	const store = new AssetStore(runId);
	const importedState = {
		run_id: runId,
		bucket: profile.bucket,
		video_path: videoPath,
		publish_video_path: videoPath,
		thumbnail_path: thumbnailPath,
		metadata: {
			title: metadata.title,
			description: metadata.description,
			tags: metadata.tags,
			thumbnail_title: metadata.thumbnail_title,
		},
		caption_path: captionPath,
		source_manifest_path: manifestPath,
		source_artifact_sha256: expectedVideoHash,
		contains_synthetic_media:
			manifest.compliance?.contains_synthetic_media === true,
		publish_at: manifest.publish_at || undefined,
	} as Partial<AgentState> & Record<string, unknown>;
	store.updateState(importedState as Partial<AgentState>);
	fs.writeJsonSync(
		path.join(store.runDir, "dancer_import.json"),
		{
			schema_version: 1,
			imported_at: new Date().toISOString(),
			manifest_path: manifestPath,
			source_artifact_sha256: expectedVideoHash,
			publish_video_path: videoPath,
			thumbnail_path: thumbnailPath,
			profile: profile.profileName,
			channel_id: profile.expectedChannelId,
			run_id: runId,
		},
		{ spaces: 2 },
	);
	console.log(
		JSON.stringify({
			run_id: runId,
			run_dir: path.resolve(store.runDir),
			publish_video_path: videoPath,
			source_artifact_sha256: expectedVideoHash,
		}),
	);
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
