import path from "node:path";
import fs from "fs-extra";
import { ROOT } from "../../io/core.js";

/**
 * Behavioral Characteristics (BC) for the Humanity Archive
 */
export interface HumanityBC {
	time: string[];
	season: string[];
	space: string[];
	object: string[];
	emotion: string[];
}

export interface ArchiveEntry {
	episodeId: string;
	timestamp: string;
	bc: HumanityBC;
	auditScore: number; // For now, totalEntropy or some quality metric
}

export interface HumanityArchive {
	entries: ArchiveEntry[];
	coverage: number;
	qdScore: number;
}

const ARCHIVE_PATH = path.join(ROOT, "data/humanity_audit/archive.json");

/**
 * Cognitive Repertoire Archive Manager
 * Implements QD-based diversity tracking.
 */
export class ArchiveManager {
	private archive: HumanityArchive = { entries: [], coverage: 0, qdScore: 0 };

	constructor() {
		this.load();
	}

	private load() {
		if (fs.existsSync(ARCHIVE_PATH)) {
			this.archive = fs.readJsonSync(ARCHIVE_PATH);
		}
	}

	public save() {
		fs.ensureDirSync(path.dirname(ARCHIVE_PATH));
		fs.writeJsonSync(ARCHIVE_PATH, this.archive, { spaces: 2 });
	}

	/**
	 * Adds a new elite entry to the archive.
	 */
	public addEntry(entry: ArchiveEntry) {
		this.archive.entries.push(entry);
		// Maintain max size or prune if needed, but for now just keep growing
		this.updateMetrics();
		this.save();
	}

	/**
	 * Calculate Coverage and QD-score across the archive.
	 */
	private updateMetrics() {
		// Simplified Coverage: Unique terms found across all entries / Total possible terms
		// In a real MAP-Elites, this would be Grid Cell occupancy.
		this.archive.coverage = this.calculateCoverage();
		this.archive.qdScore = this.archive.entries.reduce(
			(acc, curr) => acc + curr.auditScore,
			0,
		);
	}

	private calculateCoverage(): number {
		// Mock calculation for now
		return this.archive.entries.length > 0 ? 1.0 : 0.0;
	}

	/**
	 * Identifies "Gaps" in the behavioral space to guide the next generation.
	 */
	public identifyGaps() {
		// TODO: Implement grid-based gap detection
		// For now, return a placeholder
		return {
			suggestedTime: "朝",
			suggestedSpace: "洗面所",
			suggestedEmotion: "ささやかな祝祭",
		};
	}

	public getArchive() {
		return this.archive;
	}
}
