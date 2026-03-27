import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import * as childProcess from "node:child_process";
import fs from "fs-extra";
import path from "node:path";
import {
	NotebookLMAgent,
	type NotebookLMResult,
} from "../../src/domain/agents/notebooklm";
import type { AssetStore } from "../../src/io/core";
import { ROOT } from "../../src/io/base";

// Use a unique calls array per test suite to avoid pollution
let execSyncCalls: string[] = [];

const createMockStore = (): AssetStore => {
	const store = {
		runDir: "/tmp/test-run",
		cfg: {
			global_style: "default",
			workflow: {
				memory: { essence_file: "essence.json" },
				paths: { runs_dir: "runs", prompts_dir: "config/prompts" },
				filenames: {
					audio_full: "audio.mp3",
					state: "state.json",
					output: "output.yaml",
					subtitles: "subtitles.ass",
					thumbnail: "thumb.png",
					video: "video.mp4",
					input: "input.yaml",
				},
			},
			providers: { perplexity: { enabled: false } },
			agents: {
				notebooklm: {
					enabled: true,
					video_style: "whiteboard",
					output_dir: "runs/notebooklm",
					temperature: 0.1,
					notebook_ids: [],
				},
			},
		} as any,
		save: () => {},
		load: () => Promise.resolve({}),
		loadState: () => ({}),
		updateState: () => {},
		audioDir: () => "/tmp/test-run/audio",
		videoDir: () => "/tmp/test-run/video",
	} as unknown as AssetStore;
	return store;
};

describe("NotebookLMAgent", () => {
	let mockPathExists: ReturnType<typeof mock>;
	let mockEnsureDir: ReturnType<typeof mock>;

	beforeEach(() => {
		execSyncCalls = [];

		// Mock fs-extra functions
		mockPathExists = mock(() => Promise.resolve(true));
		mockEnsureDir = mock(() => Promise.resolve(undefined));

		spyOn(fs, "pathExists").mockImplementation(mockPathExists);
		spyOn(fs, "ensureDir").mockImplementation(mockEnsureDir);

		// Default mock for execSync
		spyOn(childProcess, "execSync").mockImplementation(((cmd: string) => {
			const cmdStr = cmd.toString();
			execSyncCalls.push(cmdStr);
			if (cmdStr.includes("artifact list --json")) {
				return JSON.stringify({
					artifacts: [
						{
							type_id: "video",
							title: "Test Video Title",
							created_at: new Date().toISOString(),
						},
					],
				});
			}
			if (cmdStr.includes("list --json")) {
				return JSON.stringify({
					notebooks: [
						{ id: "abc123", title: "Test Notebook 1" },
						{ id: "def456", title: "Test Notebook 2" },
					],
				});
			}
			return "";
		}) as any);
	});

	afterEach(() => {
		// Clear mocks
		mock.restore();
	});

	it("should return empty result when no notebooks are provided", async () => {
		const store = createMockStore();
		const agent = new NotebookLMAgent(store);
		const result = await agent.run([]);

		expect(result.videos).toEqual([]);
		expect(result.total_generated).toBe(0);
	});

	it("should execute commands in correct sequence for single notebook", async () => {
		const store = createMockStore();
		const agent = new NotebookLMAgent(store);

		await agent.run(["abc123"]);

		const listIdx = execSyncCalls.findIndex((c) => c.includes("list --json"));
		const useIdx = execSyncCalls.findIndex((c) => c.includes("use abc123"));
		const genIdx = execSyncCalls.findIndex((c) => c.includes("generate video"));
		const artIdx = execSyncCalls.findIndex((c) => c.includes("artifact list --json"));
		const dlIdx = execSyncCalls.findIndex((c) => c.includes("download video"));

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

	it("should execute generate command with whiteboard style by default", async () => {
		const store = createMockStore();
		const agent = new NotebookLMAgent(store);

		try {
			await agent.run(["abc123"]);
		} catch {
			// Expected to fail on fs check
		}

		const generateCall = execSyncCalls.find((c) =>
			c.includes("generate video"),
		);
		expect(generateCall).toContain("--style whiteboard");
	});

	it("should use custom video style when provided", async () => {
		const store = createMockStore();
		const agent = new NotebookLMAgent(store);

		try {
			await agent.run(["abc123"], "voiceover");
		} catch {
			// Expected to fail on fs check
		}

		const generateCall = execSyncCalls.find((c) =>
			c.includes("generate video"),
		);
		expect(generateCall).toContain("--style voiceover");
	});

	it("should process notebooks with proper command execution", async () => {
		const store = createMockStore();
		const agent = new NotebookLMAgent(store);

		await agent.run(["abc123", "def456"]);

		const listCalls = execSyncCalls.filter((c) => c === "notebooklm list --json");
		const useCalls = execSyncCalls.filter((c) => c.includes("use"));
		const generateCalls = execSyncCalls.filter((c) => c.includes("generate video"));
		const downloadCalls = execSyncCalls.filter((c) => c.includes("download video"));

		expect(listCalls.length).toBe(1);
		expect(useCalls.length).toBe(2);
		expect(generateCalls.length).toBe(2);
		expect(downloadCalls.length).toBe(2);
	});

	it("should sanitize notebook and video titles with special characters in paths", async () => {
		// Override mock for this specific test
		spyOn(childProcess, "execSync").mockImplementation(((cmd: string) => {
			const cmdStr = cmd.toString();
			execSyncCalls.push(cmdStr);
			if (cmdStr.includes("artifact list --json")) {
				return JSON.stringify({
					artifacts: [
						{
							type_id: "video",
							title: "Awesome: Video*Title",
							created_at: new Date().toISOString(),
						},
					],
				});
			}
			if (cmdStr.includes("list --json")) {
				return JSON.stringify({
					notebooks: [{ id: "abc123", title: "Test: Notebook/Title*" }],
				});
			}
			return "";
		}) as any);

		const store = createMockStore();
		const agent = new NotebookLMAgent(store);

		await agent.run(["abc123"]);

		const dlCall = execSyncCalls.find((c) => c.includes("download video"));
		expect(dlCall).toContain("test_notebook_title");
		expect(dlCall).toContain("awesome_video_title");
		expect(dlCall).not.toContain("Test:");
		expect(dlCall).not.toContain("Awesome:");
		expect(dlCall).toContain("runs-nlm");
	});

	it("should throw error when notebook not found", async () => {
		spyOn(childProcess, "execSync").mockImplementation(((cmd: string) => {
			const cmdStr = cmd.toString();
			execSyncCalls.push(cmdStr);
			if (cmdStr.includes("list --json")) {
				return JSON.stringify({ notebooks: [] });
			}
			return "";
		}) as any);

		const store = createMockStore();
		const agent = new NotebookLMAgent(store);

		try {
			await agent.run(["nonexistent-id"]);
			expect.unreachable();
		} catch (error: any) {
			expect(error.message).toContain("not found");
		}
	});

	it("should throw error when video file is not created", async () => {
		mockPathExists = mock(() => Promise.resolve(false));
		spyOn(fs, "pathExists").mockImplementation(mockPathExists);

		const store = createMockStore();
		const agent = new NotebookLMAgent(store);

		try {
			await agent.run(["abc123"]);
			expect.unreachable();
		} catch (error: any) {
			expect(error.message).toContain("not found");
		}
	});
});
