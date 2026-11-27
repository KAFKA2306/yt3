import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	assertByosanRetryAllowed,
	byosanCandidateSlugKey,
	findPublishedByosanRunForDate,
	hasConflictingCurrentGrowthRates,
	recordByosanFailure,
	selectionContainsSourceMismatch,
} from "../src/scripts/byosan_daily.js";

const tempRoots: string[] = [];

describe("Byosan story selection", () => {
	test("matches article URL punctuation variants without changing the source", () => {
		expect(
			byosanCandidateSlugKey(
				"https://insight.factset.com/market-is-punishing-negative-eps-surprises-less-than-average-for-s-p-500-companies-for-q3",
			),
		).toBe(
			byosanCandidateSlugKey(
				"https://insight.factset.com/market-is-punishing-negative-eps-surprises-less-than-average-for-sp-500-companies-for-q3",
			),
		);
	});

	test("filters a source whose current and comparative growth rates conflict", () => {
		expect(
			hasConflictingCurrentGrowthRates({
				body: "The blended earnings growth rate for the other 493 S&P 500 companies has increased to 34.7% today from 27.7% on September 30. Thus, the actual earnings growth rate for the Magnificent 7 is lower than the blended earnings growth rate for the other 493 S&P 500 companies for Q3 2026 (32.6%).",
			}),
		).toBe(true);
		expect(
			hasConflictingCurrentGrowthRates({
				body: "The blended earnings growth rate for the other 493 S&P 500 companies has increased to 34.7% today from 27.7% on September 30. Thus, the actual earnings growth rate for the Magnificent 7 is lower than the blended earnings growth rate for the other 493 S&P 500 companies for Q3 2026 (34.7%).",
			}),
		).toBe(false);
	});

	test("rejects stories built around source number mismatches", () => {
		expect(
			selectionContainsSourceMismatch({
				angle: "利益成長の逆転",
				article_urls: ["https://example.com/article"],
				hook: "見出しと比較文で数字が違う。",
				answer: "記事の数値を照合する。",
				early_clue: "記事には34.7%と32.6%の二通りで記載。",
				payoff: "同じ指標に矛盾がある。",
				beats: ["二つの値を並べる", "なぜ数字が食い違うかを見る"],
			}),
		).toBe(true);
	});

	test("keeps market structure paradoxes eligible", () => {
		expect(
			selectionContainsSourceMismatch({
				angle: "EPSを上回った株の上昇が、小幅なミスより弱い。",
				article_urls: ["https://example.com/article"],
				hook: "好材料の日に株価が下がる。",
				answer: "利益予想が上がっても評価倍率が下がる。",
				early_clue: "上昇幅の中央値は0.4%。",
				payoff: "投資家は利益ではなく評価を動かしている。",
				beats: ["予想超えと株価反応を並べる", "評価倍率の動きを示す"],
			}),
		).toBe(false);
	});
});

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
});

async function makeRoot(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "byosan-daily-test-"));
	tempRoots.push(root);
	return root;
}

async function makeRunDir(): Promise<string> {
	const root = await makeRoot();
	const runDir = path.join(root, "runs/byosan_money/2026-08-02-daily");
	await fs.ensureDir(path.join(runDir, "audit"));
	return runDir;
}

describe("byosan daily duplicate-publication gate", () => {
	test("returns null when the date has no upload receipt", async () => {
		const root = await makeRoot();
		expect(findPublishedByosanRunForDate(root, "2026-08-02-daily")).toBeNull();
	});

	test("blocks duplicate upload when receipt exists but attestations are incomplete", async () => {
		const root = await makeRoot();
		const publishDir = path.join(
			root,
			"runs/byosan_money/2026-08-02-daily/publish",
		);
		await fs.outputJson(path.join(publishDir, "receipt.json"), {
			youtube: {
				status: "uploaded",
				video_id: "video123",
				channel_id: "UCYtjO-PYBfdG3MuPLXfhA-Q",
				privacy_status: "public",
			},
		});
		const result = findPublishedByosanRunForDate(root, "2026-08-02-daily");
		expect(result?.verified).toBe(false);
		expect(result?.reason).toContain("attestation_is_incomplete");
	});

	test("accepts one verified public upload and suppresses another", async () => {
		const root = await makeRoot();
		const publishDir = path.join(
			root,
			"runs/byosan_money/2026-08-02-daily/publish",
		);
		await Promise.all([
			fs.outputJson(path.join(publishDir, "receipt.json"), {
				youtube: {
					status: "uploaded",
					video_id: "video123",
					channel_id: "UCYtjO-PYBfdG3MuPLXfhA-Q",
					privacy_status: "public",
				},
			}),
			fs.outputJson(path.join(publishDir, "visibility_attestation.json"), {
				current_privacy_status: "public",
				channel_id: "UCYtjO-PYBfdG3MuPLXfhA-Q",
			}),
			fs.outputJson(path.join(publishDir, "thumbnail_attestation.json"), {
				api_update_status: "succeeded",
			}),
		]);
		const result = findPublishedByosanRunForDate(root, "2026-08-02-daily");
		expect(result).toMatchObject({
			runId: "byosan_money/2026-08-02-daily",
			verified: true,
			videoId: "video123",
		});
	});
});

