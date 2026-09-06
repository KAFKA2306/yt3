import { z } from "zod";

export const ByosanNarrativeArchetypeSchema = z.enum([
	"standard",
	"actionable_prescription",
	"paradox_resolution",
	"progressive_comparison",
	"first_principles",
	"timeline_motive",
	"role_reversal",
	"asymmetric_cost",
	"supply_chain_dependency",
	"regulatory_game_theory",
	"hardware_capital",
]);

export type ByosanNarrativeArchetype = z.infer<
	typeof ByosanNarrativeArchetypeSchema
>;

export const ByosanArchetypeEvidenceSlotSchema = z.object({
	slot: z.string().regex(/^[a-z0-9_]+$/),
	statement: z.string().min(8).max(500),
	sourceIds: z.array(z.string().min(1)).min(1).max(8),
	adversarialEvidenceIds: z.array(z.string().min(1)).max(6).optional(),
	observedAt: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
});

export const ByosanArchetypeEvidenceBundleSchema = z.object({
	archetype: ByosanNarrativeArchetypeSchema,
	slots: z.array(ByosanArchetypeEvidenceSlotSchema).min(1).max(12),
});

export type ByosanArchetypeEvidenceBundle = z.infer<
	typeof ByosanArchetypeEvidenceBundleSchema
>;

const REQUIRED_SLOTS: Record<ByosanNarrativeArchetype, readonly string[]> = {
	standard: [],
	actionable_prescription: ["pain", "cause", "prescription", "ordering"],
	paradox_resolution: [
		"fact_a",
		"fact_b",
		"hidden_mechanism",
		"catalyst_or_incentive",
	],
	progressive_comparison: ["round_1", "round_2", "round_3", "role_fit"],
	first_principles: [
		"current_pain",
		"old_model",
		"mechanism",
		"trade_off",
		"simplification_boundary",
	],
	timeline_motive: [
		"event_1",
		"event_2",
		"event_3",
		"anomaly",
		"hypothesis_1",
		"hypothesis_2",
		"incentive",
	],
	role_reversal: [
		"side_a",
		"side_b",
		"historical_mirror",
		"role_reversal",
		"disclosure_incentive",
	],
	asymmetric_cost: [
		"headline_value",
		"footnote_condition",
		"specialization_gap",
		"hidden_total_cost",
		"downside_risk",
	],
	supply_chain_dependency: [
		"surface_event",
		"contract_trigger",
		"hidden_dependency",
		"downstream_impact",
	],
	regulatory_game_theory: [
		"legal_force",
		"foreign_comparator",
		"empirical_blowback",
		"jurisdiction_asymmetry",
		"equilibrium",
	],
	hardware_capital: [
		"headline_multiplier",
		"robust_baseline",
		"physical_bottleneck",
		"supplier_capital",
		"remaining_spof",
	],
};

const PRIORITY: readonly ByosanNarrativeArchetype[] = [
	"progressive_comparison",
	"paradox_resolution",
	"timeline_motive",
	"role_reversal",
	"asymmetric_cost",
	"supply_chain_dependency",
	"regulatory_game_theory",
	"hardware_capital",
	"actionable_prescription",
	"first_principles",
];

type CandidateShape = {
	sources: Array<{ id: string }>;
	adversarialEvidence: Array<{ id: string; kind: string }>;
	archetypeEvidence?: ByosanArchetypeEvidenceBundle[];
};

type ProductionShape = {
	format: string;
};

export type ByosanNarrativeArchetypeSelection = {
	archetype: ByosanNarrativeArchetype;
	requiredSlots: string[];
	reasons: string[];
	evidence?: ByosanArchetypeEvidenceBundle;
};

export function requiredByosanArchetypeSlots(
	archetype: ByosanNarrativeArchetype,
): string[] {
	return [...REQUIRED_SLOTS[archetype]];
}

function bundleSlots(bundle: ByosanArchetypeEvidenceBundle): Set<string> {
	return new Set(bundle.slots.map((slot) => slot.slot));
}

function hasAllRequiredSlots(
	archetype: ByosanNarrativeArchetype,
	bundle: ByosanArchetypeEvidenceBundle,
): boolean {
	const slots = bundleSlots(bundle);
	return REQUIRED_SLOTS[archetype].every((slot) => slots.has(slot));
}

