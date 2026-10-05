import type { Database } from "bun:sqlite";
import { z } from "zod";

const NonEmptyText = z.string().trim().min(1);
const EpisodeFields = {
	episode_id: NonEmptyText,
	claim: NonEmptyText,
	source_reference: NonEmptyText,
};

/**
 * These classes describe the strength of a recorded claim, not the metric's
 * source API. CAUSAL records require a reference to the controlled design;
 * persistence itself does not certify that design as causally sufficient.
 */
export const ExperienceEvidenceRecordSchema = z.discriminatedUnion(
	"evidence_class",
	[
		z
			.object({ ...EpisodeFields, evidence_class: z.literal("OBSERVED") })
			.strict(),
		z
			.object({
				...EpisodeFields,
				evidence_class: z.literal("ASSOCIATED"),
				treatment: NonEmptyText,
				outcome_metric: NonEmptyText,
			})
			.strict(),
		z
			.object({
				...EpisodeFields,
				evidence_class: z.literal("EXPERIMENTAL"),
				treatment: NonEmptyText,
				outcome_metric: NonEmptyText,
				experiment_id: NonEmptyText,
			})
			.strict(),
		z
			.object({
				...EpisodeFields,
				evidence_class: z.literal("CAUSAL"),
				treatment: NonEmptyText,
				outcome_metric: NonEmptyText,
				experiment_id: NonEmptyText,
				causal_design_reference: NonEmptyText,
			})
			.strict(),
	],
);

export type ExperienceEvidenceRecord = z.infer<
	typeof ExperienceEvidenceRecordSchema
>;

export function ensureExperienceEvidenceTable(db: Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS experience_evidence (
			evidence_id INTEGER PRIMARY KEY AUTOINCREMENT,
			episode_id TEXT NOT NULL CHECK (length(trim(episode_id)) > 0),
			evidence_class TEXT NOT NULL CHECK (
				evidence_class IN ('OBSERVED', 'ASSOCIATED', 'EXPERIMENTAL', 'CAUSAL')
			),
			claim TEXT NOT NULL CHECK (length(trim(claim)) > 0),
			source_reference TEXT NOT NULL CHECK (length(trim(source_reference)) > 0),
			treatment TEXT,
			outcome_metric TEXT,
			experiment_id TEXT,
			causal_design_reference TEXT,
			recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
			CHECK (
				evidence_class = 'OBSERVED' OR
				(treatment IS NOT NULL AND outcome_metric IS NOT NULL)
			),
			CHECK (
				evidence_class NOT IN ('EXPERIMENTAL', 'CAUSAL') OR
				experiment_id IS NOT NULL
			),
			CHECK (evidence_class <> 'CAUSAL' OR causal_design_reference IS NOT NULL)
		)
	`);
	db.exec(`
		CREATE INDEX IF NOT EXISTS experience_evidence_episode_class_idx
		ON experience_evidence (episode_id, evidence_class)
	`);
}

/** Append evidence; an updated observation is recorded as a new row. */
export function saveExperienceEvidence(
	db: Database,
	input: ExperienceEvidenceRecord,
): string {
	const record = ExperienceEvidenceRecordSchema.parse(input);
	ensureExperienceEvidenceTable(db);
	const result = db
		.prepare(`
		INSERT INTO experience_evidence (
			episode_id, evidence_class, claim, source_reference, treatment,
			outcome_metric, experiment_id, causal_design_reference
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`)
		.run(
			record.episode_id,
			record.evidence_class,
			record.claim,
			record.source_reference,
			"treatment" in record ? record.treatment : null,
			"outcome_metric" in record ? record.outcome_metric : null,
			"experiment_id" in record ? record.experiment_id : null,
			"causal_design_reference" in record
				? record.causal_design_reference
				: null,
		);
	return String(result.lastInsertRowid);
}
