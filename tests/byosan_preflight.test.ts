import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	type ByosanFailureClass,
	classifyByosanFailure,
	preflightBlockedMessage,
} from "../src/scripts/byosan_daily.js";
import {
	type ByosanPreflightDependencies,
	type PreflightCheck,
	ProbeSchema,
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
		nodeDependencies: () => pass("node_dependencies"),
		pythonRuntime: () => pass("python_runtime"),
		voicevox: async () => pass("voicevox"),
		llmBackends: ["gemini"],
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
			failureClass: ByosanFailureClass;
			inject: (dependencies: ByosanPreflightDependencies) => void;
		}> = [
			{
				name: "Bun package missing from node_modules",
				failureClass: "INFRA_DEPENDENCY",
				component: "node_dependencies",
				inject: (dependencies) => {
					dependencies.nodeDependencies = () =>
						fail("node_dependencies", "missing packages: echarts");
				},
			},
			{
				name: "Python dependency missing",
				failureClass: "INFRA_DEPENDENCY",
				component: "python_runtime",
				inject: (dependencies) => {
					dependencies.pythonRuntime = () =>
						fail("python_runtime", "missing dependency");
				},
			},
			{
				name: "HF cache read-only",
				failureClass: "INFRA_DEPENDENCY",
				component: "python_runtime",
				inject: (dependencies) => {
					dependencies.pythonRuntime = () =>
						fail("python_runtime", "Hugging Face cache is not writable");
				},
			},
			{
				name: "VOICEVOX unavailable",
				failureClass: "INFRA_DEPENDENCY",
				component: "voicevox",
				inject: (dependencies) => {
					dependencies.voicevox = async () =>
						fail("voicevox", "VOICEVOX unavailable");
				},
			},
			{
				name: "Gemini structured-output rate-limited",
				failureClass: "PROVIDER_RATE_LIMIT",
				component: "gemini",
				inject: (dependencies) => {
					dependencies.gemini = async () =>
						fail("gemini", "structured output returned HTTP 429");
				},
			},
			{
				name: "outbound network unavailable",
				failureClass: "NETWORK_AUTH",
				component: "gemini",
				inject: (dependencies) => {
					dependencies.gemini = async () =>
						fail("gemini", "outbound network unavailable");
				},
			},
			{
				name: "YouTube profile mismatch",
				failureClass: "NETWORK_AUTH",
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
			const message = preflightBlockedMessage(
				report,
				path.join(runDir, "audit", "preflight.json"),
			);
			expect(classifyByosanFailure(message).failureClass, testCase.name).toBe(
				testCase.failureClass,
			);
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

describe("Byosan preflight probes the configured LLM backends", () => {});

describe("Byosan preflight skips probes for stages served from checkpoint", () => {});

describe("Byosan codex structured-output probe", () => {});
