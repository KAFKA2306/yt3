import { describe, expect, test } from "bun:test";
import {
	type DiscoverySourceRow,
	DiscoverySourcesSchema,
	loadDiscoverySources,
	registryPath,
} from "../src/domain/byosan/discovery_sources.js";

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

describe("byosan discovery sources schema", () => {
	test("accepts the current registry", () => {
		expect(() => loadDiscoverySources(registryPath())).not.toThrow();
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
