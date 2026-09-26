import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectBunWorkspaceLicenseInventory } from "../src/scripts/experience_workspace.js";

async function writePackage(
	workspace: string,
	relativePath: string,
	manifest: Record<string, unknown>,
): Promise<void> {
	const directory = path.join(workspace, relativePath);
	await mkdir(directory, { recursive: true });
	await writeFile(
		path.join(directory, "package.json"),
		JSON.stringify(manifest),
		"utf8",
	);
}

describe("Bun workspace dependency license inventory", () => {
	test("records sorted installed package declarations, including nested and Bun-store packages", async () => {
		const workspace = await mkdtemp(
			path.join(tmpdir(), "yt3-experience-license-inventory-"),
		);
		try {
			await writePackage(workspace, "node_modules/zeta", {
				name: "zeta",
				version: "1.0.0",
				license: "MIT",
			});
			await writePackage(workspace, "node_modules/@scope/alpha", {
				name: "@scope/alpha",
				version: "2.0.0",
				license: { type: "Apache-2.0" },
			});
			await writePackage(workspace, "node_modules/zeta/node_modules/beta", {
				name: "beta",
				version: "3.0.0",
			});
			await writePackage(
				workspace,
				"node_modules/.bun/gamma@4.0.0/node_modules/gamma",
				{
					name: "gamma",
					version: "4.0.0",
					license: "BSD-3-Clause",
				},
			);

			const inventory = await collectBunWorkspaceLicenseInventory(workspace);

			expect(inventory).toMatchObject({
				schema_version: "experience_dependency_license_inventory_v1",
				status: "INVENTORIED",
				scope: "installed_node_modules_package_json_declarations_only",
				package_instance_count: 4,
				unique_package_count: 4,
				undeclared_license_count: 1,
			});
			expect(inventory.packages).toEqual([
				{
					name: "@scope/alpha",
					version: "2.0.0",
					declared_license: { type: "Apache-2.0" },
					license_status: "DECLARED",
					package_path: "node_modules/@scope/alpha",
				},
				{
					name: "beta",
					version: "3.0.0",
					declared_license: null,
					license_status: "UNDECLARED",
					package_path: "node_modules/zeta/node_modules/beta",
				},
				{
					name: "gamma",
					version: "4.0.0",
					declared_license: "BSD-3-Clause",
					license_status: "DECLARED",
					package_path: "node_modules/.bun/gamma@4.0.0/node_modules/gamma",
				},
				{
					name: "zeta",
					version: "1.0.0",
					declared_license: "MIT",
					license_status: "DECLARED",
					package_path: "node_modules/zeta",
				},
			]);
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});

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
