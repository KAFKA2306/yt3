import { z } from "zod";

export const ComedyRoleSchema = z.enum(["春日部つむぎ", "ずんだもん"]);
export const ComedyBeatRoleSchema = z.enum([
	"normal",
	"anomaly",
	"escalation",
	"tsukkomi",
	"pivot",
]);

export const ComedyBeatSchema = z.discriminatedUnion("enabled", [
	z.object({ enabled: z.literal(false) }),
	z.object({
		enabled: z.literal(true),
		normal: z.string().min(1).max(120),
		anomaly: z.string().min(1).max(120),
		escalation: z.array(z.string().min(1).max(100)).min(2).max(4),
		tsukkomi: z.string().min(1).max(60),
		pivot: z.string().min(1).max(160),
		roles: z.object({
			setup: ComedyRoleSchema,
			escalator: ComedyRoleSchema,
			tsukkomi: ComedyRoleSchema,
			pivot: ComedyRoleSchema,
		}),
		evidence_refs: z.array(z.string().min(1)).min(1),
		confidence: z.enum(["high", "medium"]),
	}),
]);

export type ComedyBeat = z.infer<typeof ComedyBeatSchema>;
export type ComedyBeatRole = z.infer<typeof ComedyBeatRoleSchema>;
type EnabledComedyBeat = Extract<ComedyBeat, { enabled: true }>;

export type ComedyDialogueLine = {
	speaker: string;
	text: string;
	beat_role?: ComedyBeatRole;
};

export type ComedyBeatReport = {
	schema_version: "comedy_beat_report_v1";
	enabled_beats: number;
	sections: Array<{
		section_id: number;
		escalation_count: number;
		tsukkomi_chars: number;
		pivot_distance_lines: number;
		roles: EnabledComedyBeat["roles"];
	}>;
};

export function validateComedyBeat(beatInput: unknown): ComedyBeat {
	const beat = ComedyBeatSchema.parse(beatInput);
	if (beat.enabled) {
		const sourceText = [
			beat.normal,
			beat.anomaly,
			...beat.escalation,
			beat.tsukkomi,
			beat.pivot,
		].join(" ");
		if (
			/(?:victim|tragedy|death|casualt|死亡|犠牲|被害者|災害|事故死)/iu.test(
				sourceText,
			)
		) {
			throw new Error("COMEDY_BEAT_TRAGIC_CONTEXT");
		}
	}
	return beat;
}

export function validateComedyBeatRealization(
	beatInput: unknown,
	lines: readonly ComedyDialogueLine[],
): void {
	const beat = validateComedyBeat(beatInput);
	if (!beat.enabled) return;

	const roles = lines.map((line) => line.beat_role);
	const roleIndexes = lines
		.map((line, index) => ({ index, role: line.beat_role }))
		.filter((item) => item.role !== undefined);
	const normal = roles.indexOf("normal");
	const anomaly = roles.indexOf("anomaly");
	const tsukkomi = roles.indexOf("tsukkomi");
	const pivot = roles.indexOf("pivot");
	const tsukkomiLineIndex = roleIndexes.find(
		(item) => item.role === "tsukkomi",
	)?.index;
	const pivotLineIndex = roleIndexes.find(
		(item) => item.role === "pivot",
	)?.index;
	const escalationIndexes = roles
		.map((role, index) => (role === "escalation" ? index : -1))
		.filter((index) => index >= 0);
	if (normal < 0 || anomaly < 0 || tsukkomi < 0 || pivot < 0) {
		throw new Error("COMEDY_BEAT_REALIZATION_MISSING_ROLE");
	}
	if (escalationIndexes.length < 2 || escalationIndexes.length > 4) {
		throw new Error("COMEDY_BEAT_REALIZATION_ESCALATION_COUNT");
	}
	const firstEscalation = escalationIndexes[0];
	const lastEscalation = escalationIndexes[escalationIndexes.length - 1];
	if (
		firstEscalation === undefined ||
		lastEscalation === undefined ||
		!(
			normal < anomaly &&
			anomaly < firstEscalation &&
			lastEscalation < tsukkomi
		)
	) {
		throw new Error("COMEDY_BEAT_REALIZATION_ORDER");
	}
	if (roles.filter((role) => role === "tsukkomi").length !== 1) {
		throw new Error("COMEDY_BEAT_REALIZATION_MULTIPLE_TSUKKOMI");
	}
	if (
		pivot <= tsukkomi ||
		tsukkomiLineIndex === undefined ||
		pivotLineIndex === undefined ||
		pivotLineIndex <= tsukkomiLineIndex ||
		pivotLineIndex - tsukkomiLineIndex > 2
	) {
		throw new Error("COMEDY_BEAT_REALIZATION_PIVOT_DISTANCE");
	}
	const expectedSpeakers: Record<ComedyBeatRole, string> = {
		normal: beat.roles.setup,
		anomaly: beat.roles.setup,
		escalation: beat.roles.escalator,
		tsukkomi: beat.roles.tsukkomi,
		pivot: beat.roles.pivot,
	};
	for (const line of lines) {
		if (line.beat_role && line.speaker !== expectedSpeakers[line.beat_role]) {
			throw new Error(`COMEDY_BEAT_ROLE_SPEAKER_MISMATCH:${line.beat_role}`);
		}
	}
}

export function countComedyBeats(
	sections: readonly { comedy_beat?: ComedyBeat }[],
): number {
	return sections.filter((section) => section.comedy_beat?.enabled).length;
}

export function assertComedyBeatCount(
	sections: readonly { comedy_beat?: ComedyBeat }[],
): void {
	const count = countComedyBeats(sections);
	if (count > 2) throw new Error("COMEDY_BEAT_LIMIT_EXCEEDED");
}

export function buildComedyBeatReport(
	entries: readonly {
		section_id: number;
		beat: ComedyBeat;
		lines: readonly ComedyDialogueLine[];
	}[],
): ComedyBeatReport {
	const enabled = entries.filter((entry) => entry.beat.enabled);
	return {
		schema_version: "comedy_beat_report_v1",
		enabled_beats: enabled.length,
		sections: enabled.map((entry) => {
			if (!entry.beat.enabled)
				throw new Error("COMEDY_BEAT_REPORT_DISABLED_ENTRY");
			const tsukkomiIndex = entry.lines.findIndex(
				(line) => line.beat_role === "tsukkomi",
			);
			const pivotIndex = entry.lines.findIndex(
				(line) => line.beat_role === "pivot",
			);
			return {
				section_id: entry.section_id,
				escalation_count: entry.beat.escalation.length,
				tsukkomi_chars: Array.from(entry.beat.tsukkomi).length,
				pivot_distance_lines:
					tsukkomiIndex >= 0 && pivotIndex >= 0
						? pivotIndex - tsukkomiIndex
						: -1,
				roles: entry.beat.roles,
			};
		}),
	};
}
