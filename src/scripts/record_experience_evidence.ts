import { Database } from "bun:sqlite";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
	ExperienceEvidenceRecordSchema,
	saveExperienceEvidence,
} from "../domain/experience/evidence_store.js";

const DB_FILE = "db/evolution.db";

function parseInputPath(argv: string[]): string {
	if (
		argv.length !== 2 ||
		argv[0] !== "--input" ||
		!argv[1]?.trim() ||
		argv[1].startsWith("--")
	)
		return "";
	return argv[1];
}

export async function recordExperienceEvidenceFromFile(
	inputPath: string,
	databasePath = DB_FILE,
): Promise<{
	evidence_id: string;
	episode_id: string;
	evidence_class: string;
}> {
	const parsed = ExperienceEvidenceRecordSchema.parse(
		JSON.parse(await readFile(path.resolve(inputPath), "utf8")),
	);
	const resolvedDatabasePath = path.resolve(databasePath);
	await mkdir(path.dirname(resolvedDatabasePath), { recursive: true });
	const db = new Database(resolvedDatabasePath);
	try {
		const evidenceId = saveExperienceEvidence(db, parsed);
		return {
			evidence_id: evidenceId,
			episode_id: parsed.episode_id,
			evidence_class: parsed.evidence_class,
		};
	} finally {
		db.close();
	}
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
	const inputPath = parseInputPath(argv);
	if (!inputPath) {
		console.error("usage: task experience:evidence:record INPUT=<record.json>");
		return 2;
	}
	try {
		console.log(
			JSON.stringify(await recordExperienceEvidenceFromFile(inputPath)),
		);
		return 0;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

if (import.meta.main) process.exit(await main());
