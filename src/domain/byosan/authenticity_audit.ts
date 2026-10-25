import type { ByosanFeatureSpec } from "./feature_spec.js";
import type { ByosanSceneSpec } from "./scene_spec.js";

export type ByosanAuthenticityResult = {
	status: "PASS" | "FAIL";
	violations: { code: string; details: string }[];
};

type AuthenticityInput = {
	scenes: ByosanSceneSpec[];
	featureSpec: Pick<ByosanFeatureSpec, "claims">;
};

export function auditAuthenticity(
	input: AuthenticityInput,
): ByosanAuthenticityResult {
	const claimIds = new Set(
		input.featureSpec.claims.flatMap((claim) => (claim.id ? [claim.id] : [])),
	);
	const unverifiedScenes = input.scenes.filter((scene) =>
		scene.claimIds.some((claimId) => !claimIds.has(claimId)),
	);
	const thirdPartyScenes = input.scenes.filter((scene) =>
		/https?:\/\//.test(JSON.stringify(scene)),
	);
	const violations = [
		...(unverifiedScenes.length > 0
			? [
					{
						code: "scene_claim_unverified",
						details: unverifiedScenes.map((scene) => scene.sceneId).join(","),
					},
				]
			: []),
		...(thirdPartyScenes.length > 0
			? [
					{
						code: "third_party_reference",
						details: thirdPartyScenes.map((scene) => scene.sceneId).join(","),
					},
				]
			: []),
	];
	return { status: violations.length === 0 ? "PASS" : "FAIL", violations };
}
