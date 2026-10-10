import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";

const SURFACES = [
	"caption",
	"structure",
	"cuts",
	"visual",
	"chart",
	"thumbnail",
] as const;
const ROLE_GROUPS = [
	"presentation",
	"visualization",
	"storytelling",
	"data",
	"thumbnail",
] as const;

export const ByosanEditorialReferenceSurfaceSchema = z.enum(SURFACES);
export const ByosanEditorialReferenceRoleGroupSchema = z.enum(ROLE_GROUPS);

const EditorialReferenceConfigSchema = z.object({
	id: z.string().regex(/^[a-z0-9_]+$/),
	name: z.string().min(2),
	url: z.string().url(),
	role: z.string().min(2),
	roleGroup: ByosanEditorialReferenceRoleGroupSchema,
	extractableElements: z.array(z.string().min(4)).min(2).max(6),
	surfaces: z.array(ByosanEditorialReferenceSurfaceSchema).min(1).max(3),
	doNotCopy: z.array(z.string().min(4)).min(2).max(4),
});

const EditorialReferenceRegistrySchema = z.object({
	schemaVersion: z.literal("byosan_editorial_reference_registry_v1"),
	domain: z.literal("byosan_money"),
	sourceClass: z.literal("editorial_reference"),
	references: z.array(EditorialReferenceConfigSchema).length(12),
});

const EditorialReferencePlanItemSchema = z.object({
	referenceId: z.string().regex(/^[a-z0-9_]+$/),
	role: z.string().min(2).max(40),
	roleGroup: ByosanEditorialReferenceRoleGroupSchema,
	surface: ByosanEditorialReferenceSurfaceSchema,
	element: z.string().min(4).max(80),
	application: z.string().min(12).max(180),
	provenance: z.literal("editorial_reference_observation"),
	avoidImitation: z.string().min(12).max(180),
});

export const ByosanEditorialReferencePlanSchema = z.object({
	schemaVersion: z.literal("byosan_editorial_reference_plan_v1"),
	selectionSeed: z.string().min(8).max(240),
	selectedReferences: z.array(EditorialReferencePlanItemSchema).min(3).max(5),
	combinationPolicy: z.literal("vary_per_run_3_to_5_sources_no_fixed_combo"),
});

export type ByosanEditorialReference = z.infer<
	typeof EditorialReferenceConfigSchema
>;
export type ByosanEditorialReferencePlan = z.infer<
	typeof ByosanEditorialReferencePlanSchema
>;
export type ByosanEditorialReferencePlanItem =
	ByosanEditorialReferencePlan["selectedReferences"][number];

const registryPath = path.resolve(
	import.meta.dir,
	"../../../config/references/byosan_money_editorial_references.json",
);
const loadedRegistry = EditorialReferenceRegistrySchema.parse(
	fs.readJsonSync(registryPath),
);

export const BYOSAN_EDITORIAL_REFERENCES = loadedRegistry.references;
const REFERENCE_BY_ID = new Map(
	BYOSAN_EDITORIAL_REFERENCES.map((reference) => [reference.id, reference]),
);

function stableHash(value: string): number {
	return crypto.createHash("sha256").update(value).digest().readUInt32BE(0);
}

function shuffledReferences(seed: string): ByosanEditorialReference[] {
	const references = [...BYOSAN_EDITORIAL_REFERENCES];
	for (let index = references.length - 1; index > 0; index--) {
		const swapIndex = stableHash(`${seed}:shuffle:${index}`) % (index + 1);
		const current = references[index];
		const replacement = references[swapIndex];
		if (!current || !replacement) continue;
		references[index] = replacement;
		references[swapIndex] = current;
	}
	return references;
}

function applicationFor(
	reference: ByosanEditorialReference,
	element: string,
): string {
	const applications: Record<string, string> = {
		presentation: `「${element}」を、話者・章・画面更新の設計へ分解して適用する`,
		visualization: `「${element}」を、主張を一つに絞った図解の判断へ適用する`,
		storytelling: `「${element}」を、問いから発見へ進む順序の設計へ適用する`,
		data: `「${element}」を、軸・単位・期間を持つデータ表示へ適用する`,
		thumbnail: `「${element}」を、短文・主役・余白のサムネ構図へ適用する`,
	};
	return (
		applications[reference.roleGroup] ?? `「${element}」を画面設計へ適用する`
	);
}

