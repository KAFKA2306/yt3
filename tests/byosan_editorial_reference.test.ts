import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import { selectByosanEditorialReferencePlan } from "../src/domain/byosan/editorial_references.js";
import {
	type ByosanFeatureSpec,
	auditByosanFeatureSpec,
} from "../src/domain/byosan/feature_spec.js";
import { fixtureAt } from "./fixtures/fixture_at.js";

const spec = fs.readJsonSync(
	"config/productions/issue_131_ai_infrastructure_bottlenecks.json",
) as ByosanFeatureSpec;

describe("byosan editorial reference plan", () => {
	test("rejects an editorial reference used as a fact source", () => {
		const plan = selectByosanEditorialReferencePlan(spec.runId, spec.angle);
		const referenceId = fixtureAt(plan.selectedReferences, 0).referenceId;
		const baseline = auditByosanFeatureSpec(spec).map((issue) => issue.code);
		const tainted = {
			...spec,
			editorialReferencePlan: plan,
			claims: spec.claims.map((claim, index) =>
				index === 0
					? { ...claim, sourceIds: [...claim.sourceIds, referenceId] }
					: claim,
			),
		};
		const codes = auditByosanFeatureSpec(tainted).map((issue) => issue.code);
		expect(codes).toContain("editorial_reference_used_as_fact_source");
		expect(baseline).not.toContain("editorial_reference_used_as_fact_source");
	});
});