function bundleHasValidReferences(
	bundle: ByosanArchetypeEvidenceBundle,
	candidate: CandidateShape,
): boolean {
	const sourceIds = new Set(candidate.sources.map((source) => source.id));
	const evidenceIds = new Set(
		candidate.adversarialEvidence.map((evidence) => evidence.id),
	);
	return bundle.slots.every(
		(slot) =>
			slot.sourceIds.every((sourceId) => sourceIds.has(sourceId)) &&
			(slot.adversarialEvidenceIds ?? []).every((evidenceId) =>
				evidenceIds.has(evidenceId),
			),
	);
}

function hasRequiredAdversarialKind(
	bundle: ByosanArchetypeEvidenceBundle,
	candidate: CandidateShape,
	slotName: string,
	kinds: string[],
): boolean {
	const slot = bundle.slots.find((item) => item.slot === slotName);
	if (!slot) return false;
	const byId = new Map(
		candidate.adversarialEvidence.map((evidence) => [evidence.id, evidence]),
	);
	return (slot.adversarialEvidenceIds ?? []).some((id) =>
		kinds.includes(byId.get(id)?.kind ?? ""),
	);
}

function isEligible(
	archetype: ByosanNarrativeArchetype,
	bundle: ByosanArchetypeEvidenceBundle,
	candidate: CandidateShape,
	production: ProductionShape,
): boolean {
	if (bundle.archetype !== archetype) return false;
	if (!hasAllRequiredSlots(archetype, bundle)) return false;
	if (!bundleHasValidReferences(bundle, candidate)) return false;

	if (
		archetype === "progressive_comparison" &&
		production.format !== "comparison"
	) {
		return false;
	}

	if (archetype === "timeline_motive") {
		const datedEvents = ["event_1", "event_2", "event_3"].filter((slotName) =>
			bundle.slots.some(
				(slot) => slot.slot === slotName && Boolean(slot.observedAt),
			),
		);
		if (datedEvents.length < 3) return false;
	}

	if (
		archetype === "asymmetric_cost" &&
		!hasRequiredAdversarialKind(bundle, candidate, "footnote_condition", [
			"measurement_condition",
			"source_limitation",
		])
	) {
		return false;
	}

	return true;
}

export function selectByosanNarrativeArchetype(
	candidate: CandidateShape,
	production: ProductionShape,
): ByosanNarrativeArchetypeSelection {
	const bundles = (candidate.archetypeEvidence ?? []).map((bundle) =>
		ByosanArchetypeEvidenceBundleSchema.parse(bundle),
	);
	for (const archetype of PRIORITY) {
		const bundle = bundles.find((candidateBundle) =>
			isEligible(archetype, candidateBundle, candidate, production),
		);
		if (!bundle) continue;
		return {
			archetype,
			requiredSlots: requiredByosanArchetypeSlots(archetype),
			reasons: [
				`eligible_bundle=${archetype}`,
				`required_slots=${requiredByosanArchetypeSlots(archetype).join(",")}`,
			],
			evidence: bundle,
		};
	}
	return {
		archetype: "standard",
		requiredSlots: [],
		reasons: ["no_specialized_archetype_evidence_bundle_passed"],
	};
}

export type ByosanArchetypeEvidenceIssue = {
	code: string;
	details: string;
};

export function auditByosanArchetypeEvidence(
	candidate: CandidateShape,
): ByosanArchetypeEvidenceIssue[] {
	const issues: ByosanArchetypeEvidenceIssue[] = [];
	const sourceIds = new Set(candidate.sources.map((source) => source.id));
	const evidenceIds = new Set(
		candidate.adversarialEvidence.map((evidence) => evidence.id),
	);
	const seen = new Set<string>();
	for (const rawBundle of candidate.archetypeEvidence ?? []) {
		const bundle = ByosanArchetypeEvidenceBundleSchema.parse(rawBundle);
		if (seen.has(bundle.archetype)) {
			issues.push({
				code: "duplicate_archetype_evidence_bundle",
				details: bundle.archetype,
			});
		}
		seen.add(bundle.archetype);
		for (const slot of bundle.slots) {
			const missingSources = slot.sourceIds.filter(
				(sourceId) => !sourceIds.has(sourceId),
			);
			if (missingSources.length > 0) {
				issues.push({
					code: "archetype_evidence_source_missing",
					details: `${bundle.archetype}:${slot.slot}:${missingSources.join(",")}`,
				});
			}
			const missingEvidence = (slot.adversarialEvidenceIds ?? []).filter(
				(evidenceId) => !evidenceIds.has(evidenceId),
			);
			if (missingEvidence.length > 0) {
				issues.push({
					code: "archetype_adversarial_evidence_missing",
					details: `${bundle.archetype}:${slot.slot}:${missingEvidence.join(",")}`,
				});
			}
		}
	}
	return issues;
}
