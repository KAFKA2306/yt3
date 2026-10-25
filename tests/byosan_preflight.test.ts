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
	runByosanPreflight,
} from "../src/scripts/byosan_preflight.js";

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

describe("Byosan preflight", () => {
	test("passes when every production capability is present", async () => {
		const runDir = await temporaryRunDir();
		const report = await runByosanPreflight(runDir, passingDependencies());
		expect(report.status).toBe("PASS");
	});

	test("fault-injects every production capability before media can start", async () => {
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
				name: "VOICEVOX unavailable",
				failureClass: "INFRA_DEPENDENCY",
				component: "voicevox",
				inject: (dependencies) => {
					dependencies.voicevox = async () =>
						fail("voicevox", "VOICEVOX unavailable");
				},
			},
			{
				name: "ffmpeg unavailable",
				failureClass: "INFRA_DEPENDENCY",
				component: "ffmpeg",
				inject: (dependencies) => {
					dependencies.commandAvailable = (command) =>
						command === "ffmpeg"
							? fail("ffmpeg", "required command is unavailable")
							: pass(command);
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
