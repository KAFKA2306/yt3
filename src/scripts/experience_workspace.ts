import path from "node:path";
import fs from "fs-extra";

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
