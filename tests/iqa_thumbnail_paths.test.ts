import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findThumbnailPaths } from "../src/io/utils/qa/iqa_check.js";

const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "iqa-thumbnails-"));
const fixtureFiles = [
	"runs/run_a/thumbnail.png",
	"runs/run_a/nested/thumbnail.png",
	"runs/run_b/thumbnail.png",
	"runs/run_b/cover.png",
];

for (const file of fixtureFiles) {
	const target = path.join(fixtureRoot, file);
	mkdirSync(path.dirname(target), { recursive: true });
	writeFileSync(target, "");
}

afterAll(() => {
	rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("IQA thumbnail discovery", () => {
	test("finds every run thumbnail as an absolute path under the working directory", async () => {
		const paths = await findThumbnailPaths(undefined, fixtureRoot);

		expect(paths.sort()).toEqual([
			path.join(fixtureRoot, "runs/run_a/nested/thumbnail.png"),
			path.join(fixtureRoot, "runs/run_a/thumbnail.png"),
			path.join(fixtureRoot, "runs/run_b/thumbnail.png"),
		]);
	});

	test("limits discovery to the requested run id and ignores other images", async () => {
		const paths = await findThumbnailPaths("run_b", fixtureRoot);

		expect(paths).toEqual([path.join(fixtureRoot, "runs/run_b/thumbnail.png")]);
	});

	test("returns no paths when the run id has no thumbnail", async () => {
		expect(await findThumbnailPaths("missing_run", fixtureRoot)).toEqual([]);
	});
});