describe("byosan failure retry limits", () => {
	test("classifies a Zod invalid_type issue from provider output as PIPELINE_FAILURE", async () => {
		const runDir = await makeRunDir();
		const trace = recordByosanFailure(
			runDir,
			new Error("BYOSAN_FEATURE_DRAFT_INVALID: malformed generated JSON"),
			"head-a",
		);
		expect(trace.failure_class).toBe("PIPELINE_FAILURE");
	});

	test("does not classify a path containing 'youtuber' as a YouTube publish failure", async () => {
		const runDir = await makeRunDir();
		const trace = recordByosanFailure(
			runDir,
			new Error(
				"BYOSAN_FEATURE_DRAFT_INVALID: /home/kafka/2511youtuber/v3/yt3/runs/byosan_money/2026-10-10-daily/audit/feature.json",
			),
			"head-a",
		);
		expect(trace.failure_class).not.toBe("PUBLISH_REMOTE");
	});

	test("still classifies a real YouTube publish error as PUBLISH_REMOTE", async () => {
		const runDir = await makeRunDir();
		const trace = recordByosanFailure(
			runDir,
			new Error("YouTube upload rejected by channel quota"),
			"head-a",
		);
		expect(trace.failure_class).toBe("PUBLISH_REMOTE");
	});

	test("does not block a rerun after a pipeline failure", async () => {
		const runDir = await makeRunDir();
		const trace = recordByosanFailure(
			runDir,
			new Error(
				"BYOSAN_FEATURE_GENERATION_FAILED: domain audit rejected draft",
			),
			"failed-head",
		);
		expect(trace).toMatchObject({
			status: "OPEN",
			failure_class: "PIPELINE_FAILURE",
			stage: "SPEC",
		});
		expect(() => assertByosanRetryAllowed(runDir)).not.toThrow();
	});

	test("does not cap rate-limit retries; the same-day attempt cap bounds them", async () => {
		const runDir = await makeRunDir();
		for (let attempt = 0; attempt < 5; attempt++) {
			recordByosanFailure(
				runDir,
				new Error("429 rate limit quota exhausted"),
				"head-a",
			);
			expect(() => assertByosanRetryAllowed(runDir)).not.toThrow();
		}
	});

	test("never retries an uncertain publish command without remote read-back", async () => {
		const runDir = await makeRunDir();
		const trace = recordByosanFailure(
			runDir,
			new Error(
				"COMMAND_FAILED: bun src/scripts/publish_youtube.ts byosan_money/2026-08-02-daily status=1",
			),
			"head-a",
		);
		expect(trace.failure_class).toBe("UNCERTAIN_REMOTE_COMMIT");
		expect(() => assertByosanRetryAllowed(runDir)).toThrow(
			"RETRY_BLOCKED_REMOTE_READBACK_REQUIRED",
		);
	});

	test("classifies BYOSAN_ANGLE_STOP as RESEARCH_ANGLE_STOP at the research stage", async () => {
		const runDir = await makeRunDir();
		const trace = recordByosanFailure(
			runDir,
			new Error("BYOSAN_ANGLE_STOP: no passing angle decision"),
			"head-a",
		);
		expect(trace).toMatchObject({
			failure_class: "RESEARCH_ANGLE_STOP",
			stage: "RESEARCH",
		});
	});
});
