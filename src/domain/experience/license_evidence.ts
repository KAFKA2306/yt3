export interface ExperienceLicenseEvidenceInput {
	remotionVersion: string;
	motionCanvasVersion: string;
}

const REVIEWED_VERSIONS = {
	remotion: "4.0.524",
	motionCanvas: "3.17.2",
} as const;

export function buildExperienceLicenseEvidence({
	remotionVersion,
	motionCanvasVersion,
}: ExperienceLicenseEvidenceInput) {
	const remotionReviewed = remotionVersion === REVIEWED_VERSIONS.remotion;
	const motionCanvasReviewed =
		motionCanvasVersion === REVIEWED_VERSIONS.motionCanvas;
	const codeProjects = [
		{
			engine: "remotion-existing" as const,
			package: "remotion",
			version: remotionVersion,
			license: remotionReviewed ? "Remotion License" : null,
			classification: remotionReviewed
				? ("SOURCE_AVAILABLE_PROPRIETARY" as const)
				: ("UNREVIEWED" as const),
			source_license_status: remotionReviewed
				? ("VERIFIED" as const)
				: ("UNVERIFIED" as const),
			production_eligibility: "UNVERIFIED" as const,
			source_url: `https://github.com/remotion-dev/remotion/blob/v${remotionVersion}/LICENSE.md`,
		},
		{
			engine: "motion-canvas" as const,
			package: "@motion-canvas/core",
			version: motionCanvasVersion,
			license: motionCanvasReviewed ? "MIT" : null,
			classification: motionCanvasReviewed
				? ("OSI_OPEN_SOURCE" as const)
				: ("UNREVIEWED" as const),
			source_license_status: motionCanvasReviewed
				? ("VERIFIED" as const)
				: ("UNVERIFIED" as const),
			production_eligibility: motionCanvasReviewed
				? ("VERIFIED" as const)
				: ("UNVERIFIED" as const),
			source_url: `https://raw.githubusercontent.com/motion-canvas/motion-canvas/v${motionCanvasVersion}/LICENSE`,
		},
	];
	const anyProjectLicenseVerified = codeProjects.some(
		(project) => project.source_license_status === "VERIFIED",
	);

	return {
		status: anyProjectLicenseVerified
			? ("PARTIALLY_VERIFIED" as const)
			: ("UNVERIFIED" as const),
		review_scope:
			"Version-pinned engine project licenses and model-weight use only; not a complete dependency or legal review.",
		code_projects: codeProjects,
		model_weights: {
			status: "NOT_USED" as const,
			engines: ["remotion-existing", "motion-canvas"] as const,
			note: "Both canonical benchmark renderers use deterministic code-based scenes; no model weights are downloaded or loaded.",
		},
		transitive_dependency_licenses: "UNVERIFIED" as const,
	};
}
