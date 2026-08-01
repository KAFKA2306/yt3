import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";

type SourceItem = {
	id?: string;
	name?: string;
	url?: string;
	layer?: string;
	source_class?: string;
	importance?: string;
	priority?: string;
	region?: string;
	asset_linkage?: string[];
	kafka_use?: string[];
};

type Registry = {
	schema_version?: string;
	domain?: string;
	sources?: SourceItem[];
	coverage_requirements?: {
		min_total_sources?: number;
		required_layers?: string[];
		required_source_classes?: string[];
		critical_source_ids?: string[];
	};
};

type Check = {
	name: string;
	status: "PASS" | "FAIL";
	details: string;
};

const ROOT = process.cwd();

function pass(name: string, details: string): Check {
	return { name, status: "PASS", details };
}

function fail(name: string, details: string): Check {
	return { name, status: "FAIL", details };
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function readRegistryPath(): string {
	const configPath = path.join(ROOT, "config", "domains", "byosan_money.yaml");
	const parsed = yaml.load(fs.readFileSync(configPath, "utf8")) as {
		source_policy?: { power_macro_registry?: string };
	};
	const relativePath = parsed.source_policy?.power_macro_registry;
	if (!relativePath) {
		throw new Error("source_policy.power_macro_registry is missing");
	}
	return path.join(ROOT, relativePath);
}

function buildChecks(registryPath: string, registry: Registry): Check[] {
	const sources = registry.sources || [];
	const requirements = registry.coverage_requirements || {};
	const ids = sources.map((source) => source.id || "");
	const duplicateIds = unique(
		ids.filter((id, index) => id && ids.indexOf(id) !== index),
	);
	const malformed = sources
		.filter((source) => !source.id || !source.name || !source.url)
		.map((source) => source.id || source.name || "(unknown)");
	const layers = unique(
		sources.map((source) => source.layer || "").filter(Boolean),
	);
	const sourceClasses = unique(
		sources.map((source) => source.source_class || "").filter(Boolean),
	);
	const missingLayers = (requirements.required_layers || []).filter(
		(layer) => !layers.includes(layer),
	);
	const missingSourceClasses = (
		requirements.required_source_classes || []
	).filter((sourceClass) => !sourceClasses.includes(sourceClass));
	const missingCriticalIds = (requirements.critical_source_ids || []).filter(
		(id) => !ids.includes(id),
	);
	const criticalWithoutKafkaUse = sources
		.filter((source) => source.importance === "critical")
		.filter((source) => !source.kafka_use || source.kafka_use.length === 0)
		.map((source) => source.id || "(unknown)");
	const minTotalSources = requirements.min_total_sources || 1;

	return [
		registry.schema_version === "byosan_money_power_macro_sources_v1"
			? pass("schema_version", registry.schema_version)
			: fail("schema_version", String(registry.schema_version || "(missing)")),
		registry.domain === "byosan_money"
			? pass("domain", registry.domain)
			: fail("domain", String(registry.domain || "(missing)")),
		sources.length >= minTotalSources
			? pass("source_count", `${sources.length} sources in ${registryPath}`)
			: fail("source_count", `${sources.length} < ${minTotalSources}`),
		duplicateIds.length === 0
			? pass("unique_ids", "all source ids are unique")
			: fail("unique_ids", duplicateIds.join(", ")),
		malformed.length === 0
			? pass("required_fields", "all sources have id, name, and url")
			: fail("required_fields", malformed.join(", ")),
		missingLayers.length === 0
			? pass("required_layers", layers.join(", "))
			: fail("required_layers", missingLayers.join(", ")),
		missingSourceClasses.length === 0
			? pass("required_source_classes", sourceClasses.join(", "))
			: fail("required_source_classes", missingSourceClasses.join(", ")),
		missingCriticalIds.length === 0
			? pass("critical_sources", "all critical source ids are present")
			: fail("critical_sources", missingCriticalIds.join(", ")),
		criticalWithoutKafkaUse.length === 0
			? pass("critical_kafka_use", "critical sources declare kafka_use")
			: fail("critical_kafka_use", criticalWithoutKafkaUse.join(", ")),
	];
}

function formatMarkdown(checks: Check[]): string {
	const lines = ["# Byosan Source Registry Audit", ""];
	lines.push(`Generated: ${new Date().toISOString()}`);
	lines.push("");
	for (const check of checks) {
		lines.push(
			`- ${check.status === "PASS" ? "PASS" : "FAIL"} ${check.name}: ${check.details}`,
		);
	}
	return lines.join("\n");
}

async function main() {
	const registryPath = readRegistryPath();
	const registry = fs.readJsonSync(registryPath) as Registry;
	const checks = buildChecks(registryPath, registry);
	const outDir = path.join(ROOT, "logs");
	await fs.ensureDir(outDir);
	await fs.writeJson(
		path.join(outDir, "byosan_source_registry_audit.json"),
		checks,
		{
			spaces: 2,
		},
	);
	await fs.writeFile(
		path.join(outDir, "byosan_source_registry_audit.md"),
		`${formatMarkdown(checks)}\n`,
	);
	console.log(formatMarkdown(checks));
	if (checks.some((check) => check.status === "FAIL")) {
		process.exit(1);
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
