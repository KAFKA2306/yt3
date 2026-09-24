import { describe, expect, test } from "bun:test";
import {
	auditByosanArchetypeEvidence,
	selectByosanNarrativeArchetype,
} from "../src/domain/byosan/narrative_archetype.js";

const sources = [{ id: "vendor" }, { id: "third-party" }];
const adversarialEvidence = [
	{ id: "vendor-boundary", kind: "source_limitation" },
];

function slot(
	name: string,
	overrides: {
		sourceIds?: string[];
		adversarialEvidenceIds?: string[];
		activeProbeIds?: string[];
	} = {},
) {
	return {
		slot: name,
		statement: `evidence for ${name}`,
		sourceIds: overrides.sourceIds ?? ["vendor"],
		...(overrides.adversarialEvidenceIds
			? { adversarialEvidenceIds: overrides.adversarialEvidenceIds }
			: {}),
		...(overrides.activeProbeIds
			? { activeProbeIds: overrides.activeProbeIds }
			: {}),
	};
}

describe("extended byosan narrative archetypes", () => {
	test("arithmetic runtime bias is selected only from a complete source-backed bundle", () => {
		const result = selectByosanNarrativeArchetype(
			{
				sources,
				adversarialEvidence,
				archetypeEvidence: [
					{
						archetype: "arithmetic_runtime_bias",
						slots: [
							slot("headline_claim"),
							slot("reverse_calculation"),
							slot("offsetting_factor"),
							slot("runtime_default_bias"),
							slot("attribution_boundary", {
								sourceIds: ["vendor", "third-party"],
								adversarialEvidenceIds: ["vendor-boundary"],
							}),
						],
					},
				],
			},
			{ format: "deep_dive" },
		);
		expect(result.archetype).toBe("arithmetic_runtime_bias");
		expect(result.requiredSlots).toEqual([
			"headline_claim",
			"reverse_calculation",
			"offsetting_factor",
			"runtime_default_bias",
			"attribution_boundary",
		]);
	});

	test("rollout verification requires breaking format and a verified authorized API quota probe", () => {
		const candidate = {
			sources,
			adversarialEvidence,
			activeProbes: [
				{
					id: "quota-probe",
					probeType: "authorized_api",
					status: "VERIFIED",
				},
			],
			archetypeEvidence: [
				{
					archetype: "rollout_verification" as const,
					slots: [
						slot("access_gating"),
						slot("quota_consumption", {
							activeProbeIds: ["quota-probe"],
						}),
						slot("behavior_change"),
						slot("self_report_boundary", {
							sourceIds: ["vendor", "third-party"],
							adversarialEvidenceIds: ["vendor-boundary"],
						}),
					],
				},
			],
		};

		expect(
			selectByosanNarrativeArchetype(candidate, { format: "breaking" })
				.archetype,
		).toBe("rollout_verification");
		expect(
			selectByosanNarrativeArchetype(candidate, { format: "regular" })
				.archetype,
		).toBe("standard");
	});

	test("an unverified or non-API quota observation cannot qualify rollout verification", () => {
		const baseBundle = {
			archetype: "rollout_verification" as const,
			slots: [
				slot("access_gating"),
				slot("quota_consumption", { activeProbeIds: ["quota-probe"] }),
				slot("behavior_change"),
				slot("self_report_boundary"),
			],
		};
		for (const probe of [
			{
				id: "quota-probe",
				probeType: "authorized_api",
				status: "UNVERIFIED",
			},
			{
				id: "quota-probe",
				probeType: "document_diff",
				status: "VERIFIED",
			},
		]) {
			const result = selectByosanNarrativeArchetype(
				{
					sources,
					adversarialEvidence,
					activeProbes: [probe],
					archetypeEvidence: [baseBundle],
				},
				{ format: "breaking" },
			);
			expect(result.archetype).toBe("standard");
		}
	});

	test("archetype evidence cannot reference an active probe outside the candidate", () => {
		const issues = auditByosanArchetypeEvidence({
			sources,
			adversarialEvidence,
			activeProbes: [],
			archetypeEvidence: [
				{
					archetype: "rollout_verification",
					slots: [
						slot("quota_consumption", {
							activeProbeIds: ["missing-probe"],
						}),
					],
				},
			],
		});
		expect(issues).toContainEqual({
			code: "archetype_active_probe_missing",
			details: "rollout_verification:quota_consumption:missing-probe",
		});
	});
});
