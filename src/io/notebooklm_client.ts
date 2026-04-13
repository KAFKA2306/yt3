import { execSync } from "node:child_process";
import { z } from "zod";

export const NotebookListSchema = z.object({
	notebooks: z.array(
		z.object({
			id: z.string(),
			title: z.string().optional(),
		}),
	),
});

export const ArtifactListSchema = z.object({
	artifacts: z.array(
		z.object({
			id: z.string(),
			type_id: z.string(),
			type: z.string(),
			title: z.string(),
			status: z.string(),
			created_at: z.string(),
		}),
	),
});

export const NotebookCreateSchema = z.object({
	notebook: z.object({
		id: z.string(),
		title: z.string(),
	}),
});

export interface ShellExecutor {
	execute(command: string, returnOutput?: boolean): string | undefined;
}

export class RealShellExecutor implements ShellExecutor {
	execute(command: string, returnOutput = false): string | undefined {
		if (returnOutput) return execSync(command, { encoding: "utf-8" });
		execSync(command, { stdio: "inherit" });
		return undefined;
	}
}

export class NotebookLMClient {
	constructor(private shell: ShellExecutor = new RealShellExecutor()) {}

	list() {
		const out = this.shell.execute("notebooklm list --json", true);
		return out ? NotebookListSchema.parse(JSON.parse(out)).notebooks : [];
	}

	create(title: string) {
		const out = this.shell.execute(`notebooklm create "${title}" --json`, true);
		if (!out) throw new Error("Failed to create notebook");
		return NotebookCreateSchema.parse(JSON.parse(out)).notebook;
	}

	use(id: string) {
		this.shell.execute(`notebooklm use ${id}`);
	}

	listSources() {
		const out = this.shell.execute("notebooklm source list --json", true);
		return out
			? ((JSON.parse(out).sources || []) as Array<{ title: string }>)
			: [];
	}

	addSource(id: string, content: string, type?: string, title?: string) {
		const typeArg = type ? `--type ${type}` : "";
		const titleArg = title ? `--title "${title}"` : "";
		this.shell.execute(
			`notebooklm source add "${content}" -n ${id} ${typeArg} ${titleArg}`,
		);
	}

	addResearch(query: string) {
		this.shell.execute(
			`notebooklm source add-research "${query}" --mode deep --import-all`,
		);
	}

	listArtifacts() {
		const out = this.shell.execute("notebooklm artifact list --json", true);
		return out ? ArtifactListSchema.parse(JSON.parse(out)).artifacts : [];
	}

	generateAudio() {
		this.shell.execute("notebooklm generate audio --wait");
	}

	generateVideo(style: string) {
		this.shell.execute(`notebooklm generate video --wait --style ${style}`);
	}

	wait() {
		this.shell.execute("notebooklm artifact wait");
	}

	downloadAudio(path: string) {
		this.shell.execute(`notebooklm download audio "${path}" --latest --force`);
	}

	downloadVideo(path: string) {
		this.shell.execute(`notebooklm download video "${path}" --latest --force`);
	}

	getLatestVideoTitle(): string | null {
		const arts = this.listArtifacts();
		const vids = arts
			.filter((a) => a.type_id === "video")
			.sort(
				(a, b) =>
					new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
			);
		return vids.length > 0 ? (vids[0]?.title ?? null) : null;
	}
}
