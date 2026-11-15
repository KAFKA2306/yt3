import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import type { google } from "googleapis";
import { z } from "zod";
import type { PublishResults } from "./types.js";
import type { YouTubeProfile } from "./youtube_profiles.js";

export const PublicationPhaseSchema = z.enum([
	"NOT_STARTED",
	"PRIVATE_UPLOAD_INTENT",
	"PRIVATE_UPLOADED",
	"REMOTE_VERIFIED",
	"VISIBILITY_APPLIED",
	"VERIFIED",
	"UNCERTAIN_REMOTE_COMMIT",
]);

export const CanonicalPublicationStateSchema = z.object({
	schema_version: z.literal(1),
	run_id: z.string().min(1),
	artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/),
	phase: PublicationPhaseSchema,
	requested_visibility: z.string().min(1),
	updated_at: z.string().datetime(),
	video_id: z.string().min(1).optional(),
	channel_id: z.string().min(1).optional(),
	channel_title: z.string().min(1).optional(),
	observed_visibility: z.string().min(1).optional(),
	failure_reason: z.string().min(1).optional(),
});

export type CanonicalPublicationState = z.infer<
	typeof CanonicalPublicationStateSchema
>;

export type CanonicalPublicationReuse = {
	state: CanonicalPublicationState;
	result: NonNullable<PublishResults["youtube"]>;
};

function statePath(runDir: string): string {
	return path.join(runDir, "publish", "state.json");
}

export function sha256File(filePath: string): string {
	const hash = crypto.createHash("sha256");
	hash.update(fs.readFileSync(filePath));
	return hash.digest("hex");
}

export function loadPublicationState(
	runDir: string,
): CanonicalPublicationState | null {
	const target = statePath(runDir);
	if (!fs.existsSync(target)) return null;
	return CanonicalPublicationStateSchema.parse(fs.readJsonSync(target));
}

export function writePublicationState(
	runDir: string,
	state: Omit<CanonicalPublicationState, "schema_version" | "updated_at">,
): CanonicalPublicationState {
	const payload = CanonicalPublicationStateSchema.parse({
		...state,
		schema_version: 1,
		updated_at: new Date().toISOString(),
	});
	fs.ensureDirSync(path.join(runDir, "publish"));
	fs.writeJsonSync(statePath(runDir), payload, { spaces: 2 });
	return payload;
}

export function transitionPublication(
	runDir: string,
	input: {
		run_id: string;
		artifact_sha256: string;
		requested_visibility: string;
		phase: CanonicalPublicationState["phase"];
		video_id?: string;
		channel_id?: string;
		channel_title?: string;
		observed_visibility?: string;
		failure_reason?: string;
	},
): CanonicalPublicationState {
	const current = loadPublicationState(runDir);
	if (current && current.artifact_sha256 !== input.artifact_sha256) {
		throw new Error(
			"Canonical publish state belongs to a different artifact hash; refusing to overwrite it",
		);
	}
	return writePublicationState(runDir, {
		run_id: input.run_id,
		artifact_sha256: input.artifact_sha256,
		requested_visibility: input.requested_visibility,
		phase: input.phase,
		video_id: input.video_id ?? current?.video_id,
		channel_id: input.channel_id ?? current?.channel_id,
		channel_title: input.channel_title ?? current?.channel_title,
		observed_visibility:
			input.observed_visibility ?? current?.observed_visibility,
		failure_reason: input.failure_reason,
	});
}

export async function tryReuseCanonicalPublication(
	youtube: ReturnType<typeof google.youtube>,
	runDir: string,
	artifactSha256: string,
	profile: YouTubeProfile,
): Promise<CanonicalPublicationReuse | null> {
	const stored = loadPublicationState(runDir);
	if (
		!stored ||
		stored.artifact_sha256 !== artifactSha256 ||
		!stored.video_id
	) {
		return null;
	}
	const response = await youtube.videos.list({
		part: ["snippet", "status"],
		id: [stored.video_id],
	});
	const item = response.data.items?.[0];
	if (!item) {
		throw new Error(
			`Canonical publish state references video '${stored.video_id}', but the remote video cannot be verified; refusing videos.insert`,
		);
	}
	if (item.snippet?.channelId !== profile.expectedChannelId) {
		throw new Error(
			`Canonical publish state points to the wrong channel: expected ${profile.expectedChannelId}, got ${item.snippet?.channelId || "missing"}`,
		);
	}
	return {
		state: stored,
		result: {
			status: "uploaded",
			video_id: stored.video_id,
			channel_id: item.snippet.channelId,
			channel_title: item.snippet.channelTitle ?? profile.expectedChannelTitle,
			privacy_status: item.status?.privacyStatus ?? "unknown",
			published_at: item.snippet.publishedAt ?? "",
		},
	};
}
