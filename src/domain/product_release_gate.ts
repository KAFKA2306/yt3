import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import {
	assertFactualIntegrityGate,
	loadPublicationState,
	sha256File,
} from "./publication_state.js";
import type { AgentState } from "./types.js";
import type { YouTubeProfile } from "./youtube_profiles.js";

export type ProductReleaseGateInput = {
	runDir: string;
	runId: string;
	state: AgentState & { source_manifest_path?: string };
	profile: YouTubeProfile;
	publishVideoPath?: string;
	requireFactualIntegrity: boolean;
};

export type ProductReleaseGateResult = {
	runId: string;
	profile: string;
	bucket: string;
	artifactPath: string;
	artifactSha256: string;
	factualIntegrityAttestation?: string;
};

function assertNoFallbackMetadata(state: AgentState): void {
	const metadata = state.metadata;
	const metadataText = [
		metadata?.title,
		metadata?.description,
		metadata?.thumbnail_title,
		...(metadata?.tags || []),
	]
		.filter(Boolean)
		.join("\n")
		.toLowerCase();

	if (
		/\bfallback\b/.test(metadataText) ||
		metadataText.includes("reused because") ||
		metadataText.includes("cached fallback")
	) {
		throw new Error(
			"Product release blocked: fallback metadata is prohibited and must be deleted, not published.",
		);
	}
}

function assertAuthenticityGate(runDir: string): void {
	const auditPath = path.join(runDir, "audit", "authenticity.json");
	if (!fs.existsSync(auditPath)) {
		throw new Error(
			`Product release blocked: authenticity audit is missing: ${auditPath}`,
		);
	}
	const audit = z
		.object({
			status: z.enum(["PASS", "FAIL"]),
			feature_spec_sha256: z.string(),
		})
		.passthrough()
		.parse(fs.readJsonSync(auditPath));
	if (audit.status !== "PASS") {
		throw new Error(
			`Product release blocked: authenticity audit FAILED: ${auditPath}`,
		);
	}
	const specPath = path.join(runDir, "source", "feature_spec.json");
	if (audit.feature_spec_sha256 !== sha256File(specPath)) {
		throw new Error(
			"Product release blocked: authenticity audit belongs to a different feature spec",
		);
	}
}

export function assertProductReleaseGate(
	input: ProductReleaseGateInput,
): ProductReleaseGateResult {
	const {
		runDir,
		runId,
		state,
		profile,
		publishVideoPath,
		requireFactualIntegrity,
	} = input;

	if (state.bucket !== profile.bucket) {
		throw new Error(
			`Product release blocked: run bucket '${state.bucket}' does not match profile bucket '${profile.bucket}' for '${profile.profileName}'`,
		);
	}

	assertNoFallbackMetadata(state);

	const artifactPath =
		publishVideoPath || state.publish_video_path || state.video_path;
	if (!artifactPath) {
		throw new Error("Product release blocked: video path is missing");
	}
	if (!fs.existsSync(artifactPath)) {
		throw new Error(
			`Product release blocked: video path does not exist: ${artifactPath}`,
		);
	}

	const artifactSha256 = sha256File(artifactPath);
	const stored = loadPublicationState(runDir);
	if (stored && stored.artifact_sha256 !== artifactSha256) {
		throw new Error(
			"Product release blocked: canonical publication state belongs to a different artifact hash",
		);
	}
	if (
		stored &&
		!stored.video_id &&
		(stored.phase === "PRIVATE_UPLOAD_INTENT" ||
			stored.phase === "UNCERTAIN_REMOTE_COMMIT")
	) {
		throw new Error(
			`Product release blocked: canonical publish state is ${stored.phase} without a verified video id`,
		);
	}

	if (profile.bucket === "byosan_money") {
		assertAuthenticityGate(runDir);
	}

	let factualIntegrityAttestation: string | undefined;
	if (requireFactualIntegrity) {
		factualIntegrityAttestation = assertFactualIntegrityGate(runDir, state);
	}

	return {
		runId,
		profile: profile.profileName,
		bucket: profile.bucket,
		artifactPath: path.resolve(artifactPath),
		artifactSha256,
		factualIntegrityAttestation,
	};
}
