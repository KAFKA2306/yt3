import { describe, expect, test } from "bun:test";
import {
	type DancerManifest,
	validateDancerManifest,
} from "../src/scripts/import_dancer_artifact.js";

function validManifest(): DancerManifest {
	return {
		schema_version: 1,
		run_id: "dancer-0123456789abcdef0123",
		presentation_audit: { passed: true },
		compliance: { passed: true, contains_synthetic_media: false },
	};
}

describe("dancer manifest import gate", () => {
	test("accepts a manifest only after presentation and compliance audits pass", () => {
		expect(() => validateDancerManifest(validManifest())).not.toThrow();
	});

	test("rejects metadata/thumbnail contradictions before any publication work", () => {
		const manifest = validManifest();
		manifest.presentation_audit = { passed: false };
		expect(() => validateDancerManifest(manifest)).toThrow(
			"metadata/thumbnail contradiction gate",
		);
	});

	test("rejects rights/provenance failure before any publication work", () => {
		const manifest = validManifest();
		manifest.compliance = { passed: false };
		expect(() => validateDancerManifest(manifest)).toThrow(
			"rights/provenance compliance gate",
		);
	});
});
