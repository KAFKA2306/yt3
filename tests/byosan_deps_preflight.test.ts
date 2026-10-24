import { describe, expect, test } from "bun:test";
import {
	importedPackageNames,
	missingPackages,
	packageNameOf,
} from "../src/scripts/byosan_preflight.js";

const declared = ["echarts", "zod", "fs-extra", "@langchain/core"];

describe("Byosan dependency preflight names", () => {
	test("maps import specifiers to package names including scoped packages", () => {
		expect(packageNameOf("echarts")).toBe("echarts");
		expect(packageNameOf("fs-extra/esm")).toBe("fs-extra");
		expect(packageNameOf("@langchain/core/messages")).toBe("@langchain/core");
	});

	test("lists declared packages imported by type, value, and dynamic imports", () => {
		const sources = [
			'import type { EChartsOption } from "echarts";\nimport { z } from "zod";',
			'import fs from "fs-extra";\nconst m = await import("@langchain/core/messages");',
		];
		expect(importedPackageNames(sources, declared)).toEqual([
			"@langchain/core",
			"echarts",
			"fs-extra",
			"zod",
		]);
	});

	test("ignores relative paths, node builtins, and undeclared packages", () => {
		const sources = [
			'import path from "node:path";\nimport { ROOT } from "../io/core.js";\nimport { Database } from "bun:sqlite";\nimport x from "left-pad";',
		];
		expect(importedPackageNames(sources, declared)).toEqual([]);
	});
});

describe("Byosan dependency preflight presence", () => {
	test("reports only the imported packages that are not installed", () => {
		const installed = new Set(["zod"]);
		expect(
			missingPackages(["echarts", "zod"], (name) => installed.has(name)),
		).toEqual(["echarts"]);
	});

	test("reports nothing when every imported package is installed", () => {
		expect(missingPackages(["echarts"], () => true)).toEqual([]);
	});
});
