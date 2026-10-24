import { describe, expect, test } from "bun:test";
import {
	type DiscoverySourceRow,
	DiscoverySourcesSchema,
	buildChecks,
	registryPath,
	runAudit,
} from "../src/scripts/audit_byosan_discovery_sources.js";

const verifyRow: DiscoverySourceRow = {
	id: "S101",
	status: "検証用",
	priority: "A",
	issuer: "Example Issuer",
	domain: "example.com",
	url: "https://example.com/",
	category: "企業財務検証",
	cadence: "日次",
	material_class: "企業一次開示",
	collect: "売上・利益",
	caution: "提出日時を保持",
	verification: "公式ポータル",
	reuse_policy: "recreate_only",
	fetch: { type: "verify" },
};

function sourceRow(overrides: Partial<DiscoverySourceRow>): DiscoverySourceRow {
	return { ...verifyRow, ...overrides };
}

describe("byosan discovery sources schema", () => {
	test("accepts the current registry", () => {
		const checks = runAudit(registryPath());
		expect(checks.filter((check) => check.status === "FAIL")).toEqual([]);
	});

	test("rejects a row without reuse_policy", () => {
		const { reuse_policy: _omitted, ...withoutPolicy } = verifyRow;
		const result = DiscoverySourcesSchema.safeParse({
			schema_version: "byosan_discovery_sources_v1",
			sources: [withoutPolicy],
		});
		expect(result.success).toBe(false);
	});

	test("rejects an unknown reuse_policy", () => {
		const result = DiscoverySourcesSchema.safeParse({
			schema_version: "byosan_discovery_sources_v1",
			sources: [{ ...verifyRow, reuse_policy: "copy_freely" }],
		});
		expect(result.success).toBe(false);
	});
});

describe("byosan discovery sources audit", () => {
	test("reports official_open rows without reuse_terms_url", () => {
		const checks = buildChecks({
			schema_version: "byosan_discovery_sources_v1",
			sources: [sourceRow({ reuse_policy: "official_open" })],
		});
		expect(checks).toContainEqual({
			name: "reuse_terms",
			status: "FAIL",
			details: "S101",
		});
	});

	test("reports official_open rows with a non-https reuse_terms_url", () => {
		const checks = buildChecks({
			schema_version: "byosan_discovery_sources_v1",
			sources: [
				sourceRow({
					reuse_policy: "official_open",
					reuse_terms_url: "http://www.sec.gov/about/privacy-information",
				}),
			],
		});
		expect(checks).toContainEqual({
			name: "reuse_terms",
			status: "FAIL",
			details: "S101",
		});
	});

	test("accepts official_open rows with an https reuse_terms_url", () => {
		const checks = buildChecks({
			schema_version: "byosan_discovery_sources_v1",
			sources: [
				sourceRow({
					reuse_policy: "official_open",
					reuse_terms_url: "https://www.sec.gov/about/privacy-information",
				}),
			],
		});
		expect(checks).toContainEqual({
			name: "reuse_terms",
			status: "PASS",
			details: "official_open rows cite an https reuse_terms_url",
		});
	});

	test("rejects a non-https reuse_terms_url on a recreate_only row", () => {
		const checks = buildChecks({
			schema_version: "byosan_discovery_sources_v1",
			sources: [sourceRow({ reuse_terms_url: "http://example.com/terms" })],
		});
		expect(checks).toContainEqual({
			name: "reuse_terms",
			status: "FAIL",
			details: "S101",
		});
	});
});
