import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
import { fromJSONSchema } from "zod";
import type { SourceFetch } from "./feed_discovery.js";

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
