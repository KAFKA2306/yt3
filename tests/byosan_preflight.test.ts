import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import fs from "fs-extra";
import {
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
			failureClass: string;
			inject: (dependencies: ByosanPreflightDependencies) => void;
		}> = [
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
				name: "Gemini invalid or rate-limited key pool",
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

describe("Byosan Gemini structured-output probe", () => {
	test("sends a Gemini-compatible schema without const keywords", () => {
		const jsonSchema = JSON.stringify(toJsonSchema(ProbeSchema));
		expect(jsonSchema).not.toContain('"const"');
	});

	test("accepts only the ok=true contract", () => {
		expect(ProbeSchema.safeParse({ ok: true }).success).toBe(true);
		expect(ProbeSchema.safeParse({ ok: false }).success).toBe(false);
		expect(ProbeSchema.safeParse({}).success).toBe(false);
	});
});
