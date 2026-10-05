import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	ExperienceEvidenceRecordSchema,
	saveExperienceEvidence,
} from "../src/domain/experience/evidence_store.js";
import type { ExperienceEvidenceRecord } from "../src/domain/experience/evidence_store.js";
import { recordExperienceEvidenceFromFile } from "../src/scripts/record_experience_evidence.js";

describe("Experience evidence store", () => {
	test("persists evidence class and its source without collapsing claims", () => {
		const db = new Database(":memory:");
		try {
			const records = [
				{
					episode_id: "byosan_money/2026-10-05-nvii",
					evidence_class: "OBSERVED",
					claim: "The episode reached 1,000 views in its first week.",
					source_reference: "youtube-analytics://video-1/first_7d",
				},
				{
					episode_id: "byosan_money/2026-10-05-nvii",
					evidence_class: "ASSOCIATED",
					claim:
						"Episodes with a coin-rain hook had higher first-three-second retention.",
					source_reference: "report://hook-retention/v1",
					treatment: "coin-rain hook",
					outcome_metric: "first_3s_audience_watch_ratio",
				},
				{
					episode_id: "byosan_money/2026-10-05-nvii",
					evidence_class: "EXPERIMENTAL",
					claim:
						"Variant B outperformed A in the registered thumbnail experiment.",
					source_reference: "experiment://thumbnail-2026-10",
					treatment: "thumbnail variant B",
					outcome_metric: "thumbnail_impressions_ctr",
					experiment_id: "thumbnail-2026-10",
				},
				{
					episode_id: "byosan_money/2026-10-05-nvii",
					evidence_class: "CAUSAL",
					claim:
						"The randomized hook test increased first-three-second retention.",
					source_reference: "experiment://hook-randomized-2026-10",
					treatment: "coin-rain hook",
					outcome_metric: "first_3s_audience_watch_ratio",
					experiment_id: "hook-randomized-2026-10",
					causal_design_reference: "design://hook-randomized-2026-10",
				},
			] satisfies ExperienceEvidenceRecord[];

			for (const record of records) saveExperienceEvidence(db, record);

			expect(
				db
					.query(
						"SELECT episode_id, evidence_class, claim, source_reference, treatment, outcome_metric, experiment_id, causal_design_reference FROM experience_evidence ORDER BY evidence_id",
					)
					.all(),
			).toEqual(
				records.map((record) => ({
					episode_id: record.episode_id,
					evidence_class: record.evidence_class,
					claim: record.claim,
					source_reference: record.source_reference,
					treatment: "treatment" in record ? record.treatment : null,
					outcome_metric:
						"outcome_metric" in record ? record.outcome_metric : null,
					experiment_id:
						"experiment_id" in record ? record.experiment_id : null,
					causal_design_reference:
						"causal_design_reference" in record
							? record.causal_design_reference
							: null,
				})),
			);
		} finally {
			db.close();
		}
	});

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

	test("validates a JSON record before appending it to the canonical store", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "yt3-evidence-"));
		const inputPath = path.join(directory, "record.json");
		const databasePath = path.join(directory, "evolution.db");
		try {
			await writeFile(
				inputPath,
				JSON.stringify({
					episode_id: "byosan_money/2026-10-05-nvii",
					evidence_class: "ASSOCIATED",
					claim: "The hook and retention moved together.",
					source_reference: "report://hook-retention/v1",
					treatment: "coin-rain hook",
					outcome_metric: "first_3s_audience_watch_ratio",
				}),
			);

			const saved = await recordExperienceEvidenceFromFile(
				inputPath,
				databasePath,
			);
			expect(saved).toMatchObject({
				episode_id: "byosan_money/2026-10-05-nvii",
				evidence_class: "ASSOCIATED",
			});

			const db = new Database(databasePath, { readonly: true });
			try {
				expect(
					db.query("SELECT evidence_class FROM experience_evidence").get(),
				).toEqual({ evidence_class: "ASSOCIATED" });
			} finally {
				db.close();
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