function planItem(
	reference: ByosanEditorialReference,
	seed: string,
): ByosanEditorialReferencePlanItem {
	const element =
		reference.extractableElements[
			stableHash(`${seed}:element:${reference.id}`) %
				reference.extractableElements.length
		];
	const surface =
		reference.surfaces[
			stableHash(`${seed}:surface:${reference.id}`) % reference.surfaces.length
		];
	if (!element || !surface)
		throw new Error(`BYOSAN_EDITORIAL_REFERENCE_INVALID: ${reference.id}`);
	return {
		referenceId: reference.id,
		role: reference.role,
		roleGroup: reference.roleGroup,
		surface,
		element,
		application: applicationFor(reference, element),
		provenance: "editorial_reference_observation",
		avoidImitation: `${reference.name}の固有表現・素材・結論は使わず、${reference.doNotCopy[0]}を避ける`,
	};
}

export function selectByosanEditorialReferencePlan(
	runId: string,
	angle: string,
): ByosanEditorialReferencePlan {
	const selectionSeed = `${runId}|${angle}`;
	const targetCount = 3 + (stableHash(`${selectionSeed}:count`) % 3);
	const shuffled = shuffledReferences(selectionSeed);
	const selected: ByosanEditorialReference[] = [];
	const groups = new Set<string>();
	for (const reference of shuffled) {
		if (selected.length >= targetCount) break;
		if (
			groups.has(reference.roleGroup) &&
			selected.length < Math.min(3, targetCount)
		)
			continue;
		selected.push(reference);
		groups.add(reference.roleGroup);
	}
	for (const reference of shuffled) {
		if (selected.length >= targetCount) break;
		if (!selected.some((item) => item.id === reference.id))
			selected.push(reference);
	}
	const plan = {
		schemaVersion: "byosan_editorial_reference_plan_v1" as const,
		selectionSeed,
		selectedReferences: selected.map((reference) =>
			planItem(reference, selectionSeed),
		),
		combinationPolicy: "vary_per_run_3_to_5_sources_no_fixed_combo" as const,
	};
	return auditByosanEditorialReferencePlan(plan);
}

export function auditByosanEditorialReferencePlan(
	input: unknown,
): ByosanEditorialReferencePlan {
	const plan = ByosanEditorialReferencePlanSchema.parse(input);
	const ids = new Set<string>();
	const groups = new Set<string>();
	for (const item of plan.selectedReferences) {
		if (ids.has(item.referenceId)) {
			throw new Error(
				`BYOSAN_EDITORIAL_REFERENCE_DUPLICATE: ${item.referenceId}`,
			);
		}
		ids.add(item.referenceId);
		groups.add(item.roleGroup);
		const reference = REFERENCE_BY_ID.get(item.referenceId);
		if (!reference)
			throw new Error(
				`BYOSAN_EDITORIAL_REFERENCE_UNKNOWN: ${item.referenceId}`,
			);
		if (
			reference.role !== item.role ||
			reference.roleGroup !== item.roleGroup
		) {
			throw new Error(
				`BYOSAN_EDITORIAL_REFERENCE_ROLE_MISMATCH: ${item.referenceId}`,
			);
		}
		if (!reference.surfaces.includes(item.surface)) {
			throw new Error(
				`BYOSAN_EDITORIAL_REFERENCE_SURFACE_MISMATCH: ${item.referenceId}`,
			);
		}
		if (!reference.extractableElements.includes(item.element)) {
			throw new Error(
				`BYOSAN_EDITORIAL_REFERENCE_ELEMENT_MISMATCH: ${item.referenceId}`,
			);
		}
	}
	if (groups.size < 3) {
		throw new Error(
			"BYOSAN_EDITORIAL_REFERENCE_NOT_VARIED: at least three role groups are required",
		);
	}
	return plan;
}

export function editorialReferenceIds(
	plan: ByosanEditorialReferencePlan,
): Set<string> {
	return new Set(plan.selectedReferences.map((item) => item.referenceId));
}

export function isByosanEditorialReferenceId(id: string): boolean {
	return REFERENCE_BY_ID.has(id);
}

export function editorialReferenceForId(id: string): ByosanEditorialReference {
	const reference = REFERENCE_BY_ID.get(id);
	if (!reference) throw new Error(`BYOSAN_EDITORIAL_REFERENCE_UNKNOWN: ${id}`);
	return reference;
}
