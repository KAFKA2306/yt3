import { describe, expect, test } from "bun:test";
import {
	assertComedyBeatCount,
	buildComedyBeatReport,
	countComedyBeats,
	validateComedyBeat,
	validateComedyBeatRealization,
} from "../src/domain/content/comedy_beat.js";
import { ScriptIntegrityLinter } from "../src/io/utils/qa/script_linter.js";

const beat = {
	enabled: true as const,
	normal: "HBMの設備投資が増えている",
	anomaly: "主要3社が同時に増産している",
	escalation: ["Samsungも増産", "SK hynixも増産", "Micronも増産"],
	tsukkomi: "全員工場建て始めたやないかい",
	pivot: "ただし供給制約は先端パッケージにもある",
	roles: {
		setup: "春日部つむぎ" as const,
		escalator: "ずんだもん" as const,
		tsukkomi: "春日部つむぎ" as const,
		pivot: "ずんだもん" as const,
	},
	evidence_refs: ["source-1"],
	confidence: "high" as const,
};

describe("Comedy Beat contract", () => {
	test("accepts disabled beats and a valid realized beat", () => {
		expect(validateComedyBeat({ enabled: false })).toEqual({ enabled: false });
		validateComedyBeat(beat);
		validateComedyBeatRealization(beat, [
			{ speaker: "春日部つむぎ", text: beat.normal, beat_role: "normal" },
			{ speaker: "春日部つむぎ", text: beat.anomaly, beat_role: "anomaly" },
			{
				speaker: "ずんだもん",
				text: beat.escalation[0],
				beat_role: "escalation",
			},
			{
				speaker: "ずんだもん",
				text: beat.escalation[1],
				beat_role: "escalation",
			},
			{
				speaker: "ずんだもん",
				text: beat.escalation[2],
				beat_role: "escalation",
			},
			{ speaker: "春日部つむぎ", text: beat.tsukkomi, beat_role: "tsukkomi" },
			{ speaker: "ずんだもん", text: beat.pivot, beat_role: "pivot" },
		]);
	});

	test("bounds beat count and rejects a late pivot", () => {
		expect(
			countComedyBeats([{ comedy_beat: beat }, { comedy_beat: beat }]),
		).toBe(2);
		expect(() =>
			assertComedyBeatCount([
				{ comedy_beat: beat },
				{ comedy_beat: beat },
				{ comedy_beat: beat },
			]),
		).toThrow("COMEDY_BEAT_LIMIT_EXCEEDED");
		expect(() =>
			validateComedyBeatRealization(beat, [
				{ speaker: "春日部つむぎ", text: beat.normal, beat_role: "normal" },
				{ speaker: "春日部つむぎ", text: beat.anomaly, beat_role: "anomaly" },
				{
					speaker: "ずんだもん",
					text: beat.escalation[0],
					beat_role: "escalation",
				},
				{
					speaker: "ずんだもん",
					text: beat.escalation[1],
					beat_role: "escalation",
				},
				{ speaker: "春日部つむぎ", text: beat.tsukkomi, beat_role: "tsukkomi" },
				{
					speaker: "春日部つむぎ",
					text: "分析に戻らない",
					beat_role: "normal",
				},
				{
					speaker: "春日部つむぎ",
					text: "まだ戻らない",
					beat_role: "normal",
				},
				{ speaker: "ずんだもん", text: beat.pivot, beat_role: "pivot" },
			]),
		).toThrow("COMEDY_BEAT_REALIZATION_PIVOT_DISTANCE");
	});

	test("rejects tragic context and emits a machine-readable report", () => {
		expect(() =>
			validateComedyBeat({ ...beat, normal: "被害者の死亡数が増えた" }),
		).toThrow("COMEDY_BEAT_TRAGIC_CONTEXT");
		const report = buildComedyBeatReport([
			{
				section_id: 2,
				beat,
				lines: [
					{ speaker: beat.roles.setup, text: beat.normal, beat_role: "normal" },
					{
						speaker: beat.roles.setup,
						text: beat.anomaly,
						beat_role: "anomaly",
					},
					...beat.escalation.map((text) => ({
						speaker: beat.roles.escalator,
						text,
						beat_role: "escalation" as const,
					})),
					{
						speaker: beat.roles.tsukkomi,
						text: beat.tsukkomi,
						beat_role: "tsukkomi",
					},
					{ speaker: beat.roles.pivot, text: beat.pivot, beat_role: "pivot" },
				],
			},
		]);
		expect(report.schema_version).toBe("comedy_beat_report_v1");
		expect(report.enabled_beats).toBe(1);
		expect(report.sections[0]?.pivot_distance_lines).toBe(1);
	});

	test("keeps intentional escalation repetition out of generic repetition failures", async () => {
		const result = await new ScriptIntegrityLinter().audit({
			run_id: "comedy-beat-test",
			bucket: "byosan_money",
			metadata: {
				title: "HBM設備投資の検証",
				thumbnail_title: "HBM設備投資",
				description: "検証",
				tags: ["HBM"],
			},
			script: {
				title: "HBM設備投資の検証",
				description: "検証",
				lines: [
					{
						speaker: "ずんだもん",
						text: "主要3社が同時に増産を発表した",
						duration: 1,
						beat_role: "escalation",
					},
					{
						speaker: "ずんだもん",
						text: "主要3社が同時に増産を発表した",
						duration: 1,
						beat_role: "escalation",
					},
					{
						speaker: "春日部つむぎ",
						text: "ここで供給制約の条件を確認する",
						duration: 1,
					},
				],
			},
		});
		const repetition = result.checks.find(
			(check) => check.layer === "Repetition",
		);
		expect(repetition?.status).toBe("OK");
	});
});
