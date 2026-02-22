import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import "./setup.js";
import path from "node:path";
import fs from "fs-extra";
import { AssetStore } from "../src/core.js";

describe("AssetStore", () => {
  const testRunId = "test-store-run";
  const testDir = path.join(process.cwd(), "runs", testRunId);

  beforeAll(() => {
    fs.removeSync(testDir);
  });

  afterAll(() => {
    fs.removeSync(testDir);
  });

  it("should initialize and create run directory", () => {
    const store = new AssetStore(testRunId);
    expect(fs.existsSync(testDir)).toBe(true);
  });

  it("should save and load yaml data", () => {
    const store = new AssetStore(testRunId);
    const data = { foo: "bar", num: 123 };

    store.save("test_stage", "data", data);

    const loaded = store.load<typeof data>("test_stage", "data");
    expect(loaded).toEqual(data);

    const filePath = path.join(testDir, "test_stage", "data.yaml");
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("should update and load state", () => {
    const store = new AssetStore(testRunId);

    store.updateState({ workingOn: "something" });
    let state = store.loadState();
    expect(state.workingOn).toBe("something");

    store.updateState({ workingOn: "something else", step: "publish" });
    state = store.loadState();
    expect(state.workingOn).toBe("something else");
    expect(state.step).toBe("publish");
  });

  it("should create audio and video directories", () => {
    const store = new AssetStore(testRunId);
    const audioDir = store.audioDir();
    const videoDir = store.videoDir();

    expect(fs.existsSync(audioDir)).toBe(true);
    expect(audioDir).toBe(path.join(testDir, "audio"));

    expect(fs.existsSync(videoDir)).toBe(true);
    expect(videoDir).toBe(path.join(testDir, "video"));
  });
});
