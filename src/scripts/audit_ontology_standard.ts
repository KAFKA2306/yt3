import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

type CheckResult = {
	name: string;
	ok: boolean;
	message: string;
};

const ROOT = process.cwd();
const TYPE_STATUSES = new Set(["implemented", "conceptual"]);
const RELATION_STATUSES = new Set(["implemented", "proposed"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function record(
	results: CheckResult[],
	name: string,
	ok: boolean,
	message: string,
) {
	results.push({ name, ok, message });
}

async function readTextIfExists(filePath: string): Promise<string | null> {
	try {
		return await fs.readFile(filePath, "utf8");
	} catch {
		return null;
	}
}

function checkContains(
	results: CheckResult[],
	name: string,
	text: string | null,
	required: string[],
) {
	if (text === null) {
		record(results, name, false, "file missing");
		return;
	}

	const missing = required.filter((needle) => !text.includes(needle));
	record(
		results,
		name,
		missing.length === 0,
		missing.length === 0
			? "all required markers present"
			: `missing markers: ${missing.join(", ")}`,
	);
}

function validateOntologyDefinition(
	results: CheckResult[],
	definitionText: string | null,
) {
	if (definitionText === null) {
		record(
			results,
			"ontology_definition_yaml",
			false,
			"file missing: config/ontology/yt3.yaml",
		);
		return;
	}

	let definition: unknown;
	try {
		definition = yaml.load(definitionText);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		record(
			results,
			"ontology_definition_yaml",
			false,
			`cannot parse config/ontology/yt3.yaml: ${detail}`,
		);
		return;
	}

	if (!isRecord(definition)) {
		record(
			results,
			"ontology_definition_yaml",
			false,
			"root must be a YAML mapping",
		);
		return;
	}
	record(
		results,
		"ontology_definition_yaml",
		true,
		"config/ontology/yt3.yaml parsed as a mapping",
	);

	const metadataErrors: string[] = [];
	const schemaVersion = definition.schema_version;
	if (
		typeof schemaVersion !== "number" ||
		!Number.isInteger(schemaVersion) ||
		schemaVersion < 1
	) {
		metadataErrors.push("schema_version must be a positive integer");
	}
	for (const field of ["id", "label"]) {
		if (!isNonEmptyString(definition[field])) {
			metadataErrors.push(`${field} must be a non-empty string`);
		}
	}
	if (definition.role !== "local domain vocabulary") {
		metadataErrors.push('role must be "local domain vocabulary"');
	}
	if (definition.conformance_claim !== "none") {
		metadataErrors.push('conformance_claim must be "none"');
	}
	if (!isRecord(definition.top_level_ontology)) {
		metadataErrors.push("top_level_ontology must be a mapping");
	} else {
		for (const field of ["status", "reference", "reference_role"]) {
			if (!isNonEmptyString(definition.top_level_ontology[field])) {
				metadataErrors.push(
					`top_level_ontology.${field} must be a non-empty string`,
				);
			}
		}
	}
	record(
		results,
		"ontology_definition_metadata",
		metadataErrors.length === 0,
		metadataErrors.length === 0
			? "required metadata is valid; no ISO conformance claim is made"
			: metadataErrors.join("; "),
	);

	const typeErrors: string[] = [];
	const declaredTypeIds = new Set<string>();
	const rawTypes = definition.types;
	if (!Array.isArray(rawTypes) || rawTypes.length === 0) {
		typeErrors.push("types must be a non-empty array");
	} else {
		for (const [index, rawType] of rawTypes.entries()) {
			const typePath = `types[${index}]`;
			if (!isRecord(rawType)) {
				typeErrors.push(`${typePath} must be a mapping`);
				continue;
			}
			for (const field of ["id", "label", "scope", "description"]) {
				if (!isNonEmptyString(rawType[field])) {
					typeErrors.push(`${typePath}.${field} must be a non-empty string`);
				}
			}
			const status = rawType.status;
			if (!isNonEmptyString(status) || !TYPE_STATUSES.has(status)) {
				typeErrors.push(
					`${typePath}.status must be one of: ${[...TYPE_STATUSES].join(", ")}`,
				);
			}
			if (
				!Array.isArray(rawType.evidence) ||
				rawType.evidence.length === 0 ||
				!rawType.evidence.every(isNonEmptyString)
			) {
				typeErrors.push(
					`${typePath}.evidence must be a non-empty array of strings`,
				);
			}
			if (isNonEmptyString(rawType.id)) {
				if (declaredTypeIds.has(rawType.id)) {
					typeErrors.push(`${typePath}.id duplicates type ID "${rawType.id}"`);
				} else {
					declaredTypeIds.add(rawType.id);
				}
			}
		}
	}
	record(
		results,
		"ontology_definition_types",
		typeErrors.length === 0,
		typeErrors.length === 0
			? `${declaredTypeIds.size} type definitions are valid`
			: typeErrors.join("; "),
	);

	const relationErrors: string[] = [];
	const relationIds = new Set<string>();
	const rawRelations = definition.relations;
	if (!Array.isArray(rawRelations) || rawRelations.length === 0) {
		relationErrors.push("relations must be a non-empty array");
	} else {
		for (const [index, rawRelation] of rawRelations.entries()) {
			const relationPath = `relations[${index}]`;
			if (!isRecord(rawRelation)) {
				relationErrors.push(`${relationPath} must be a mapping`);
				continue;
			}
			for (const field of ["id", "source", "target", "predicate"]) {
				if (!isNonEmptyString(rawRelation[field])) {
					relationErrors.push(
						`${relationPath}.${field} must be a non-empty string`,
					);
				}
			}
			const status = rawRelation.status;
			if (!isNonEmptyString(status) || !RELATION_STATUSES.has(status)) {
				relationErrors.push(
					`${relationPath}.status must be one of: ${[...RELATION_STATUSES].join(", ")}`,
				);
			}
			if (
				!Array.isArray(rawRelation.evidence) ||
				rawRelation.evidence.length === 0 ||
				!rawRelation.evidence.every(isNonEmptyString)
			) {
				relationErrors.push(
					`${relationPath}.evidence must be a non-empty array of strings`,
				);
			}
			if (isNonEmptyString(rawRelation.id)) {
				if (relationIds.has(rawRelation.id)) {
					relationErrors.push(
						`${relationPath}.id duplicates relation ID "${rawRelation.id}"`,
					);
				} else {
					relationIds.add(rawRelation.id);
				}
			}
			for (const endpoint of ["source", "target"] as const) {
				const typeId = rawRelation[endpoint];
				if (isNonEmptyString(typeId) && !declaredTypeIds.has(typeId)) {
					relationErrors.push(
						`${relationPath}.${endpoint} references undeclared type "${typeId}"`,
					);
				}
			}
		}
	}
	record(
		results,
		"ontology_definition_relations",
		relationErrors.length === 0,
		relationErrors.length === 0
			? `${relationIds.size} relation definitions are valid and resolve to declared types`
			: relationErrors.join("; "),
	);
}

async function main() {
	const results: CheckResult[] = [];

	const standardsDirectory = path.join(ROOT, "docs/standard");
	const standardPath = path.join(ROOT, "docs/standard/ontology-standard.md");
	const termsPath = path.join(
		ROOT,
		"src/domain/humanity_audit/humanity_audit_terms.ts",
	);
	const taskfilePath = path.join(ROOT, "Taskfile.yml");
	const packageJsonPath = path.join(ROOT, "package.json");
	const doctorPath = path.join(ROOT, "src/scripts/harness_doctor.ts");
	const ontologyDefinitionPath = path.join(ROOT, "config/ontology/yt3.yaml");

	const standardText = await readTextIfExists(standardPath);
	const standardFiles = await fs.readdir(standardsDirectory);
	const termsText = await readTextIfExists(termsPath);
	const taskfileText = await readTextIfExists(taskfilePath);
	const packageText = await readTextIfExists(packageJsonPath);
	const doctorText = await readTextIfExists(doctorPath);
	const ontologyDefinitionText = await readTextIfExists(ontologyDefinitionPath);
	validateOntologyDefinition(results, ontologyDefinitionText);
	const ontologyDocs = standardFiles.filter((file) =>
		file.includes("ontology"),
	);
	record(
		results,
		"single_ontology_standard",
		ontologyDocs.length === 1 && ontologyDocs[0] === "ontology-standard.md",
		ontologyDocs.length === 1 && ontologyDocs[0] === "ontology-standard.md"
			? "one canonical ontology standard exists"
			: `expected only ontology-standard.md; found ${ontologyDocs.join(", ") || "none"}`,
	);

	checkContains(results, "ontology_standard", standardText, [
		"ISO/IEC 21838-1:2021",
		"ISO 5127:2017",
		"ISO/IEC TR 20943-6:2013",
		"local domain vocabulary",
		"machine-checkable",
		"task audit:ontology",
		"top-level ontology",
	]);

	checkContains(results, "humanity_terms", termsText, [
		"Mundane Object Lexicon",
		"local domain vocabulary",
		"projectOntologyAlignment",
		"ISO/IEC 21838-1:2021",
	]);

	checkContains(results, "taskfile_entry", taskfileText, ["audit:ontology"]);
	checkContains(results, "package_json_script", packageText, [
		'"audit:ontology"',
	]);
	checkContains(results, "doctor_hook", doctorText, ["audit:ontology"]);

	for (const result of results) {
		const icon = result.ok ? "✅" : "❌";
		console.log(`[${icon}] ${result.name}: ${result.message}`);
	}

	if (results.some((result) => !result.ok)) {
		process.exit(1);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack || error.message : error);
	process.exit(1);
});
