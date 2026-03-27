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
import {
	NotebookLMAgent,
	type NotebookLMResult,
} from "../../src/domain/agents/notebooklm";
import type { AssetStore } from "../../src/io/core";

// Track mocked command calls
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
		// Mock methods
		save: () => {}, // No-op for testing
		load: () => Promise.resolve({}),
		loadState: () => ({}),
		updateState: () => {},
		audioDir: () => "/tmp/test-run/audio",
		videoDir: () => "/tmp/test-run/video",
	} as unknown as AssetStore;
	return store;
};

describe("NotebookLMAgent", () => {
	let mockExecSync: ReturnType<typeof mock>;
	let mockPathExists: ReturnType<typeof mock>;
	let mockEnsureDir: ReturnType<typeof mock>;

	beforeEach(() => {
		execSyncCalls = [];

		// Mock execSync to track calls and return appropriate responses
		mockExecSync = mock((cmd: string) => {
			execSyncCalls.push(cmd);
			if (cmd.includes("list --json")) {
				return JSON.stringify([
					{ id: "abc123", title: "Test Notebook 1" },
					{ id: "def456", title: "Test Notebook 2" },
				]);
			}
			return "";
		});

		// Mock fs-extra functions
		mockPathExists = mock(() => Promise.resolve(true));
		mockEnsureDir = mock(() => Promise.resolve(undefined));

		// Spy on actual modules
		spyOn(childProcess, "execSync").mockImplementation(mockExecSync);
		spyOn(fs, "pathExists").mockImplementation(mockPathExists);
		spyOn(fs, "ensureDir").mockImplementation(mockEnsureDir);
	});

	afterEach(() => {
		execSyncCalls = [];
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

		try {
			await agent.run(["abc123"]);
		} catch {
			// Expected to fail on fs check, but we validate the sequence
		}

		// Verify the sequence of commands
		expect(execSyncCalls.length).toBeGreaterThan(0);

		const listIdx = execSyncCalls.findIndex((c) => c.includes("list --json"));
		const useIdx = execSyncCalls.findIndex((c) => c.includes("use abc123"));
		const genIdx = execSyncCalls.findIndex((c) => c.includes("generate video"));
		const dlIdx = execSyncCalls.findIndex((c) => c.includes("download video"));

		expect(listIdx).toBeGreaterThanOrEqual(0);
		expect(useIdx).toBeGreaterThanOrEqual(0);
		expect(genIdx).toBeGreaterThanOrEqual(0);
		expect(dlIdx).toBeGreaterThanOrEqual(0);

		// Verify order: list -> use -> generate -> download
		expect(listIdx).toBeLessThan(useIdx);
		expect(useIdx).toBeLessThan(genIdx);
		expect(genIdx).toBeLessThan(dlIdx);
	});

	it("should execute list command with whiteboard style by default", async () => {
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

		try {
			await agent.run(["abc123", "def456"]);
		} catch {
			// Expected to fail on fs check, but verify commands were executed
		}

		// Should have at least list, use, generate, and download commands
		const listCalls = execSyncCalls.filter((c) => c.includes("list --json"));
		const useCalls = execSyncCalls.filter((c) => c.includes("use"));
		const generateCalls = execSyncCalls.filter((c) =>
			c.includes("generate video"),
		);
		const downloadCalls = execSyncCalls.filter((c) =>
			c.includes("download video"),
		);

		// Should call list once (it caches the result)
		expect(listCalls.length).toBe(1);
		// Should call use twice (once for each notebook)
		expect(useCalls.length).toBe(2);
		// Should call generate twice
		expect(generateCalls.length).toBe(2);
		// Should call download twice
		expect(downloadCalls.length).toBe(2);
	});

	it("should sanitize notebook titles with special characters in paths", async () => {
		mockExecSync = mock((cmd: string) => {
			execSyncCalls.push(cmd);
			if (cmd.includes("list --json")) {
				return JSON.stringify([
					{ id: "abc123", title: "Test: Notebook/Title*" },
				]);
			}
			return "";
		});
		spyOn(childProcess, "execSync").mockImplementation(mockExecSync);

		const store = createMockStore();
		const agent = new NotebookLMAgent(store);

		try {
			await agent.run(["abc123"]);
		} catch {
			// Expected to fail on fs check, but verify path is sanitized
		}

		const dlCall = execSyncCalls.find((c) => c.includes("download video"));
		// Check that special characters are replaced with underscores in the path
		expect(dlCall).toContain("test_notebook_title");
		// Should be lowercase
		expect(dlCall).not.toContain("Test:");
	});

	it("should throw error when notebook not found", async () => {
		const store = createMockStore();
		// Mock to return empty notebook list
		mockExecSync = mock((cmd: string) => {
			execSyncCalls.push(cmd);
			if (cmd.includes("list --json")) {
				return JSON.stringify([]);
			}
			return "";
		});
		spyOn(childProcess, "execSync").mockImplementation(mockExecSync);

		const agent = new NotebookLMAgent(store);

		try {
			await agent.run(["nonexistent-id"]);
			expect.unreachable();
		} catch (error: any) {
			expect(error.message).toContain("not found");
		}
	});

	it("should throw error when video file is not created", async () => {
		const store = createMockStore();
		// Mock pathExists to return false
		mockPathExists = mock(() => Promise.resolve(false));
		spyOn(fs, "pathExists").mockImplementation(mockPathExists);

		const agent = new NotebookLMAgent(store);

		try {
			await agent.run(["abc123"]);
			expect.unreachable();
		} catch (error: any) {
			expect(error.message).toContain("not found");
		}
	});
});
