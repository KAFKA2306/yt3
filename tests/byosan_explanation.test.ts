import { describe, expect, test } from "bun:test";
import {
	type Explanation,
	auditVerdicts,
	buildExplanationEvidence,
} from "../src/domain/byosan/explanation.js";

const figures: Explanation["figures"] = [
	{
		metric: "IT分野の指数構成比率",
		population: "MSCI EM Asia Indexの構成企業",
		period: "2026年9月30日時点",
		unit: "%",
		value: "49%",
		quote: "IT was the largest sector in the MSCI EM Asia Index at 49%",
		kind: "actual",
	},
	{
		metric: "IT分野の利益シェア",
		population: "MSCI EM Asia Indexの構成企業",
		period: "2026年9月30日時点",
		unit: "%",
		value: "around 35%",
		quote: "Its share of index earnings is below its weight, at around 35%",
		kind: "actual",
	},
];

describe("byosan figure verdict guard", () => {
	test("accepts verdicts whose reason states the value and the metric or population", () => {
		expect(
			auditVerdicts(figures, [
				{
					index: 0,
					matches: true,
					reason:
						"49%はMSCI EM Asia Indexの構成企業に対するIT分野の指数構成比率。",
				},
				{
					index: 1,
					matches: true,
					reason:
						"around 35%はIT分野の利益シェアで、MSCI EM Asia Indexの構成企業が対象。",
				},
			]),
		).toEqual([]);
	});

	test("rejects a verdict whose reason does not state the figure value", () => {
		expect(
			auditVerdicts(figures, [
				{
					index: 0,
					matches: true,
					reason: "米国の大学関連財団657機関が約9,443億米ドルを運用している。",
				},
				{
					index: 1,
					matches: true,
					reason:
						"around 35%はIT分野の利益シェアで、MSCI EM Asia Indexの構成企業が対象。",
				},
			]),
		).toEqual(["figure_verdict_ungrounded: 0"]);
	});

	test("rejects a verdict whose reason carries the value but neither metric nor population", () => {
		expect(
			auditVerdicts(figures, [
				{ index: 0, matches: true, reason: "原文に49%とある。" },
				{
					index: 1,
					matches: true,
					reason:
						"around 35%はIT分野の利益シェアで、MSCI EM Asia Indexの構成企業が対象。",
				},
			]),
		).toEqual(["figure_verdict_ungrounded: 0"]);
	});

	test("reports a mismatched verdict as figure_meaning_mismatch", () => {
		expect(
			auditVerdicts(figures, [
				{
					index: 0,
					matches: false,
					reason:
						"49%は構成比率ではなく利益シェアとして書かれている。MSCI EM Asia Indexの構成企業が対象。",
				},
				{
					index: 1,
					matches: true,
					reason:
						"around 35%はIT分野の利益シェアで、MSCI EM Asia Indexの構成企業が対象。",
				},
			]),
		).toEqual([
			"figure_meaning_mismatch: 0 49%は構成比率ではなく利益シェアとして書かれている。MSCI EM Asia Indexの構成企業が対象。",
		]);
	});

	test("rejects verdicts that do not cover every figure index exactly once", () => {
		const reason =
			"49%はMSCI EM Asia Indexの構成企業に対するIT分野の指数構成比率。";
		expect(
			auditVerdicts(figures, [{ index: 0, matches: true, reason }]),
		).toEqual(["verdict_index_mismatch: expected 0,1 got 0"]);
		expect(
			auditVerdicts(figures, [
				{ index: 0, matches: true, reason },
				{ index: 0, matches: true, reason },
			]),
		).toEqual(["verdict_index_mismatch: expected 0,1 got 0,0"]);
	});
});

describe("byosan explanation evidence", () => {
	const articles = [
		{
			title: "候補の記事",
			url: "https://example.com/candidate",
			issuer: "媒体A",
			published: "2026-10-23T00:00:00.000Z",
			body: "IT was the largest sector in the MSCI EM Asia Index at 49%",
		},
		{
			title: "無関係な記事",
			url: "https://example.com/unrelated",
			issuer: "媒体B",
			published: "2026-10-23T00:00:00.000Z",
			body: "米国の大学関連財団657機関",
		},
	];
	const candidate = {
		topic: "題材A",
		angle: "角度A",
		hiddenMechanism: "仕組みA",
		numbers: ["49%の数字", "35%の数字"],
		sources: [{ url: "https://example.com/candidate" }],
	};

	test("keeps only the articles that are candidate sources and fixes the candidate brief", () => {
		const evidence = buildExplanationEvidence(candidate, articles);
		expect(evidence.articles).toContain("IT was the largest sector");
		expect(evidence.articles).not.toContain("657機関");
		expect(evidence.candidate).toContain("題材: 題材A");
		expect(evidence.candidate).toContain("数字: 49%の数字");
	});

	test("throws when no registered article matches the candidate sources", () => {
		expect(() =>
			buildExplanationEvidence(
				{ ...candidate, sources: [{ url: "https://example.com/none" }] },
				articles,
			),
		).toThrow("BYOSAN_EXPLAIN_EVIDENCE_MISSING");
	});
});
