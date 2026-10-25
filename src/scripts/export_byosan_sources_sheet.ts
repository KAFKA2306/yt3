import { createHash } from "node:crypto";
import {
	type DiscoverySourceRow,
	type DiscoverySourcesDocument,
	loadDiscoverySources,
	registryPath,
} from "../domain/byosan/discovery_sources.js";

const COLUMNS = [
	"id",
	"status",
	"priority",
	"issuer",
	"domain",
	"url",
	"category",
	"cadence",
	"material_class",
	"collect",
	"caution",
	"verification",
	"reuse_policy",
	"reuse_terms_url",
	"fetch_type",
	"fetch_json",
] as const;

type Column = (typeof COLUMNS)[number];

function toRecord(source: DiscoverySourceRow): Record<Column, string> {
	return {
		id: source.id,
		status: source.status,
		priority: source.priority,
		issuer: source.issuer,
		domain: source.domain,
		url: source.url,
		category: source.category,
		cadence: source.cadence,
		material_class: source.material_class,
		collect: source.collect,
		caution: source.caution,
		verification: source.verification,
		reuse_policy: source.reuse_policy,
		reuse_terms_url: source.reuse_terms_url ?? "",
		fetch_type: source.fetch?.type ?? "",
		fetch_json: source.fetch ? JSON.stringify(source.fetch) : "",
	};
}

function toTsv(doc: DiscoverySourcesDocument): string {
	const rows = doc.sources.map((source) => {
		const record = toRecord(source);
		return COLUMNS.map((column) => {
			const cell = record[column];
			if (/[\t\r\n]/.test(cell)) {
				throw new Error(`${source.id}.${column} contains a tab or newline`);
			}
			return cell;
		}).join("\t");
	});
	return `${[COLUMNS.join("\t"), ...rows].join("\n")}\n`;
}

if (import.meta.main) {
	const tsv = toTsv(loadDiscoverySources(registryPath()));
	process.stdout.write(tsv);
	process.stderr.write(
		`sha256=${createHash("sha256").update(tsv).digest("hex")}\n`,
	);
}
