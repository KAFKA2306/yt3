import path from "node:path";
import fs from "fs-extra";

export interface BunWorkspaceLicensePackage {
	name: string | null;
	version: string | null;
	declared_license: unknown;
	license_status: "DECLARED" | "UNDECLARED";
	package_path: string;
}

export interface BunWorkspaceLicenseInventory {
	schema_version: "experience_dependency_license_inventory_v1";
	status: "INVENTORIED";
	scope: "installed_node_modules_package_json_declarations_only";
	package_instance_count: number;
	unique_package_count: number;
	undeclared_license_count: number;
	packages: BunWorkspaceLicensePackage[];
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function hasLicenseDeclaration(value: unknown): boolean {
	if (typeof value === "string") return value.trim().length > 0;
	if (Array.isArray(value)) return value.length > 0;
	return typeof value === "object" && value !== null;
}

function relativePackagePath(
	workspace: string,
	packageDirectory: string,
): string {
	return path.relative(workspace, packageDirectory).split(path.sep).join("/");
}

export async function collectBunWorkspaceLicenseInventory(
	workspace: string,
): Promise<BunWorkspaceLicenseInventory> {
	const workspaceRoot = path.resolve(workspace);
	const nodeModulesRoot = path.join(workspaceRoot, "node_modules");
	if (!(await fs.pathExists(nodeModulesRoot)))
		throw new Error(`installed dependency tree is missing: ${nodeModulesRoot}`);
	if (!(await fs.stat(nodeModulesRoot)).isDirectory())
		throw new Error(
			`installed dependency tree is not a directory: ${nodeModulesRoot}`,
		);

	const visitedModuleDirectories = new Set<string>();
	const visitedPackageDirectories = new Set<string>();
	const packages: BunWorkspaceLicensePackage[] = [];

	const isDirectory = async (directory: string): Promise<boolean> => {
		if (!(await fs.pathExists(directory))) return false;
		return (await fs.stat(directory)).isDirectory();
	};

	async function visitPackageDirectory(
		packageDirectory: string,
	): Promise<void> {
		if (!(await isDirectory(packageDirectory))) return;
		const packageJsonPath = path.join(packageDirectory, "package.json");
		if (!(await fs.pathExists(packageJsonPath)))
			throw new Error(
				`installed package is missing package.json: ${packageDirectory}`,
			);

		const realPackageDirectory = await fs.realpath(packageDirectory);
		if (!visitedPackageDirectories.has(realPackageDirectory)) {
			visitedPackageDirectories.add(realPackageDirectory);
			let manifest: unknown;
			try {
				manifest = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
			} catch {
				throw new Error(
					`invalid package.json in installed dependency: ${packageJsonPath}`,
				);
			}
			if (
				typeof manifest !== "object" ||
				manifest === null ||
				Array.isArray(manifest)
			)
				throw new Error(
					`invalid package.json in installed dependency: ${packageJsonPath}`,
				);

			const packageManifest = manifest as Record<string, unknown>;
			const declaration = Object.hasOwn(packageManifest, "license")
				? packageManifest.license
				: packageManifest.licenses;
			const declared = hasLicenseDeclaration(declaration);
			packages.push({
				name:
					typeof packageManifest.name === "string"
						? packageManifest.name
						: null,
				version:
					typeof packageManifest.version === "string"
						? packageManifest.version
						: null,
				declared_license: declared ? declaration : null,
				license_status: declared ? "DECLARED" : "UNDECLARED",
				package_path: relativePackagePath(workspaceRoot, packageDirectory),
			});
		}

		const nestedNodeModules = path.join(packageDirectory, "node_modules");
		if (await isDirectory(nestedNodeModules))
			await visitNodeModulesDirectory(nestedNodeModules);
	}

	async function visitNodeModulesDirectory(
		moduleDirectory: string,
	): Promise<void> {
		if (!(await isDirectory(moduleDirectory))) return;
		const realModuleDirectory = await fs.realpath(moduleDirectory);
		if (visitedModuleDirectories.has(realModuleDirectory)) return;
		visitedModuleDirectories.add(realModuleDirectory);

		const entries = (
			await fs.readdir(moduleDirectory, {
				withFileTypes: true,
			})
		).sort((left, right) => compareStrings(left.name, right.name));
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const entryPath = path.join(moduleDirectory, entry.name);
			if (entry.name.startsWith("@")) {
				if (!(await isDirectory(entryPath))) continue;
				const scopedEntries = (
					await fs.readdir(entryPath, {
						withFileTypes: true,
					})
				).sort((left, right) => compareStrings(left.name, right.name));
				for (const scopedEntry of scopedEntries)
					await visitPackageDirectory(path.join(entryPath, scopedEntry.name));
				continue;
			}
			await visitPackageDirectory(entryPath);
		}

		const bunStore = path.join(moduleDirectory, ".bun");
		if (!(await isDirectory(bunStore))) return;
		const storeEntries = (
			await fs.readdir(bunStore, {
				withFileTypes: true,
			})
		).sort((left, right) => compareStrings(left.name, right.name));
		for (const storeEntry of storeEntries) {
			const storePackageDirectory = path.join(bunStore, storeEntry.name);
			const storeNodeModules = path.join(storePackageDirectory, "node_modules");
			if (await isDirectory(storeNodeModules))
				await visitNodeModulesDirectory(storeNodeModules);
		}
	}

	await visitNodeModulesDirectory(nodeModulesRoot);
	if (packages.length === 0)
		throw new Error(
			`installed dependency tree contains no packages: ${nodeModulesRoot}`,
		);

	packages.sort(
		(left, right) =>
			compareStrings(left.name ?? "", right.name ?? "") ||
			compareStrings(left.version ?? "", right.version ?? "") ||
			compareStrings(left.package_path, right.package_path),
	);
	const uniquePackages = new Set(
		packages.map((dependency) =>
			dependency.name && dependency.version
				? `${dependency.name}\u0000${dependency.version}`
				: `path:${dependency.package_path}`,
		),
	);

	return {
		schema_version: "experience_dependency_license_inventory_v1",
		status: "INVENTORIED",
		scope: "installed_node_modules_package_json_declarations_only",
		package_instance_count: packages.length,
		unique_package_count: uniquePackages.size,
		undeclared_license_count: packages.filter(
			(dependency) => dependency.license_status === "UNDECLARED",
		).length,
		packages,
	};
}

export async function installBunWorkspace(workspace: string): Promise<void> {
	const child = Bun.spawn(["bun", "install"], {
		cwd: workspace,
		stdin: "ignore",
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await child.exited;
	if (exitCode !== 0)
		throw new Error(`bun install failed (${exitCode}) in ${workspace}`);

	const lockfile = path.join(workspace, "bun.lock");
	if (!(await fs.pathExists(lockfile)))
		throw new Error(
			`bun install did not create the required lockfile: ${lockfile}`,
		);
	const lockfileBytes = (await fs.stat(lockfile)).size;
	if (lockfileBytes <= 0)
		throw new Error(`bun install created an empty lockfile: ${lockfile}`);
}
