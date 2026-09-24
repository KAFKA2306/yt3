import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	type ByosanPreflightDependencies,
	type PreflightCheck,
	aggregateStatus,
	runByosanPreflight,
} from "../src/scripts/byosan_preflight.js";

const item = (status: "PASS" | "FAIL" | "UNVERIFIED") => ({
	status,
	component: "test",
	method: "fixture",
	reason: "fixture",
	evidence: [],
});

const pass = (component: string): PreflightCheck => ({
	status: "PASS",
	component,
	method: "fixture",
	reason: "fixture pass",
	evidence: [],
});

const fail = (component: string, reason: string): PreflightCheck => ({
	status: "FAIL",
	component,
	method: "fault injection",
	reason,
	evidence: [],
});

const runDirs: string[] = [];

function passingDependencies(): ByosanPreflightDependencies {
	return {
		commandAvailable: (command) => pass(command),
		pythonRuntime: () => pass("python_runtime"),
		voicevox: async () => pass("voicevox"),
		gemini: async () => pass("gemini"),
		youtube: async () => pass("youtube"),
	};
}

async function temporaryRunDir(): Promise<string> {
	const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "yt3-preflight-"));
	runDirs.push(runDir);
	return runDir;
}

afterEach(async () => {
	await Promise.all(runDirs.splice(0).map((runDir) => fs.remove(runDir)));
});

describe("Byosan preflight aggregation", () => {
	test("fails closed on a known failure and keeps unknown capability separate", () => {
		expect(aggregateStatus({ a: item("PASS"), b: item("FAIL") })).toBe("FAIL");
		expect(aggregateStatus({ a: item("PASS"), b: item("UNVERIFIED") })).toBe(
			"UNVERIFIED",
		);
		expect(aggregateStatus({ a: item("PASS"), b: item("PASS") })).toBe("PASS");
	});

	test("fault-injects every required capability before media can start", async () => {
		const cases: Array<{
			name: string;
			component: string;
			inject: (dependencies: ByosanPreflightDependencies) => void;
		}> = [
			{
				name: "Python dependency missing",
				component: "python_runtime",
				inject: (dependencies) => {
					dependencies.pythonRuntime = () =>
						fail("python_runtime", "missing dependency");
				},
			},
			{
				name: "HF cache read-only",
				component: "python_runtime",
				inject: (dependencies) => {
					dependencies.pythonRuntime = () =>
						fail("python_runtime", "Hugging Face cache is not writable");
				},
			},
			{
				name: "VOICEVOX unavailable",
				component: "voicevox",
				inject: (dependencies) => {
					dependencies.voicevox = async () =>
						fail("voicevox", "VOICEVOX unavailable");
				},
			},
			{
				name: "Gemini invalid or rate-limited key pool",
				component: "gemini",
				inject: (dependencies) => {
					dependencies.gemini = async () =>
						fail("gemini", "structured output returned HTTP 429");
				},
			},
			{
				name: "outbound network unavailable",
				component: "gemini",
				inject: (dependencies) => {
					dependencies.gemini = async () =>
						fail("gemini", "outbound network unavailable");
				},
			},
			{
				name: "YouTube profile mismatch",
				component: "youtube",
				inject: (dependencies) => {
					dependencies.youtube = async () =>
						fail("youtube", "authenticated channel does not match profile");
				},
			},
		];

		for (const testCase of cases) {
			const dependencies = passingDependencies();
			testCase.inject(dependencies);
			const runDir = await temporaryRunDir();
			const report = await runByosanPreflight(runDir, dependencies);
			expect(report.status, testCase.name).toBe("FAIL");
			expect(report.checks[testCase.component]?.status, testCase.name).toBe(
				"FAIL",
			);
			expect(
				await fs.pathExists(path.join(runDir, "audit", "preflight.json")),
				testCase.name,
			).toBe(true);
		}
	});
});
