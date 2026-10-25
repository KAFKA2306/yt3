import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { loadPublishedByosanSourceUrls } from "../src/domain/byosan/published_sources.js";

describe("published source history", () => {
	const roots: string[] = [];

	afterEach(async () => {
		await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
	});

	test("collects document URLs of published runs inside the window only", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "byosan-history-"));
		roots.push(root);
		const writeRun = async (
			runId: string,
			published: boolean,
			urls: string[],
		) => {
			const runDir = path.join(root, "runs", "byosan_money", runId);
			await fs.outputJson(path.join(runDir, "source", "feature_spec.json"), {
				sources: urls.map((url) => ({ url })),
			});
			if (published) {
				await fs.outputJson(path.join(runDir, "publish", "receipt.json"), {});
			}
		};
		await writeRun("2026-10-24-daily", true, [
			"https://www.msci.com/a?utm=1",
			"https://fred.stlouisfed.org/",
		]);
		await writeRun("2026-10-22-daily", false, ["https://www.msci.com/b"]);
		await writeRun("2026-07-01-daily", true, ["https://www.msci.com/c"]);
		expect([
			...loadPublishedByosanSourceUrls(
				root,
				new Date("2026-10-25T23:59:59Z"),
				60,
			),
		]).toEqual(["https://www.msci.com/a"]);
	});
});
