import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
	ExperienceEvidenceRecordSchema,
	saveExperienceEvidence,
} from "../src/domain/experience/evidence_store.js";

describe("Experience evidence store", () => {
	test("keeps evidence append-only and requires a causal-design reference", () => {
		const db = new Database(":memory:");
		try {
			const observed = {
				episode_id: "byosan_money/2026-10-05-nvii",
				evidence_class: "OBSERVED",
				claim: "The observed CTR was 4%.",
				source_reference: "youtube-analytics://video-1/first_7d",
			} as const;
			saveExperienceEvidence(db, observed);
			saveExperienceEvidence(db, observed);
			expect(
				db.query("SELECT count(*) AS count FROM experience_evidence").get(),
			).toEqual({ count: 2 });

			expect(
				ExperienceEvidenceRecordSchema.safeParse({
					episode_id: observed.episode_id,
					evidence_class: "CAUSAL",
					claim: "An unsupported causal claim.",
					source_reference: "report://unknown",
					treatment: "hook A",
					outcome_metric: "retention",
					experiment_id: "experiment-1",
				}).success,
			).toBe(false);
			expect(
				ExperienceEvidenceRecordSchema.safeParse({
					episode_id: observed.episode_id,
					evidence_class: "EXPERIMENTAL",
					claim: "An experiment without an identifier.",
					source_reference: "report://unknown",
					treatment: "hook A",
					outcome_metric: "retention",
				}).success,
			).toBe(false);
			expect(
				ExperienceEvidenceRecordSchema.safeParse({
					...observed,
					unsupported_metadata: "not silently accepted",
				}).success,
			).toBe(false);
		} finally {
			db.close();
		}
	});
});
