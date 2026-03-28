import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import fs from "fs-extra";
import path from "node:path";
import {
	NotebookLMAgent,
	type ShellExecutor,
} from "../../src/domain/agents/notebooklm";
import { AssetStore, ROOT } from "../../src/io/core";

class FakeShell implements ShellExecutor {
	calls: string[] = [];
	responses: Record<string, string> = {
		list: JSON.stringify({
			notebooks: [
				{ id: "abc123", title: "Test Notebook 1" },
				{ id: "def456", title: "Test Notebook 2" },
			],
		}),
		artifact: JSON.stringify({
			artifacts: [
				{
					type_id: "video",
					title: "Test Video Title",
					created_at: new Date().toISOString(),
				},
			],
		}),
		create: JSON.stringify({
			notebook: {
				id: "new-nb-id",
				title: "New Notebook",
			},
		}),
	};

	execute(command: string, returnOutput = false): string | undefined {
		this.calls.push(command);
		if (returnOutput) {
			if (command.includes("artifact list --json")) {
				return this.responses.artifact;
			}
			if (command.includes("list --json")) {
				return this.responses.list;
			}
			if (command.includes("create")) {
				return this.responses.create;
			}
			return "";
		}
		return undefined;
	}
}

describe("NotebookLMAgent", () => {
	let store: AssetStore;
	let fakeShell: FakeShell;
	let currentTestRunId: string;
	let uniqueOutputDir: string;

	beforeEach(() => {
		currentTestRunId = `test-run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		uniqueOutputDir = `runs-nlm-test-${currentTestRunId}`;
		store = new AssetStore(currentTestRunId);
		fakeShell = new FakeShell();

		// Initialize config for isolation
		if (!store.cfg.agents) store.cfg.agents = {};
		store.cfg.agents.notebooklm = {
			enabled: true,
			video_style: "whiteboard",
			output_dir: uniqueOutputDir,
			temperature: 0.1,
			notebook_ids: [],
		};
	});

	afterEach(async () => {
		const runPath = path.join(ROOT, "runs", currentTestRunId);
		if (await fs.pathExists(runPath)) {
			await fs.remove(runPath);
		}
		const nlmPath = path.join(ROOT, uniqueOutputDir);
		if (await fs.pathExists(nlmPath)) {
			await fs.remove(nlmPath);
		}
	});

	it("should return empty result when no notebooks are provided", async () => {
		const agent = new NotebookLMAgent(store, fakeShell);
		const result = await agent.run([]);

		expect(result.videos).toEqual([]);
		expect(result.total_generated).toBe(0);
	});

	it("should execute commands in correct sequence for single notebook", async () => {
		const agent = new NotebookLMAgent(store, fakeShell);

		const outputDir = path.join(
			ROOT,
			uniqueOutputDir,
			"test_notebook_1",
			"videos",
		);
		await fs.ensureDir(outputDir);
		const videoPath = path.join(outputDir, "test_video_title.mp4");
		await fs.writeFile(videoPath, "dummy");

		await agent.run(["abc123"]);

		const listIdx = fakeShell.calls.findIndex((c) => c.includes("list --json"));
		const useIdx = fakeShell.calls.findIndex((c) => c.includes("use abc123"));
		const genIdx = fakeShell.calls.findIndex((c) => c.includes("generate video"));
		const artIdx = fakeShell.calls.findIndex((c) =>
			c.includes("artifact list --json"),
		);
		const dlIdx = fakeShell.calls.findIndex((c) => c.includes("download video"));

		expect(listIdx).toBeGreaterThanOrEqual(0);
		expect(useIdx).toBeGreaterThanOrEqual(0);
		expect(genIdx).toBeGreaterThanOrEqual(0);
		expect(artIdx).toBeGreaterThanOrEqual(0);
		expect(dlIdx).toBeGreaterThanOrEqual(0);

		expect(listIdx).toBeLessThan(useIdx);
		expect(useIdx).toBeLessThan(genIdx);
		expect(genIdx).toBeLessThan(artIdx);
		expect(artIdx).toBeLessThan(dlIdx);
	});

	it("should process notebooks with proper command execution", async () => {
		const agent = new NotebookLMAgent(store, fakeShell);

		const dir1 = path.join(ROOT, uniqueOutputDir, "test_notebook_1", "videos");
		const dir2 = path.join(ROOT, uniqueOutputDir, "test_notebook_2", "videos");
		await fs.ensureDir(dir1);
		await fs.ensureDir(dir2);
		await fs.writeFile(path.join(dir1, "test_video_title.mp4"), "dummy");
		await fs.writeFile(path.join(dir2, "test_video_title.mp4"), "dummy");

		await agent.run(["abc123", "def456"]);

		const listCalls = fakeShell.calls.filter(
			(c) => c === "notebooklm list --json",
		);
		const useCalls = fakeShell.calls.filter((c) => c.includes("use"));
		const generateCalls = fakeShell.calls.filter((c) =>
			c.includes("generate video"),
		);
		const downloadCalls = fakeShell.calls.filter((c) =>
			c.includes("download video"),
		);

		expect(listCalls.length).toBe(1);
		expect(useCalls.length).toBe(2);
		expect(generateCalls.length).toBe(2);
		expect(downloadCalls.length).toBe(2);
	});

	it("should sanitize notebook and video titles with special characters in paths", async () => {
		fakeShell.responses.list = JSON.stringify({
			notebooks: [{ id: "abc123", title: "Test: Notebook/Title*" }],
		});
		fakeShell.responses.artifact = JSON.stringify({
			artifacts: [
				{
					type_id: "video",
					title: "Awesome: Video*Title",
					created_at: new Date().toISOString(),
				},
			],
		});

		const agent = new NotebookLMAgent(store, fakeShell);

		const outputDir = path.join(
			ROOT,
			uniqueOutputDir,
			"test_notebook_title",
			"videos",
		);
		await fs.ensureDir(outputDir);
		await fs.writeFile(path.join(outputDir, "awesome_video_title.mp4"), "dummy");

		await agent.run(["abc123"]);

		const dlCall = fakeShell.calls.find((c) => c.includes("download video"));
		expect(dlCall).toBeDefined();
		if (dlCall) {
			expect(dlCall).toContain("test_notebook_title");
			expect(dlCall).toContain("awesome_video_title");
			expect(dlCall).toContain(uniqueOutputDir);
		}
	});

	it("should throw error when notebook not found", async () => {
		fakeShell.responses.list = JSON.stringify({ notebooks: [] });
		const agent = new NotebookLMAgent(store, fakeShell);

		try {
			await agent.run(["nonexistent-id"]);
			throw new Error("Should have thrown");
		} catch (error: unknown) {
			if (error instanceof Error) {
				expect(error.message).toContain("not found");
			} else {
				throw error;
			}
		}
	});

	it("should throw error when video file is not created", async () => {
		const agent = new NotebookLMAgent(store, fakeShell);

		try {
			await agent.run(["abc123"]);
			throw new Error("Should have thrown");
		} catch (error: unknown) {
			if (error instanceof Error) {
				expect(error.message).toContain("Video file not found");
			} else {
				throw error;
			}
		}
	});

	it("should execute generate command with whiteboard style by default", async () => {
		const agent = new NotebookLMAgent(store, fakeShell);

		const outputDir = path.join(
			ROOT,
			uniqueOutputDir,
			"test_notebook_1",
			"videos",
		);
		await fs.ensureDir(outputDir);
		const videoPath = path.join(outputDir, "test_video_title.mp4");
		await fs.writeFile(videoPath, "dummy");

		await agent.run(["abc123"]);

		const generateCall = fakeShell.calls.find((c) =>
			c.includes("generate video"),
		);
		expect(generateCall).toContain("--style whiteboard");
	});

	it("should use custom video style when provided", async () => {
		const agent = new NotebookLMAgent(store, fakeShell);

		const outputDir = path.join(
			ROOT,
			uniqueOutputDir,
			"test_notebook_1",
			"videos",
		);
		await fs.ensureDir(outputDir);
		const videoPath = path.join(outputDir, "test_video_title.mp4");
		await fs.writeFile(videoPath, "dummy");

		await agent.run(["abc123"], "voiceover");

		const generateCall = fakeShell.calls.find((c) =>
			c.includes("generate video"),
		);
		expect(generateCall).toContain("--style voiceover");
	});

	it("should create a notebook correctly", async () => {
		const agent = new NotebookLMAgent(store, fakeShell);
		const id = await agent.createNotebook("New Notebook");

		expect(id).toBe("new-nb-id");
		expect(fakeShell.calls).toContain('notebooklm create "New Notebook" --json');
	});

	it("should add a source correctly", async () => {
		const agent = new NotebookLMAgent(store, fakeShell);
		await agent.addSource("nb123", "https://example.com");

		expect(fakeShell.calls).toContain(
			'notebooklm source add "https://example.com" -n nb123 ',
		);
	});

	it("should add a source with explicit type correctly", async () => {
		const agent = new NotebookLMAgent(store, fakeShell);
		await agent.addSource("nb123", "content", "text");

		expect(fakeShell.calls).toContain(
			'notebooklm source add "content" -n nb123 --type text',
		);
	});
});
