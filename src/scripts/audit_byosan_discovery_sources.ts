import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
import { fromJSONSchema } from "zod";
import type { SourceFetch } from "../domain/byosan/feed_discovery.js";

type ReusePolicy = "recreate_only" | "quote_with_attribution" | "official_open";

export type DiscoverySourceRow = {
	id: string;
	status: "採用" | "検証用";
	priority: string;
	issuer: string;
	domain: string;
	url: string;
	category: string;
	cadence: string;
	material_class: string;
	collect: string;
	caution: string;
	verification: string;
	reuse_policy: ReusePolicy;
	reuse_terms_url?: string;
	fetch?: SourceFetch;
};

export type DiscoverySourcesDocument = {
	schema_version: "byosan_discovery_sources_v1";
	sources: DiscoverySourceRow[];
};

export type Check = {
	name: string;
	status: "PASS" | "FAIL";
	details: string;
};

const ROOT = process.cwd();
const SCHEMA_PATH = path.join(
	ROOT,
	"config",
	"schemas",
	"byosan_discovery_sources_v1.json",
);
const DOMAIN_CONFIG_PATH = path.join(
	ROOT,
	"config",
	"domains",
	"byosan_money.yaml",
);

export const DiscoverySourcesSchema = fromJSONSchema(
	fs.readJsonSync(SCHEMA_PATH),
);

export function registryPath(): string {
	const config = yaml.load(fs.readFileSync(DOMAIN_CONFIG_PATH, "utf8")) as {
		discovery: { registry: string };
	};
	return path.join(ROOT, config.discovery.registry);
}

export function loadDiscoverySources(
	filePath: string = registryPath(),
): DiscoverySourcesDocument {
	return DiscoverySourcesSchema.parse(
		fs.readJsonSync(filePath),
	) as DiscoverySourcesDocument;
}

function pass(name: string, details: string): Check {
	return { name, status: "PASS", details };
}

function fail(name: string, details: string): Check {
	return { name, status: "FAIL", details };
}

function fetchUrls(source: DiscoverySourceRow): string[] {
	const fetch = source.fetch;
	return fetch && "url" in fetch ? [fetch.url] : [];
}

function isHttpsUrl(value: string): boolean {
	return URL.canParse(value) && new URL(value).protocol === "https:";
}

export function buildChecks(doc: DiscoverySourcesDocument): Check[] {
	const ids = doc.sources.map((source) => source.id);
	const duplicateIds = [
		...new Set(ids.filter((id, index) => ids.indexOf(id) !== index)),
	];
	const invalidUrlIds = doc.sources
		.filter((source) =>
			[source.url, ...fetchUrls(source)].some((url) => !isHttpsUrl(url)),
		)
		.map((source) => source.id);
	const adoptedWithoutFetch = doc.sources
		.filter((source) => source.status === "採用" && source.fetch === undefined)
		.map((source) => source.id);
	const reuseTermsIds = doc.sources
		.filter((source) =>
			source.reuse_policy === "official_open"
				? !isHttpsUrl(source.reuse_terms_url ?? "")
				: source.reuse_terms_url !== undefined &&
					!isHttpsUrl(source.reuse_terms_url),
		)
		.map((source) => source.id);

	return [
		duplicateIds.length === 0
			? pass("unique_ids", `${ids.length} source ids are unique`)
			: fail("unique_ids", duplicateIds.join(", ")),
		invalidUrlIds.length === 0
			? pass("url_format", "all source and fetch urls are https")
			: fail("url_format", invalidUrlIds.join(", ")),
		adoptedWithoutFetch.length === 0
			? pass("adopted_fetch", "all 採用 sources define fetch")
			: fail("adopted_fetch", adoptedWithoutFetch.join(", ")),
		reuseTermsIds.length === 0
			? pass("reuse_terms", "official_open rows cite an https reuse_terms_url")
			: fail("reuse_terms", reuseTermsIds.join(", ")),
	];
}

export function runAudit(filePath: string): Check[] {
	const result = DiscoverySourcesSchema.safeParse(fs.readJsonSync(filePath));
	if (!result.success) {
		return [
			fail(
				"schema",
				result.error.issues
					.map(
						(issue) => `${issue.path.map(String).join(".")}: ${issue.message}`,
					)
					.join("; "),
			),
		];
	}
	const doc = result.data as DiscoverySourcesDocument;
	return [
		pass("schema", `${doc.sources.length} sources in ${filePath}`),
		...buildChecks(doc),
	];
}

if (import.meta.main) {
	const checks = runAudit(registryPath());
	for (const check of checks) {
		console.log(`${check.status} ${check.name}: ${check.details}`);
	}
	if (checks.some((check) => check.status === "FAIL")) {
		process.exit(1);
	}
}
