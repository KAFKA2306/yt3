import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectBunWorkspaceLicenseInventory } from "../src/scripts/experience_workspace.js";

describe("Bun workspace dependency license inventory", () => {
	test("fails closed when the installed dependency tree is unavailable", async () => {
		const workspace = await mkdtemp(
			path.join(tmpdir(), "yt3-experience-license-missing-"),
		);
		try {
			await expect(
				collectBunWorkspaceLicenseInventory(workspace),
			).rejects.toThrow(/node_modules/);
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});

	test("rejects malformed installed package manifests instead of reporting an incomplete inventory as complete", async () => {
		const workspace = await mkdtemp(
			path.join(tmpdir(), "yt3-experience-license-invalid-"),
		);
		try {
			const packageDirectory = path.join(workspace, "node_modules/broken");
			await mkdir(packageDirectory, { recursive: true });
			await writeFile(path.join(packageDirectory, "package.json"), "{", "utf8");
			await expect(
				collectBunWorkspaceLicenseInventory(workspace),
			).rejects.toThrow(/package\.json/);
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});
});
